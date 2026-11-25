#!/usr/bin/env node
'use strict';
// Las pruebas de Bravo Transfers (25/11/2026), rehechas dentro del repositorio: las de Playwright se perdieron el 16/11
// porque vivían en la carpeta temporal de una sesión.
//
// Arranca la web de verdad (web/server.js) en un puerto libre, con una carpeta de datos vacía y SERVICIOS FALSOS:
// las rutas (OSRM), el correo (Brevo), el buscador (Nominatim y Photon). Nunca se manda un correo de verdad ni se
// toca internet. Después recorre el camino entero de una reserva y las puertas que no se pueden abrir.
//
// Uso:  node web/pruebas/bravo.js        (sale con error si algo falla; tarda unos segundos)
// Para leer los PDF usa pdftotext si está; si no, busca el texto dentro del PDF (no van comprimidos).

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');
let pasos = 0;
let fallos = 0;
function ok(cond, msg, extra) {
  pasos++;
  if (cond) console.log('  ✓ ' + msg);
  else { fallos++; console.log('  ✗ ' + msg + (extra !== undefined ? '  →  ' + String(extra).slice(0, 300) : '')); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────── los servicios falsos ─────────────
function servidor(manejar) {
  return new Promise((resolve) => {
    const s = http.createServer(manejar);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function kmEntre(a, b) {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const correos = [];

// ───────────── pedir a la web ─────────────
let BASE = '';
function pedir(metodo, ruta, { cuerpo, galletas, cabeceras } = {}) {
  return new Promise((resolve, reject) => {
    const datos = cuerpo === undefined ? null : Buffer.from(JSON.stringify(cuerpo));
    const h = Object.assign({ 'User-Agent': 'Mozilla/5.0 (pruebas de Bravo)' }, cabeceras || {});
    if (datos) { h['Content-Type'] = 'application/json'; h['Content-Length'] = datos.length; }
    if (galletas) h.Cookie = Object.entries(galletas).map(([k, v]) => k + '=' + v).join('; ');
    const req = http.request(BASE + ruta, { method: metodo, headers: h }, (res) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(trozos);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* no es JSON */ }
        const nuevas = {};
        for (const c of [].concat(res.headers['set-cookie'] || [])) {
          const m = /^([^=]+)=([^;]*)/.exec(c);
          if (m) nuevas[m[1]] = m[2];
        }
        resolve({ status: res.statusCode, headers: res.headers, buf, json, galletas: nuevas });
      });
    });
    req.on('error', reject);
    if (datos) req.write(datos);
    req.end();
  });
}
function textoDelPdf(buf) {
  try {
    return execFileSync('pdftotext', ['-layout', '-', '-'], { input: buf }).toString('utf8');
  } catch (e) {
    return buf.toString('latin1');
  }
}
async function esperarCorreo(cond, ms = 6000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const c = correos.find(cond);
    if (c) return c;
    await espera(100);
  }
  return null;
}
function adjunto(correo, re) {
  const a = (correo && correo.attachment || []).find((x) => re.test(x.name));
  return a ? Buffer.from(a.content, 'base64') : null;
}
function dia(masDias) {
  const d = new Date(Date.now() + masDias * 86400000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const osrm = await servidor((req, res) => {
    const m = /\/route\/v1\/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/.exec(req.url);
    res.writeHead(m ? 200 : 404, { 'Content-Type': 'application/json' });
    if (!m) return res.end('{}');
    const km = kmEntre({ lon: +m[1], lat: +m[2] }, { lon: +m[3], lat: +m[4] }) * 1.3;   // como si la carretera diera vueltas
    res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: km * 1000, duration: km * 60 }] }));
  });
  const correo = await servidor((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      try { correos.push(Object.assign(JSON.parse(b), { _clave: req.headers['api-key'] })); } catch (e) { /* roto */ }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end('{"messageId":"prueba"}');
    });
  });
  const buscador = await servidor((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); });

  const DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'bravo-pruebas-'));
  const PUERTO = 39000 + Math.floor(Math.random() * 900);
  BASE = 'http://127.0.0.1:' + PUERTO;
  const CLAVE = 'clave-de-pruebas-1234567';
  const env = Object.assign({}, process.env, {
    PORT: String(PUERTO), DATA_DIR: DATOS, STATS_KEY: CLAVE, EMAIL_KEY: 'xkeysib-falsa-de-pruebas', EMAIL_API: 'brevo',
    BRAVO_EMAIL_URL: 'http://127.0.0.1:' + correo.address().port + '/v3/smtp/email',
    BRAVO_OSRM_URL: 'http://127.0.0.1:' + osrm.address().port,
    BRAVO_GEO_URL: 'http://127.0.0.1:' + buscador.address().port,
    BRAVO_PHOTON_URL: 'http://127.0.0.1:' + buscador.address().port,
    EMAIL_OWNER: 'alberto@ejemplo.test', PUBLIC_URL: BASE
  });
  delete env.BRAVO_KEY;
  const web = spawn(process.execPath, [path.join(RAIZ, 'web', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let salidaWeb = '';
  web.stdout.on('data', (c) => { salidaWeb += c; });
  web.stderr.on('data', (c) => { salidaWeb += c; });

  const cerrar = () => {
    try { web.kill(); } catch (e) { /* ya cerrada */ }
    osrm.close(); correo.close(); buscador.close();
    fs.rmSync(DATOS, { recursive: true, force: true });
  };
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await pedir('GET', '/'); if (r.status === 200) break; } catch (e) { /* aún no */ }
      await espera(100);
    }

    // ───────────────────────────────────────────────
    console.log('\n🔒 La puerta (fase 1: todo con contraseña)');
    ok((await pedir('GET', '/bravo/')).status === 401, '/bravo/ sin contraseña: 401');
    ok((await pedir('GET', '/api/bravo/admin/bookings')).status === 401, 'la API sin contraseña: 401');
    ok((await pedir('POST', '/api/bravo/login', { cuerpo: { key: 'mala' } })).status === 401, 'contraseña mala: 401');
    const entra = await pedir('POST', '/api/bravo/login', { cuerpo: { key: CLAVE } });
    const PASE = { bravo_pass: entra.galletas.bravo_pass };
    ok(entra.status === 200 && PASE.bravo_pass, 'contraseña buena: entra y deja su galleta');
    const pag = await pedir('GET', '/bravo/', { galletas: PASE });
    ok(pag.status === 200 && /noindex/i.test(pag.buf.toString() + JSON.stringify(pag.headers)), '/bravo/ con la galleta: 200 y con noindex');

    // ───────────────────────────────────────────────
    console.log('\n💶 El precio (lo calcula el servidor)');
    const AGP = { lat: 36.6749, lon: -4.4991, label: 'Aeropuerto de Málaga (AGP)' };
    const MARBELLA = { lat: 36.5101, lon: -4.8825, label: 'Marbella' };
    const kmEsperados = Math.round(kmEntre(AGP, MARBELLA) * 1.3 * 10) / 10;
    const q = await pedir('POST', '/api/bravo/quote', { galletas: PASE, cuerpo: { kind: 'transfer', passengers: 2, from: AGP, to: MARBELLA } });
    const coche = q.json && q.json.options && q.json.options.find((o) => o.id === 'car');
    ok(q.status === 200 && coche, 'el precio sale', q.status + ' ' + q.buf);
    ok(q.json && Math.abs(q.json.km - kmEsperados) < 0.2, `los km salen de las rutas (${q.json && q.json.km} ≈ ${kmEsperados})`);
    ok(coche && coche.price === Math.ceil(Math.max(30, kmEsperados * 1.0)), 'el coche cuesta lo de la tarifa (ficticia)', coche && coche.price);
    const fuera = await pedir('POST', '/api/bravo/quote', { galletas: PASE, cuerpo: { kind: 'transfer', passengers: 2, from: { lat: 40.4168, lon: -3.7038, label: 'Madrid' }, to: AGP } });
    ok(fuera.status === 400 && fuera.json.error === 'origin_not_malaga', 'una salida fuera de Málaga se rechaza');

    // ───────────────────────────────────────────────
    console.log('\n📅 La reserva');
    const CLIENTE = 'cliente@ejemplo.test';
    const r = await pedir('POST', '/api/bravo/book', {
      galletas: PASE,
      cuerpo: { kind: 'transfer', passengers: 2, from: AGP, to: MARBELLA, vehicle: 'car', date: dia(3), time: '10:30',
        name: 'Cliente de Prueba', phone: '+34 600 000 000', email: CLIENTE, lang: 'es', flight: 'FR1234', price: 1 }
    });
    ok(r.status === 200 && r.json.ref === 'BT-0001', 'reservada como BT-0001', r.status + ' ' + r.buf);
    ok(r.json && r.json.price === coche.price, 'el precio lo pone el servidor, no la página (mandaba 1 €)', r.json && r.json.price);
    ok(r.json && r.json.paid === false && !r.json.invoiceDoc, 'al reservar no hay factura: está pendiente de pago');
    ok(r.json && r.json.newAccount === true && r.json.emailOn === true, 'se crea la cuenta del cliente y el correo está activo');
    const pronto = await pedir('POST', '/api/bravo/book', { galletas: PASE, cuerpo: { kind: 'transfer', passengers: 2, from: AGP, to: MARBELLA, vehicle: 'car', date: dia(0), time: '00:05', name: 'X Y', phone: '+34 600 000 000', email: 'x@ejemplo.test' } });
    ok(pronto.status === 400 && pronto.json.error === 'too_soon', 'con menos de 24 horas no se puede reservar');
    const clientToken = r.json && (/doc\/([a-f0-9]{32})\//.exec(r.json.doc) || [])[1];

    const c1 = await esperarCorreo((c) => c.to && c.to[0].email === CLIENTE);
    ok(c1, 'le llega un correo al cliente');
    ok(c1 && c1._clave === 'xkeysib-falsa-de-pruebas', 'el correo sale con la clave de la variable EMAIL_KEY (al servicio falso)');
    const pdf1 = adjunto(c1, /\.pdf$/i);
    ok(pdf1 && /PENDIENTE DE PAGO/.test(textoDelPdf(pdf1)), 'con el PDF «Reserva y presupuesto» que dice PENDIENTE DE PAGO');
    const clave = c1 && (/Contraseña: (\S+)/.exec(c1.textContent || '') || [])[1];
    ok(Boolean(clave), 'y su contraseña (solo por correo)');
    ok(!JSON.stringify(r.json).includes(clave || '¬'), 'la contraseña no sale en la respuesta de la página');
    const aviso = await esperarCorreo((c) => c.to && c.to[0].email === 'alberto@ejemplo.test', 1500);
    console.log('    (aviso a Alberto por correo: ' + (aviso ? 'sí' : 'no; va por Web3Forms desde la página') + ')');

    // ───────────────────────────────────────────────
    console.log('\n📄 Los PDF por enlace privado');
    const just = await pedir('GET', '/api/bravo/doc/' + clientToken + '/justificante.pdf');
    ok(just.status === 200 && /application\/pdf/.test(just.headers['content-type']), 'el enlace del cliente abre su justificante');
    ok(/no-store/.test(just.headers['cache-control'] || '') && /noindex/.test(just.headers['x-robots-tag'] || ''), 'sin caché y sin buscadores');
    ok((await pedir('GET', '/api/bravo/doc/' + clientToken + '/hoja.pdf')).status === 404, 'el enlace del cliente NO abre la hoja de la empresa');
    ok((await pedir('GET', '/api/bravo/doc/' + '0'.repeat(32) + '/justificante.pdf')).status === 404, 'un enlace inventado no abre nada');

    // ───────────────────────────────────────────────
    console.log('\n👤 La cuenta del cliente');
    ok((await pedir('GET', '/api/bravo/customer/me', { galletas: PASE })).status === 401, 'sin entrar: 401');
    ok((await pedir('POST', '/api/bravo/customer/login', { galletas: PASE, cuerpo: { email: CLIENTE, password: 'mala-mala' } })).status === 401, 'con la contraseña mala: 401');
    const ce = await pedir('POST', '/api/bravo/customer/login', { galletas: PASE, cuerpo: { email: CLIENTE, password: clave } });
    const CLI = Object.assign({}, PASE, { bravo_cust: ce.galletas.bravo_cust });
    ok(ce.status === 200 && CLI.bravo_cust, 'con la del correo: entra');
    const yo = await pedir('GET', '/api/bravo/customer/me', { galletas: CLI });
    const txtYo = yo.buf.toString();
    ok(yo.status === 200 && yo.json.bookings.length === 1 && yo.json.bookings[0].ref === 'BT-0001', 've su reserva');
    ok(!/driverPay|driverToken|clientToken|"notes"|"offers"/.test(txtYo), 'y no ve lo que se paga a la empresa, ni notas, ni enlaces privados');
    const olvido1 = await pedir('POST', '/api/bravo/customer/forgot', { galletas: PASE, cuerpo: { email: CLIENTE } });
    const olvido2 = await pedir('POST', '/api/bravo/customer/forgot', { galletas: PASE, cuerpo: { email: 'nadie@ejemplo.test' } });
    ok(olvido1.status === 200 && olvido2.status === 200 && olvido1.buf.toString() === olvido2.buf.toString(), '«he olvidado la contraseña» responde igual exista o no la cuenta');

    // ───────────────────────────────────────────────
    console.log('\n🚐 Ofrecer el viaje a una empresa');
    const EMPRESA = 'empresa@ejemplo.test';
    const dr = await pedir('POST', '/api/bravo/admin/drivers', { galletas: PASE, cuerpo: { drivers: [{ name: 'Taxis del Sol SL', phone: '+34 611 111 111', email: EMPRESA }, { name: 'VTC Costa', phone: '+34 622 222 222', email: 'otra@ejemplo.test' }] } });
    ok(dr.status === 200, 'se guardan dos empresas', dr.status + ' ' + dr.buf);
    const sinPago = await pedir('POST', '/api/bravo/admin/offer', { galletas: PASE, cuerpo: { ref: 'BT-0001', companies: ['Taxis del Sol SL'] } });
    ok(sinPago.status === 400 && sinPago.json.error === 'need_pay', 'sin poner lo que se le paga, no se puede ofrecer');
    const up = await pedir('POST', '/api/bravo/admin/update', { galletas: PASE, cuerpo: { ref: 'BT-0001', driverPay: 45 } });
    ok(up.status === 200, 'se pone lo que se le paga (45 €)', up.status + ' ' + up.buf);
    const of = await pedir('POST', '/api/bravo/admin/offer', { galletas: PASE, cuerpo: { ref: 'BT-0001', companies: ['Taxis del Sol SL', 'VTC Costa'] } });
    const ofertas = (of.json && of.json.booking && of.json.booking.offers) || [];
    ok(of.status === 200 && ofertas.length === 2, 'se ofrece a las dos', of.status + ' ' + of.buf);
    const t1 = ofertas.find((o) => o.name === 'Taxis del Sol SL');
    const t2 = ofertas.find((o) => o.name === 'VTC Costa');
    const co = await esperarCorreo((c) => c.to && c.to[0].email === EMPRESA);
    ok(co && (co.htmlContent || '').includes('/api/bravo/job/' + (t1 && t1.token)), 'a la empresa le llega su enlace privado');
    const vista = await pedir('GET', '/api/bravo/job/' + t1.token + '/data');
    const txtVista = vista.buf.toString();
    ok(vista.status === 200 && /45/.test(txtVista), 'con el enlace ve el viaje y lo que se le paga (sin contraseña)');
    ok(!txtVista.includes(CLIENTE) && !txtVista.includes('Cliente de Prueba') && !txtVista.includes('600 000 000'), 'pero NO ve al cliente antes de aceptar');
    const acepta = await pedir('POST', '/api/bravo/job/' + t1.token + '/answer', { cuerpo: { action: 'accept', car: 'Toyota Corolla 1234 ABC', chauffeur: 'Juan', chauffeurPhone: '+34 633 333 333' } });
    ok(acepta.status === 200, 'la primera empresa acepta', acepta.status + ' ' + acepta.buf);
    const tarde = await pedir('POST', '/api/bravo/job/' + t2.token + '/answer', { cuerpo: { action: 'accept' } });
    ok(tarde.status === 409, 'la segunda llega tarde: ya está cogido (409)');
    const hoja = await esperarCorreo((c) => c.to && c.to[0].email === EMPRESA && (c.attachment || []).length > 0);
    ok(Boolean(hoja), 'la empresa que aceptó recibe su hoja de servicio');
    ok((await pedir('POST', '/api/bravo/job/' + t1.token + '/answer', { cuerpo: { action: 'pickup' } })).status === 200, '«cliente recogido»');
    const hecho = await pedir('POST', '/api/bravo/job/' + t1.token + '/answer', { cuerpo: { action: 'done' } });
    ok(hecho.status === 200, '«viaje terminado»');
    const yo2 = await pedir('GET', '/api/bravo/customer/me', { galletas: CLI });
    ok(/Juan/.test(yo2.buf.toString()) && !/driverPay/.test(yo2.buf.toString()), 'el cliente ve a su conductor, y sigue sin ver lo que se le paga');

    // ───────────────────────────────────────────────
    console.log('\n🧾 El cobro y la factura');
    const hoy = dia(0);
    const cobro = await pedir('POST', '/api/bravo/admin/client-paid', { galletas: PASE, cuerpo: { ref: 'BT-0001', via: 'banco', date: hoy } });
    const numFactura = cobro.json && cobro.json.booking && cobro.json.booking.invoice && cobro.json.booking.invoice.number;
    ok(cobro.status === 200 && cobro.json.invoiced === true, 'al marcarlo cobrado se hace la factura sola', cobro.status + ' ' + cobro.buf);
    ok(numFactura === 'F-' + hoy.slice(0, 4) + '-0001', 'numerada ' + numFactura);
    ok(cobro.json && cobro.json.emailed === true, 'y se manda «Pago recibido»');
    const pagado = await esperarCorreo((c) => c.to && c.to[0].email === CLIENTE && (c.attachment || []).some((a) => /F-\d{4}-\d+/.test(a.name)));
    ok(Boolean(pagado), 'el correo lleva la factura');
    const just2 = await pedir('GET', '/api/bravo/doc/' + clientToken + '/justificante.pdf');
    ok(/PAGADO/.test(textoDelPdf(just2.buf)) && !/PENDIENTE DE PAGO/.test(textoDelPdf(just2.buf)), 'el PDF de la reserva dice PAGADO');
    const fact = await pedir('GET', '/api/bravo/doc/' + clientToken + '/f/' + numFactura + '.pdf');
    ok(fact.status === 200 && textoDelPdf(fact.buf).includes(numFactura), 'la factura se abre con el enlace del cliente');
    const antes = correos.length;
    const otraVez = await pedir('POST', '/api/bravo/admin/client-paid', { galletas: PASE, cuerpo: { ref: 'BT-0001', via: 'banco', date: hoy } });
    await espera(600);
    ok(otraVez.status === 200 && otraVez.json.emailed === false && correos.length === antes, '«Pago recibido» solo una vez por reserva');
    const borrar = await pedir('POST', '/api/bravo/admin/delete', { galletas: PASE, cuerpo: { ref: 'BT-0001' } });
    const sigue = await pedir('GET', '/api/bravo/doc/' + clientToken + '/f/' + numFactura + '.pdf');
    ok(sigue.status === 200, 'una reserva con factura no se puede borrar (la factura sigue ahí)', borrar.status + ' ' + borrar.buf);

    // ───────────────────────────────────────────────
    console.log('\n🧑‍💼 El operador (el sobrino): sin dinero');
    const us = await pedir('POST', '/api/bravo/admin/users/save', { galletas: PASE, cuerpo: { name: 'Sobrino', user: 'sobrino', password: 'una-clave-bien-larga' } });
    ok(us.status === 200, 'se crea su usuario', us.status + ' ' + us.buf);
    const op = await pedir('POST', '/api/bravo/login', { cuerpo: { user: 'sobrino', password: 'una-clave-bien-larga' } });
    const OP = { bravo_op: op.galletas.bravo_op };
    ok(op.status === 200 && OP.bravo_op, 'entra con su usuario');
    const vistaOp = await pedir('GET', '/api/bravo/admin/bookings', { galletas: OP });
    const txtOp = vistaOp.buf.toString();
    ok(vistaOp.status === 200 && /BT-0001/.test(txtOp), 've los viajes');
    const dinero = (txtOp.match(/"(price|driverPay|driverVat|driverPaid|invoice|creditNotes|clientPaid|offers|quote|discount|payment)"\s*:/g) || []);
    ok(dinero.length === 0, 'sin precios, pagos, facturas ni ofertas', dinero.join(' '));
    for (const [m, rt] of [['GET', 'admin/accounts'], ['POST', 'admin/client-paid'], ['GET', 'admin/backup.json'], ['POST', 'admin/offer'], ['GET', 'admin/funnel']]) {
      const x = await pedir(m, '/api/bravo/' + rt, { galletas: OP, cuerpo: m === 'POST' ? { ref: 'BT-0001' } : undefined });
      ok(x.status === 403, `${m} ${rt}: prohibido (403)`, x.status);
    }
    const cambia = await pedir('POST', '/api/bravo/admin/update', { galletas: OP, cuerpo: { ref: 'BT-0001', driverPay: 999, notes: 'nota del sobrino' } });
    const trasCambio = await pedir('GET', '/api/bravo/admin/bookings', { galletas: PASE });
    const b1 = trasCambio.json.bookings.find((x) => x.ref === 'BT-0001');
    ok(cambia.status === 200 && b1.driverPay === 45 && b1.notes === 'nota del sobrino', 'puede cambiar las notas, pero no lo que se paga');

    // ───────────────────────────────────────────────
    console.log('\n🛑 Los frenos contra quien prueba claves');
    let ultimo = 0;
    // Bravo deja 11 intentos malos (cuenta «más de 10»); el 12º ya no se mira
    for (let i = 0; i < 12; i++) ultimo = (await pedir('POST', '/api/bravo/login', { cuerpo: { key: 'mala' + i }, cabeceras: { 'X-Forwarded-For': '10.9.9.9' } })).status;
    ok(ultimo === 429, 'Bravo: a la 12ª contraseña mala desde la misma dirección, 429');
    ok((await pedir('POST', '/api/bravo/login', { cuerpo: { key: CLAVE }, cabeceras: { 'X-Forwarded-For': '10.9.9.9' } })).status === 429, 'Bravo: con el freno puesto ni la buena entra');
    for (let i = 0; i < 11; i++) ultimo = (await pedir('GET', '/api/stats?key=mala' + i, { cabeceras: { 'X-Forwarded-For': '10.8.8.8' } })).status;
    ok(ultimo === 429, '/api/stats: a la 11ª clave mala desde la misma dirección, 429');
    ok((await pedir('GET', '/api/stats?key=' + CLAVE, { cabeceras: { 'X-Forwarded-For': '10.8.8.8' } })).status === 429, '/api/stats: con el freno puesto ni la buena entra');
    ok((await pedir('GET', '/api/stats?key=' + CLAVE, { cabeceras: { 'X-Forwarded-For': '10.7.7.7' } })).status === 200, '/api/stats: la buena, desde otra dirección, sí');
    ok((await pedir('GET', '/api/notes?key=' + CLAVE, { cabeceras: { 'X-Forwarded-For': '10.7.7.7' } })).status === 200, '/api/notes: la buena entra');
  } catch (e) {
    fallos++;
    console.log('  ✗ las pruebas se han parado: ' + (e && e.stack || e));
  } finally {
    cerrar();
  }
  console.log(`\n${fallos ? '❌' : '✅'} ${pasos - fallos} de ${pasos} comprobaciones bien` + (fallos ? `; ${fallos} mal` : ''));
  if (fallos && salidaWeb.trim()) console.log('\nLo que dijo la web:\n' + salidaWeb.slice(-2000));
  process.exit(fallos ? 1 : 0);
}

main();
