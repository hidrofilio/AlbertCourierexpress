// Bravo Transfers — reservas de traslados desde Málaga (fase 1: escondida).
//
// La web vive en /bravo/ y el panel de Alberto en /bravo/panel/. Mientras se monta,
// TODO /bravo/ y /api/bravo/ pide contraseña: la variable BRAVO_KEY de Railway, o
// STATS_KEY mientras BRAVO_KEY no exista. Nunca se escribe aquí: el repo es público.
// Las reservas y los precios van en DATA_DIR/bravo/ (volumen de Railway), nunca en git.
// Los precios de DEFAULTS son FICTICIOS, para probar la calculadora.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const pdf = require('./bravo-pdf');

const DEFAULTS = {
  vehicles: {
    car: { seats: 4, perKm: 1.0, minFare: 30, perHour: 40 },
    van: { seats: 7, perKm: 1.3, minFare: 40, perHour: 52 }
  },
  minHoursAhead: 24,
  hourly: { min: 2, max: 12 },
  // Provisional: solo salidas desde la provincia de Málaga (caja aproximada)
  originBox: { latMin: 36.28, latMax: 37.32, lonMin: -5.65, lonMax: -3.75 },
  // Datos de las facturas: PROVISIONALES, se cambian desde el panel (Ajustes).
  // Nunca la dirección de casa de Alberto.
  invoice: { issuerName: 'Bravo Transfers', taxId: '', address: '', email: 'info@albertcourierexpress.com', phone: '+353 87 459 2308', defaultVat: 10, footer: '' }
};
const SPAIN_BOX = { latMin: 35.8, latMax: 43.9, lonMin: -9.5, lonMax: 4.5 };
const STATUSES = ['pendiente', 'asignada', 'hecha', 'cancelada'];
const COOKIE = 'bravo_pass';

module.exports = function createBravo({ DATA_DIR, readBody, getClientIp }) {
  const KEY = process.env.BRAVO_KEY || process.env.STATS_KEY || '';
  const OSRM = (process.env.BRAVO_OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  const DIR = path.join(DATA_DIR, 'bravo');
  const BOOKINGS = path.join(DIR, 'bookings');
  fs.mkdirSync(BOOKINGS, { recursive: true });

  // ---------- utilidades ----------
  function json(res, status, obj, extra) {
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow'
    }, extra || {}));
    res.end(JSON.stringify(obj));
  }
  const hits = new Map();
  function over(bucket, max, windowMs, count) {
    const now = Date.now();
    let rec = hits.get(bucket);
    if (!rec || now - rec.start > windowMs) { rec = { start: now, count: 0 }; hits.set(bucket, rec); }
    if (count) rec.count++;
    return rec.count > max;
  }
  setInterval(() => {
    const now = Date.now();
    for (const [k, rec] of hits) if (now - rec.start > 86400000) hits.delete(k);
  }, 600000).unref();

  function clean(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function cleanLong(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ').trim().slice(0, max);
  }
  function int(v, min, max) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }
  function point(p, box) {
    if (!p || typeof p !== 'object') return null;
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < box.latMin || lat > box.latMax || lon < box.lonMin || lon > box.lonMax) return null;
    return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, label: clean(p.label, 160) };
  }

  function settings() {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(path.join(DIR, 'settings.json'), 'utf8')); } catch (e) { /* sin ajustes: los de prueba */ }
    const out = JSON.parse(JSON.stringify(DEFAULTS));
    if (s.vehicles) for (const id of Object.keys(out.vehicles)) Object.assign(out.vehicles[id], s.vehicles[id] || {});
    if (Number.isFinite(s.minHoursAhead)) out.minHoursAhead = s.minHoursAhead;
    if (s.invoice) Object.assign(out.invoice, s.invoice);
    return out;
  }
  function num(v, min, max, decimals) {
    const n = Number(v);
    if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) return null;
    const f = Math.pow(10, decimals || 0);
    return Math.round(n * f) / f;
  }
  // Ajustes que manda el panel: se comprueba todo antes de guardar
  function readSettings(d) {
    const cur = settings();
    const out = { vehicles: {}, minHoursAhead: cur.minHoursAhead, invoice: {} };
    for (const id of Object.keys(cur.vehicles)) {
      const v = (d.vehicles || {})[id] || {};
      const perKm = num(v.perKm, 0, 20, 2), minFare = num(v.minFare, 0, 5000, 2), perHour = num(v.perHour, 0, 1000, 2);
      if (perKm == null || minFare == null || perHour == null) return { error: 'bad_price', vehicle: id };
      out.vehicles[id] = { perKm, minFare, perHour };
    }
    const ahead = num(d.minHoursAhead, 0, 168, 0);
    if (ahead == null) return { error: 'bad_hours_ahead' };
    out.minHoursAhead = ahead;
    const inv = d.invoice || {};
    const vat = num(inv.defaultVat, 0, 30, 2);
    if (vat == null) return { error: 'bad_vat' };
    out.invoice = {
      issuerName: clean(inv.issuerName, 80) || 'Bravo Transfers', taxId: clean(inv.taxId, 30),
      address: cleanLong(inv.address, 200), email: clean(inv.email, 120), phone: clean(inv.phone, 30),
      defaultVat: vat, footer: cleanLong(inv.footer, 300)
    };
    return { settings: out };
  }

  // ---------- conductores ----------
  const DRIVERS = path.join(DIR, 'drivers.json');
  function drivers() {
    try { return JSON.parse(fs.readFileSync(DRIVERS, 'utf8')); } catch (e) { return []; }
  }

  // ---------- enlaces privados a los PDFs (sin contraseña, con una clave larga al azar) ----------
  function token() { return crypto.randomBytes(16).toString('hex'); }
  function ensureTokens(b) {
    let changed = false;
    if (!b.clientToken) { b.clientToken = token(); changed = true; }
    if (!b.driverToken) { b.driverToken = token(); changed = true; }
    return changed;
  }
  function today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  // Series: F (facturas) y R (rectificativas), cada una seguida por año
  function nextInvoiceNumber(year, series) {
    series = series || 'F';
    const file = path.join(DIR, 'invoice-counter.json');
    let c = {};
    try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* primera */ }
    const key = series === 'F' ? year : series + year;
    c[key] = (c[key] || 0) + 1;
    fs.writeFileSync(file, JSON.stringify(c));
    return series + '-' + year + '-' + String(c[key]).padStart(4, '0');
  }
  function activeInvoice(b) { return Boolean(b.invoice && b.invoice.status === 'emitida'); }
  function allInvoices(b) { return [b.invoice].concat(b.previousInvoices || [], b.creditNotes || []).filter(Boolean); }

  // Cuentas del Plan General Contable (PGC) para cada categoría
  const PGC = {
    'Conductores (reservas)': ['607', 'Trabajos realizados por otras empresas'],
    'Conductores (sin reserva)': ['607', 'Trabajos realizados por otras empresas'],
    'Combustible y peajes': ['628', 'Suministros'],
    'Vehículos': ['622', 'Reparaciones y conservación'],
    'Seguros': ['625', 'Primas de seguros'],
    'Publicidad': ['627', 'Publicidad, propaganda y relaciones públicas'],
    'Web, software y comisiones': ['629', 'Otros servicios'],
    'Gestoría y asesoría': ['623', 'Servicios de profesionales independientes'],
    'Teléfono e internet': ['628', 'Suministros'],
    'Oficina y material': ['629', 'Otros servicios'],
    'Impuestos y tasas': ['631', 'Otros tributos'],
    'Otros gastos': ['629', 'Otros servicios'],
    'Facturas de la web': ['705', 'Prestaciones de servicios'],
    'Servicio fuera de la web': ['705', 'Prestaciones de servicios'],
    'Otros ingresos': ['759', 'Ingresos por servicios diversos']
  };

  // ---------- contabilidad: gastos e ingresos apuntados a mano ----------
  const LEDGER = path.join(DIR, 'ledger.json');
  const RECEIPTS = path.join(DIR, 'receipts');
  fs.mkdirSync(RECEIPTS, { recursive: true });
  const EXPENSE_CATS = ['Conductores (sin reserva)', 'Combustible y peajes', 'Vehículos', 'Seguros', 'Publicidad', 'Web, software y comisiones',
    'Gestoría y asesoría', 'Teléfono e internet', 'Oficina y material', 'Impuestos y tasas', 'Otros gastos'];
  const INCOME_CATS = ['Servicio fuera de la web', 'Otros ingresos'];
  const RECEIPT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
  function ledger() {
    try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch (e) { return []; }
  }
  function saveLedger(list) {
    fs.writeFileSync(LEDGER + '.tmp', JSON.stringify(list, null, 1));
    fs.renameSync(LEDGER + '.tmp', LEDGER);
  }
  function splitVat(total, rate) {
    const base = Math.round((total / (1 + rate / 100)) * 100) / 100;
    return { base, vat: Math.round((total - base) * 100) / 100 };
  }
  // Qué tipo de archivo es, mirando sus primeros bytes (no lo que diga el navegador)
  function sniff(buf) {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.slice(0, 4).toString('hex') === '89504e47') return 'png';
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
    if (buf.slice(0, 5).toString() === '%PDF-') return 'pdf';
    return null;
  }
  function removeReceipt(e) {
    if (e && e.receipt) { try { fs.unlinkSync(path.join(RECEIPTS, e.receipt.file)); } catch (err) { /* ya no estaba */ } }
  }
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

  // Todos los movimientos de un periodo: facturas, pagos a conductores y lo apuntado a mano
  function movements(from, to) {
    const inRange = (d) => d >= from && d <= to;
    const out = [];
    let unbilledN = 0, unbilledSum = 0;
    for (const b of allBookings()) {
      for (const inv of allInvoices(b)) {
        if (inv.status === 'anulada' || !inRange(inv.date)) continue;
        const credit = inv.kind === 'rectificativa';
        out.push({ date: inv.date, kind: 'ingreso', source: credit ? 'rectificativa' : 'factura',
          concept: (credit ? 'Rectificativa ' + inv.number + ' (de ' + inv.rectifies + ')' : 'Factura ' + inv.number), number: inv.number,
          party: (inv.customer && inv.customer.name) || b.name, taxId: (inv.customer && inv.customer.taxId) || '',
          category: 'Facturas de la web', base: inv.base, vatRate: inv.vatRate, vat: inv.vat, total: inv.total, ref: b.ref });
      }
      if (b.status !== 'cancelada' && b.driverPay != null && b.driverPay > 0 && inRange(b.date)) {
        const rate = Number.isFinite(b.driverVat) ? b.driverVat : 0;
        const sv = splitVat(b.driverPay, rate);
        out.push({ date: b.date, kind: 'gasto', source: 'conductor', concept: 'Pago al conductor · ' + b.ref, party: b.driverName || '',
          category: 'Conductores (reservas)', base: sv.base, vatRate: rate, vat: sv.vat, total: b.driverPay, ref: b.ref });
      }
      if (b.status !== 'cancelada' && b.price > 0 && !activeInvoice(b) && inRange(b.date)) { unbilledN++; unbilledSum += b.price; }
    }
    for (const e of ledger()) {
      if (!inRange(e.date)) continue;
      out.push({ date: e.date, kind: e.type, source: 'manual', id: e.id, concept: e.concept, party: e.party, category: e.category, number: e.number || '', taxId: e.taxId || '',
        base: e.base, vatRate: e.vatRate, vat: e.vat, total: e.total, notes: e.notes, receipt: Boolean(e.receipt) });
    }
    out.sort((a, c) => (c.date + (c.ref || c.id || '')).localeCompare(a.date + (a.ref || a.id || '')));
    const t = { ingresos: 0, ingresosBase: 0, ivaRepercutido: 0, gastos: 0, gastosBase: 0, ivaSoportado: 0 };
    const cats = {};
    for (const m of out) {
      if (m.kind === 'ingreso') { t.ingresos += m.total; t.ingresosBase += m.base; t.ivaRepercutido += m.vat; }
      else {
        t.gastos += m.total; t.gastosBase += m.base; t.ivaSoportado += m.vat;
        const c = cats[m.category] || (cats[m.category] = { total: 0, base: 0, vat: 0, n: 0 });
        c.total += m.total; c.base += m.base; c.vat += m.vat; c.n++;
      }
    }
    const r = (n) => Math.round(n * 100) / 100;
    for (const k of Object.keys(t)) t[k] = r(t[k]);
    for (const c of Object.values(cats)) { c.total = r(c.total); c.base = r(c.base); c.vat = r(c.vat); }
    t.beneficio = r(t.ingresosBase - t.gastosBase);
    t.ivaResultado = r(t.ivaRepercutido - t.ivaSoportado);
    for (const mv of out) mv.account = (PGC[mv.category] || ['629', 'Otros servicios'])[0];
    // IVA por tipo
    const byRate = (kind) => {
      const g = {};
      for (const mv of out.filter((x) => x.kind === kind)) {
        const k = String(mv.vatRate);
        const x = g[k] || (g[k] = { rate: mv.vatRate, base: 0, vat: 0 });
        x.base += mv.base; x.vat += mv.vat;
      }
      return Object.values(g).map((x) => ({ rate: x.rate, base: r(x.base), vat: r(x.vat) })).sort((a, c) => a.rate - c.rate);
    };
    return { from, to, movements: out, totals: t, byCategory: cats, unbilled: { n: unbilledN, total: r(unbilledSum) },
      vatByRate: { repercutido: byRate('ingreso'), soportado: byRate('gasto') } };
  }

  // Libros para el informe: registros de facturas, gastos por cuenta y libro diario
  function books(acc) {
    const r = (n) => Math.round(n * 100) / 100;
    const asc = acc.movements.slice().sort((a, c) => (a.date + (a.number || a.ref || a.id || '')).localeCompare(c.date + (c.number || c.ref || c.id || '')));
    const emitidas = asc.filter((m) => m.kind === 'ingreso');
    const recibidas = asc.filter((m) => m.kind === 'gasto').map((m) => Object.assign({}, m, { party: m.party ? m.party + ' · ' + m.concept : m.concept }));
    const accts = {};
    for (const m of recibidas) {
      const [code, name] = PGC[m.category] || ['629', 'Otros servicios'];
      const x = accts[code] || (accts[code] = { account: code, name, n: 0, base: 0, vat: 0, total: 0 });
      x.n++; x.base += m.base; x.vat += m.vat; x.total += m.total;
    }
    const expenseAccounts = Object.values(accts).map((x) => Object.assign(x, { base: r(x.base), vat: r(x.vat), total: r(x.total) })).sort((a, c) => a.account.localeCompare(c.account));
    // Asientos: factura (o ingreso) → 430 al debe; 705/759 y 477 al haber. Gasto → 6xx y 472 al debe; 410 al haber.
    // Las rectificativas (importes negativos) van al revés.
    const diario = [];
    let n = 0;
    for (const m of asc) {
      const [code, name] = PGC[m.category] || ['629', 'Otros servicios'];
      const neg = m.total < 0, T = Math.abs(m.total), B = Math.abs(m.base), V = Math.abs(m.vat);
      let lines;
      if (m.kind === 'ingreso') {
        lines = [{ account: '430', name: 'Clientes', debe: T }, { account: code, name, haber: B }];
        if (V) lines.push({ account: '477', name: 'Hacienda Pública, IVA repercutido', haber: V });
      } else {
        lines = [{ account: code, name, debe: B }];
        if (V) lines.push({ account: '472', name: 'Hacienda Pública, IVA soportado', debe: V });
        lines.push({ account: '410', name: 'Acreedores por prestaciones de servicios', haber: T });
      }
      if (neg) lines = lines.map((l) => ({ account: l.account, name: l.name, debe: l.haber, haber: l.debe }));
      diario.push({ n: ++n, date: m.date, concept: m.concept + (m.party ? ' · ' + m.party : ''), lines });
    }
    return { emitidas, recibidas, expenseAccounts, diario };
  }

  // ---------- la contraseña de la fase de pruebas ----------
  const TOKEN = KEY ? crypto.createHmac('sha256', KEY).update('bravo-preview-v1').digest('hex') : '';
  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }
  function authed(req) {
    if (!TOKEN) return false;
    const got = Buffer.from(cookies(req)[COOKIE] || '');
    const want = Buffer.from(TOKEN);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  function cookieHeader(req, value, maxAge) {
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  const GATE_HTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Bravo Transfers</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#15110d;color:#f6efe3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px;box-sizing:border-box}
.box{width:100%;max-width:340px;text-align:center}.sun{width:64px;height:32px;border-radius:64px 64px 0 0;background:linear-gradient(#f2b63d,#e0782a);margin:0 auto 14px}
h1{font-family:Georgia,serif;letter-spacing:.06em;margin:0 0 4px;font-size:1.6rem}p{color:#cbb994;margin:0 0 22px;font-size:.92rem}
input{width:100%;box-sizing:border-box;padding:14px;border-radius:10px;border:1px solid #6b5a3a;background:#221b14;color:#fff;font-size:16px;margin-bottom:12px}
button{width:100%;padding:14px;border:0;border-radius:10px;background:#d9a43a;color:#15110d;font-weight:700;font-size:16px}
#e{color:#ff9a8a;min-height:1.2em;margin-top:10px;font-size:.9rem}</style></head><body><form class="box" id="f">
<div class="sun"></div><h1>BRAVO TRANSFERS</h1><p>En preparación · Coming soon</p>
<input type="password" id="k" placeholder="Contraseña" autocomplete="current-password" required>
<button>Entrar</button><div id="e"></div></form><script>
document.getElementById('f').addEventListener('submit',async function(ev){ev.preventDefault();
var e=document.getElementById('e');e.textContent='';
try{var r=await fetch('/api/bravo/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:document.getElementById('k').value})});
if(r.ok){location.reload();return;}e.textContent=r.status===429?'Demasiados intentos. Espera un rato.':'Contraseña incorrecta.';}
catch(x){e.textContent='Sin conexión.';}});</script></body></html>`;

  // Páginas /bravo/...: si no hay contraseña, la puerta; si la hay, la página, sin caché ni Google.
  function allowPage(req, res) {
    if (!authed(req)) {
      res.writeHead(401, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, private',
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(GATE_HTML);
      return false;
    }
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (status, headers) => writeHead(status, Object.assign({}, headers, {
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow'
    }));
    return true;
  }

  // ---------- kilómetros por carretera (OSRM), calculados en el servidor ----------
  const routeCache = new Map();
  function getJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https:') ? https : http;
      const req = lib.get(url, { headers: { 'User-Agent': 'BravoTransfers/1.0' } }, (r) => {
        let body = '';
        r.setEncoding('utf8');
        r.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(new Error('too big')); });
        r.on('end', () => {
          if (r.statusCode !== 200) return reject(new Error('HTTP ' + r.statusCode));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }
  async function drive(a, b) {
    const k = [a.lat, a.lon, b.lat, b.lon].join(',');
    const hit = routeCache.get(k);
    if (hit && Date.now() - hit.at < 3600000) return hit.r;
    const data = await getJson(`${OSRM}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, 8000);
    const best = data && data.routes && data.routes[0];
    if (!best) return null;
    const r = { km: Math.round(best.distance / 100) / 10, minutes: Math.round(best.duration / 60) };
    routeCache.set(k, { at: Date.now(), r });
    if (routeCache.size > 2000) routeCache.delete(routeCache.keys().next().value);
    return r;
  }

  // ---------- el precio ----------
  function priceOptions(cfg, kind, km, hours, passengers, roundTrip) {
    return Object.entries(cfg.vehicles).map(([id, v]) => {
      let price;
      if (kind === 'hourly') price = Math.max(cfg.hourly.min, hours) * v.perHour;
      else price = Math.max(v.minFare, km * v.perKm) * (roundTrip ? 2 : 1);
      return { id, seats: v.seats, price: Math.ceil(price), fits: passengers <= v.seats };
    });
  }

  // ---------- la hora de Málaga ----------
  function madridMs(date, time) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    const t = /^(\d{2}):(\d{2})$/.exec(time || '');
    if (!m || !t) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date(guess))) parts[p.type] = p.value;
    const asMadrid = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return guess - (asMadrid - guess);
  }

  // Lee y comprueba un viaje (para el presupuesto y para la reserva)
  async function readTrip(d, cfg) {
    const kind = ['transfer', 'hourly'].includes(d.kind) ? d.kind : null;
    if (!kind) return { error: 'bad_kind' };
    const passengers = int(d.passengers, 1, 7);
    if (!passengers) return { error: 'bad_passengers' };
    const from = point(d.from, SPAIN_BOX);
    if (!from) return { error: 'bad_from' };
    if (!point(from, cfg.originBox)) return { error: 'origin_not_malaga' };
    if (kind === 'hourly') {
      const hours = int(d.hours, cfg.hourly.min, cfg.hourly.max);
      if (!hours) return { error: 'bad_hours' };
      return { kind, passengers, from, hours, options: priceOptions(cfg, kind, 0, hours, passengers, false) };
    }
    const to = point(d.to, SPAIN_BOX);
    if (!to) return { error: 'bad_to' };
    let route;
    try { route = await drive(from, to); } catch (e) { return { error: 'route_unavailable' }; }
    if (!route) return { error: 'no_route' };
    if (route.km < 0.5) return { error: 'same_place' };
    const roundTrip = Boolean(d.roundTrip);
    return {
      kind, passengers, from, to, roundTrip, km: route.km, minutes: route.minutes,
      options: priceOptions(cfg, kind, route.km, 0, passengers, roundTrip)
    };
  }

  function nextRef() {
    const file = path.join(DIR, 'counter.json');
    let n = 0;
    try { n = JSON.parse(fs.readFileSync(file, 'utf8')).n || 0; } catch (e) { /* primera */ }
    n++;
    fs.writeFileSync(file, JSON.stringify({ n }));
    return 'BT-' + String(n).padStart(4, '0');
  }
  function bookingFile(ref) { return path.join(BOOKINGS, ref + '.json'); }
  function saveBooking(b) {
    const f = bookingFile(b.ref);
    fs.writeFileSync(f + '.tmp', JSON.stringify(b, null, 1));
    fs.renameSync(f + '.tmp', f);
  }
  function allBookings() {
    const out = [];
    for (const f of fs.readdirSync(BOOKINGS).filter((n) => /^BT-\d+\.json$/.test(n))) {
      try { out.push(JSON.parse(fs.readFileSync(path.join(BOOKINGS, f), 'utf8'))); } catch (e) { /* roto: se salta */ }
    }
    return out;
  }

  function contact(d) {
    const name = clean(d.name, 80);
    const phone = clean(d.phone, 25);
    const email = clean(d.email, 120);
    if (name.length < 2) return { error: 'bad_name' };
    if (!/^\+?[0-9 ()-]{6,24}$/.test(phone)) return { error: 'bad_phone' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'bad_email' };
    return { name, phone, email };
  }

  // ---------- la API ----------
  async function handleApi(req, res, url) {
    const route = url.split('?')[0].replace(/^\/api\/bravo\//, '');
    const ip = getClientIp(req);

    if (req.method === 'POST' && route === 'login') {
      if (over('fail:' + ip, 10, 900000) || over('fail:all', 60, 3600000)) return json(res, 429, { error: 'too_many_attempts' });
      let key = '';
      try { key = String(JSON.parse(await readBody(req, 2000)).key || ''); } catch (e) { /* vacío */ }
      const a = Buffer.from(key), b = Buffer.from(KEY);
      if (!KEY || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        over('fail:' + ip, 10, 900000, true);
        over('fail:all', 60, 3600000, true);
        return json(res, 401, { error: 'wrong_key', key_configured: Boolean(KEY) });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, TOKEN, 30 * 86400) });
    }
    if (req.method === 'POST' && route === 'logout') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }

    // PDFs por enlace privado: el cliente y el conductor no tienen contraseña.
    // El enlace del cliente abre su justificante y su factura; el del conductor, solo su hoja.
    const anyInv = /^doc\/([a-f0-9]{32})\/f\/([FR]-\d{4}-\d{4,6})\.pdf$/.exec(route);
    if (req.method === 'GET' && anyInv) {
      if (over('doc:' + ip, 200, 3600000, true)) return json(res, 429, { error: 'too_many' });
      const b = allBookings().find((x) => x.clientToken === anyInv[1]);
      const inv = b && allInvoices(b).find((x) => x.number === anyInv[2]);
      if (!inv) return json(res, 404, { error: 'not_found' });
      const buf = pdf.invoicePdf(b, inv);
      res.writeHead(200, {
        'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Content-Disposition': 'inline; filename="' + inv.number + '.pdf"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff'
      });
      return res.end(buf);
    }
    const docm = /^doc\/([a-f0-9]{32})\/(justificante|factura|hoja)\.pdf$/.exec(route);
    if (req.method === 'GET' && docm) {
      if (over('doc:' + ip, 200, 3600000, true)) return json(res, 429, { error: 'too_many' });
      const [, tok, kind] = docm;
      const isDriver = kind === 'hoja';
      const b = allBookings().find((x) => (isDriver ? x.driverToken : x.clientToken) === tok);
      if (!b || (kind === 'factura' && !b.invoice)) return json(res, 404, { error: 'not_found' });
      const cfg0 = settings();
      const issuer = { name: cfg0.invoice.issuerName, email: cfg0.invoice.email, phone: cfg0.invoice.phone };
      const buf = kind === 'factura' ? pdf.invoicePdf(b) : kind === 'hoja' ? pdf.driverSheetPdf(b, issuer) : pdf.confirmationPdf(b, issuer);
      const name = (kind === 'factura' ? b.invoice.number : (kind === 'hoja' ? 'hoja-' : 'reserva-') + b.ref) + '.pdf';
      res.writeHead(200, {
        'Content-Type': 'application/pdf', 'Content-Length': buf.length,
        'Content-Disposition': 'inline; filename="' + name + '"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff'
      });
      return res.end(buf);
    }

    // Todo lo demás, solo con la contraseña (fase de pruebas)
    if (!authed(req)) return json(res, 401, { error: 'unauthorized' });
    const cfg = settings();

    if (req.method === 'GET' && route === 'config') {
      return json(res, 200, {
        vehicles: Object.fromEntries(Object.entries(cfg.vehicles).map(([id, v]) => [id, { seats: v.seats }])),
        minHoursAhead: cfg.minHoursAhead, hourly: cfg.hourly
      });
    }

    if (req.method === 'POST' && route === 'quote') {
      if (over('quote:' + ip, 120, 3600000, true)) return json(res, 429, { error: 'too_many' });
      let d;
      try { d = JSON.parse(await readBody(req, 4000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const trip = await readTrip(d, cfg);
      if (trip.error) return json(res, 400, trip);
      return json(res, 200, trip);
    }

    if (req.method === 'POST' && route === 'book') {
      if (over('book:' + ip, 20, 3600000) || over('book:all', 300, 86400000)) return json(res, 429, { error: 'too_many' });
      let d;
      try { d = JSON.parse(await readBody(req, 12000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const who = contact(d);
      if (who.error) return json(res, 400, who);
      const lang = d.lang === 'en' ? 'en' : 'es';
      const date = clean(d.date, 10), time = clean(d.time, 5);
      const when = madridMs(date, time);
      if (!when) return json(res, 400, { error: 'bad_date' });
      const base = {
        createdAt: new Date().toISOString(), lang, date, time, ...who,
        comments: cleanLong(d.comments, 1000),
        status: 'pendiente', driverName: '', driverPhone: '', driverPay: null, ministry: false, notes: '',
        payment: 'sin cobrar (pruebas)'
      };

      if (d.kind === 'group') {
        if (when < Date.now()) return json(res, 400, { error: 'too_soon' });
        const people = int(d.passengers, 1, 500);
        const fromText = clean(d.fromText, 160), toText = clean(d.toText, 160);
        if (!people) return json(res, 400, { error: 'bad_passengers' });
        if (!fromText || !toText) return json(res, 400, { error: 'bad_places' });
        over('book:' + ip, 20, 3600000, true); over('book:all', 300, 86400000, true);
        const b = Object.assign({ ref: nextRef(), kind: 'group', fromText, toText, passengers: people, price: null }, base);
        ensureTokens(b);
        saveBooking(b);
        return json(res, 200, { ref: b.ref, kind: 'group' });
      }

      if (when < Date.now() + cfg.minHoursAhead * 3600000) return json(res, 400, { error: 'too_soon', minHoursAhead: cfg.minHoursAhead });
      const trip = await readTrip(d, cfg);
      if (trip.error) return json(res, 400, trip);
      const opt = trip.options.find((o) => o.id === d.vehicle);
      if (!opt) return json(res, 400, { error: 'bad_vehicle' });
      if (!opt.fits) return json(res, 400, { error: 'too_many_passengers' });
      let returnDate = '', returnTime = '';
      if (trip.roundTrip) {
        returnDate = clean(d.returnDate, 10); returnTime = clean(d.returnTime, 5);
        const back = madridMs(returnDate, returnTime);
        if (!back || back <= when) return json(res, 400, { error: 'bad_return' });
      }
      over('book:' + ip, 20, 3600000, true); over('book:all', 300, 86400000, true);
      const b = Object.assign({
        ref: nextRef(), kind: trip.kind, from: trip.from, to: trip.to || null,
        roundTrip: Boolean(trip.roundTrip), returnDate, returnTime,
        hours: trip.hours || null, km: trip.km || null, minutes: trip.minutes || null,
        passengers: trip.passengers, vehicle: opt.id, price: opt.price,
        flight: clean(d.flight, 12), bags: int(d.bags, 0, 20) || 0, childSeats: int(d.childSeats, 0, 6) || 0
      }, base);
      ensureTokens(b);
      saveBooking(b);
      return json(res, 200, { ref: b.ref, kind: b.kind, price: b.price, km: b.km, doc: '/api/bravo/doc/' + b.clientToken + '/justificante.pdf' });
    }

    if (req.method === 'GET' && route === 'admin/bookings') {
      const list = allBookings().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      for (const b of list) if (ensureTokens(b)) saveBooking(b);
      return json(res, 200, { bookings: list });
    }

    if (route === 'admin/settings') {
      if (req.method === 'GET') {
        const s = settings();
        return json(res, 200, { vehicles: s.vehicles, minHoursAhead: s.minHoursAhead, invoice: s.invoice });
      }
      if (req.method === 'POST') {
        let d;
        try { d = JSON.parse(await readBody(req, 8000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const r = readSettings(d);
        if (r.error) return json(res, 400, r);
        const file = path.join(DIR, 'settings.json');
        fs.writeFileSync(file + '.tmp', JSON.stringify(r.settings, null, 1));
        fs.renameSync(file + '.tmp', file);
        const s = settings();
        return json(res, 200, { ok: true, vehicles: s.vehicles, minHoursAhead: s.minHoursAhead, invoice: s.invoice });
      }
    }

    if (route === 'admin/drivers') {
      if (req.method === 'GET') return json(res, 200, { drivers: drivers() });
      if (req.method === 'POST') {
        let d;
        try { d = JSON.parse(await readBody(req, 60000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        if (!Array.isArray(d.drivers) || d.drivers.length > 200) return json(res, 400, { error: 'bad_list' });
        const list = d.drivers.map((x) => ({
          id: /^[a-f0-9]{8}$/.test(x.id || '') ? x.id : crypto.randomBytes(4).toString('hex'),
          name: clean(x.name, 80), phone: clean(x.phone, 25), licence: clean(x.licence, 40),
          car: clean(x.car, 60), plate: clean(x.plate, 15), seats: int(x.seats, 1, 80) || null, notes: cleanLong(x.notes, 500)
        })).filter((x) => x.name);
        fs.writeFileSync(DRIVERS + '.tmp', JSON.stringify(list, null, 1));
        fs.renameSync(DRIVERS + '.tmp', DRIVERS);
        return json(res, 200, { ok: true, drivers: list });
      }
    }

    // Una reserva concreta, para las acciones de abajo
    async function loadRef() {
      let d;
      try { d = JSON.parse(await readBody(req, 6000)); } catch (e) { return { error: 'bad_json' }; }
      const ref = /^BT-\d{4,6}$/.test(d.ref || '') ? d.ref : null;
      let b = null;
      try { b = ref && JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8')); } catch (e) { /* no existe */ }
      if (!b) return { error: 'not_found' };
      return { d, b };
    }

    if (req.method === 'POST' && route === 'admin/invoice') {
      const r = await loadRef();
      if (r.error) return json(res, r.error === 'not_found' ? 404 : 400, r);
      const { d, b } = r;
      if (activeInvoice(b)) return json(res, 409, { error: 'already_invoiced', number: b.invoice.number });
      if (b.price == null || !(b.price > 0)) return json(res, 400, { error: 'no_price' });
      const vatRate = num(d.vatRate, 0, 30, 2);
      if (vatRate == null) return json(res, 400, { error: 'bad_vat' });
      const s = settings().invoice;
      const date = today();
      const total = Math.round(b.price * 100) / 100;
      const base = Math.round((total / (1 + vatRate / 100)) * 100) / 100;
      const previous = b.invoice ? [b.invoice].concat(b.previousInvoices || []) : (b.previousInvoices || []);
      b.invoice = {
        number: nextInvoiceNumber(date.slice(0, 4)), date, status: 'emitida', vatRate, total, base,
        vat: Math.round((total - base) * 100) / 100,
        issuer: { name: s.issuerName, taxId: s.taxId, address: s.address, email: s.email, phone: s.phone, footer: s.footer },
        customer: { name: clean(d.customerName, 120) || b.name, taxId: clean(d.customerTaxId, 30), address: cleanLong(d.customerAddress, 200), email: b.email },
        concept: pdf.concept(b), createdAt: new Date().toISOString()
      };
      if (previous.length) b.previousInvoices = previous;
      ensureTokens(b);
      saveBooking(b);
      return json(res, 200, { ok: true, booking: b });
    }

    // En España una factura no se borra ni se anula: se corrige con una factura rectificativa
    if (req.method === 'POST' && route === 'admin/invoice-rectify') {
      const r = await loadRef();
      if (r.error) return json(res, r.error === 'not_found' ? 404 : 400, r);
      const { d, b } = r;
      if (!activeInvoice(b)) return json(res, 400, { error: 'no_invoice' });
      const orig = b.invoice, date = today();
      const cn = {
        kind: 'rectificativa', number: nextInvoiceNumber(date.slice(0, 4), 'R'), date, status: 'emitida',
        rectifies: orig.number, rectifiesDate: orig.date, reason: clean(d.reason, 200) || 'Anulación de la factura',
        vatRate: orig.vatRate, base: -orig.base, vat: -orig.vat, total: -orig.total, issuer: orig.issuer, customer: orig.customer,
        concept: 'Rectificación de la factura ' + orig.number + ' / Correction of invoice ' + orig.number + ': ' + (orig.concept || ''),
        createdAt: new Date().toISOString()
      };
      orig.status = 'rectificada';
      orig.rectifiedBy = cn.number;
      b.creditNotes = (b.creditNotes || []).concat([cn]);
      b.previousInvoices = [orig].concat(b.previousInvoices || []);
      b.invoice = null;
      saveBooking(b);
      return json(res, 200, { ok: true, booking: b, creditNote: cn.number });
    }

    if (req.method === 'POST' && route === 'admin/delete') {
      const r = await loadRef();
      if (r.error) return json(res, r.error === 'not_found' ? 404 : 400, r);
      if (allInvoices(r.b).length) return json(res, 409, { error: 'has_invoice' });
      fs.unlinkSync(bookingFile(r.b.ref));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && route === 'admin/export.csv') {
      const month = new URL(url, 'http://x').searchParams.get('month') || today().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return json(res, 400, { error: 'bad_month' });
      const n2 = (v) => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100).replace('.', ','));
      const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['Reserva', 'Día', 'Hora', 'Tipo', 'Desde', 'Hasta', 'Personas', 'Vehículo', 'Km', 'Cliente', 'Teléfono', 'Correo',
        'Precio', 'Conductor', 'Pago al conductor', 'Te queda', 'Estado', 'Factura', 'Fecha factura', 'Estado factura', 'Base', 'IVA %', 'IVA', 'Total factura'];
      const lines = [head.map(q).join(';')];
      for (const b of allBookings().filter((x) => x.date.slice(0, 7) === month).sort((a, c) => (a.date + a.time).localeCompare(c.date + c.time))) {
        const inv = b.invoice || {};
        const from = b.kind === 'group' ? b.fromText : (b.from && b.from.label) || '';
        const to = b.kind === 'group' ? b.toText : b.kind === 'hourly' ? b.hours + ' h' : (b.to && b.to.label) || '';
        lines.push([b.ref, b.date, b.time, b.kind === 'group' ? 'Grupo' : b.kind === 'hourly' ? 'Por horas' : (b.roundTrip ? 'Ida y vuelta' : 'Traslado'),
          from, to, b.passengers, b.vehicle === 'van' ? 'Monovolumen' : b.vehicle === 'car' ? 'Coche' : '', n2(b.km), b.name, b.phone, b.email,
          n2(b.price), b.driverName, n2(b.driverPay), b.price != null && b.driverPay != null ? n2(b.price - b.driverPay) : '', b.status,
          inv.number || '', inv.date || '', inv.status || '', n2(inv.base), n2(inv.vatRate), n2(inv.vat), n2(inv.total)].map(q).join(';'));
      }
      const body = '\ufeff' + lines.join('\r\n') + '\r\n';
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bravo-' + month + '.csv"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow'
      });
      return res.end(body);
    }

    if (req.method === 'POST' && route === 'admin/update') {
      let d;
      try { d = JSON.parse(await readBody(req, 6000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const ref = /^BT-\d{4,6}$/.test(d.ref || '') ? d.ref : null;
      let b = null;
      try { b = ref && JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8')); } catch (e) { /* no existe */ }
      if (!b) return json(res, 404, { error: 'not_found' });
      if (d.status !== undefined) {
        if (!STATUSES.includes(d.status)) return json(res, 400, { error: 'bad_status' });
        b.status = d.status;
      }
      if (d.driverName !== undefined) b.driverName = clean(d.driverName, 80);
      if (d.driverPhone !== undefined) b.driverPhone = clean(d.driverPhone, 25);
      if (d.driverPay !== undefined) {
        if (d.driverPay === null || d.driverPay === '') b.driverPay = null;
        else {
          const pay = Math.round(Number(d.driverPay) * 100) / 100;
          if (!Number.isFinite(pay) || pay < 0 || pay > 100000) return json(res, 400, { error: 'bad_pay' });
          b.driverPay = pay;
        }
      }
      if (d.ministry !== undefined) b.ministry = Boolean(d.ministry);
      if (d.notes !== undefined) b.notes = cleanLong(d.notes, 2000);
      if (d.driverNote !== undefined) b.driverNote = cleanLong(d.driverNote, 500);
      if (d.driverVat !== undefined) {
        const v = num(d.driverVat, 0, 30, 2);
        if (v == null) return json(res, 400, { error: 'bad_vat' });
        b.driverVat = v;
      }
      if (d.driverCar !== undefined) b.driverCar = clean(d.driverCar, 80);
      if (d.price !== undefined) {
        const p = d.price === '' || d.price === null ? null : num(d.price, 0, 100000, 2);
        if (p === null && !(d.price === '' || d.price === null)) return json(res, 400, { error: 'bad_price' });
        if (p !== b.price) {
          if (activeInvoice(b)) return json(res, 409, { error: 'invoiced' });
          b.price = p;
        }
      }
      b.updatedAt = new Date().toISOString();
      saveBooking(b);
      return json(res, 200, { ok: true, booking: b });
    }

    // ---------- contabilidad ----------
    if (req.method === 'GET' && route === 'admin/accounts.pdf') {
      const sp = new URL(url, 'http://x').searchParams;
      const from = sp.get('from'), to = sp.get('to');
      if (!isDay(from) || !isDay(to) || from > to) return json(res, 400, { error: 'bad_range' });
      const acc = movements(from, to);
      const s0 = settings().invoice;
      const buf = pdf.accountsPdf(Object.assign({ generated: today() }, acc, books(acc)), { name: s0.issuerName, taxId: s0.taxId });
      res.writeHead(200, {
        'Content-Type': 'application/pdf', 'Content-Length': buf.length,
        'Content-Disposition': 'inline; filename="bravo-contabilidad-' + from + '-a-' + to + '.pdf"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow'
      });
      return res.end(buf);
    }

    if (req.method === 'GET' && (route === 'admin/accounts' || route === 'admin/accounts.csv')) {
      const sp = new URL(url, 'http://x').searchParams;
      const from = sp.get('from'), to = sp.get('to');
      if (!isDay(from) || !isDay(to) || from > to) return json(res, 400, { error: 'bad_range' });
      const acc = movements(from, to);
      if (route === 'admin/accounts') return json(res, 200, Object.assign({ expenseCats: EXPENSE_CATS, incomeCats: INCOME_CATS }, acc));
      const n2 = (v) => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100).replace('.', ','));
      const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const ORIGIN = { factura: 'Factura de la web', rectificativa: 'Factura rectificativa', conductor: 'Reserva (pago al conductor)', manual: 'Apuntado a mano' };
      const lines = [['Fecha', 'Tipo', 'Nº factura', 'Concepto', 'Proveedor / cliente', 'NIF', 'Categoría', 'Cuenta PGC', 'Base', 'IVA %', 'IVA', 'Total', 'Origen', 'Reserva', 'Notas'].map(q).join(';')];
      for (const m of acc.movements.slice().reverse()) {
        lines.push([m.date, m.kind === 'ingreso' ? 'Ingreso' : 'Gasto', m.number || '', m.concept, m.party, m.taxId || '', m.category, m.account, n2(m.base), n2(m.vatRate), n2(m.vat), n2(m.total),
          ORIGIN[m.source], m.ref || '', m.notes || ''].map(q).join(';'));
      }
      const t = acc.totals;
      lines.push('');
      for (const [k, v] of [['Ingresos (con IVA)', t.ingresos], ['Gastos (con IVA)', t.gastos], ['Beneficio (sin IVA)', t.beneficio],
        ['IVA cobrado (repercutido)', t.ivaRepercutido], ['IVA pagado (soportado)', t.ivaSoportado], ['IVA a pagar (+) o a devolver (-)', t.ivaResultado]]) {
        lines.push([q(k), q(n2(v))].join(';'));
      }
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bravo-cuentas-' + from + '-a-' + to + '.csv"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow'
      });
      return res.end('\ufeff' + lines.join('\r\n') + '\r\n');
    }

    if (req.method === 'POST' && route === 'admin/ledger/save') {
      let d;
      try { d = JSON.parse(await readBody(req, 9000000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const type = d.type === 'ingreso' ? 'ingreso' : d.type === 'gasto' ? 'gasto' : null;
      if (!type) return json(res, 400, { error: 'bad_type' });
      const cats = type === 'gasto' ? EXPENSE_CATS : INCOME_CATS;
      if (!cats.includes(d.category)) return json(res, 400, { error: 'bad_category' });
      if (!isDay(d.date)) return json(res, 400, { error: 'bad_date' });
      const concept = clean(d.concept, 120);
      if (!concept) return json(res, 400, { error: 'bad_concept' });
      const total = num(d.total, 0.01, 1000000, 2);
      if (total == null) return json(res, 400, { error: 'bad_total' });
      const vatRate = num(d.vatRate, 0, 30, 2);
      if (vatRate == null) return json(res, 400, { error: 'bad_vat' });
      const list = ledger();
      let e = d.id ? list.find((x) => x.id === d.id) : null;
      if (d.id && !e) return json(res, 404, { error: 'not_found' });
      if (!e) { e = { id: crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString(), receipt: null }; list.push(e); }
      Object.assign(e, { type, date: d.date, concept, party: clean(d.party, 80), number: clean(d.number, 40), taxId: clean(d.taxId, 30), category: d.category, total, vatRate, notes: cleanLong(d.notes, 500), updatedAt: new Date().toISOString() }, splitVat(total, vatRate));
      if (d.removeReceipt) { removeReceipt(e); e.receipt = null; }
      if (d.receipt && typeof d.receipt.data === 'string') {
        const buf = Buffer.from(d.receipt.data, 'base64');
        if (buf.length > 6 * 1024 * 1024) return json(res, 400, { error: 'receipt_too_big' });
        const ext = sniff(buf);
        if (!ext) return json(res, 400, { error: 'receipt_type' });
        removeReceipt(e);
        const file = e.id + '.' + ext;
        fs.writeFileSync(path.join(RECEIPTS, file), buf);
        e.receipt = { file, name: clean(d.receipt.name, 80) || file, size: buf.length };
      }
      saveLedger(list);
      return json(res, 200, { ok: true, entry: e });
    }

    if (req.method === 'POST' && route === 'admin/ledger/delete') {
      let d;
      try { d = JSON.parse(await readBody(req, 2000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const list = ledger();
      const e = list.find((x) => x.id === d.id);
      if (!e) return json(res, 404, { error: 'not_found' });
      removeReceipt(e);
      saveLedger(list.filter((x) => x !== e));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && route === 'admin/ledger/entry') {
      const id = new URL(url, 'http://x').searchParams.get('id');
      const e = ledger().find((x) => x.id === id);
      if (!e) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { entry: e });
    }

    if (req.method === 'GET' && route === 'admin/ledger/receipt') {
      const id = new URL(url, 'http://x').searchParams.get('id');
      const e = ledger().find((x) => x.id === id);
      if (!e || !e.receipt) return json(res, 404, { error: 'not_found' });
      let buf;
      try { buf = fs.readFileSync(path.join(RECEIPTS, e.receipt.file)); } catch (err) { return json(res, 404, { error: 'not_found' }); }
      const ext = e.receipt.file.split('.').pop();
      res.writeHead(200, {
        'Content-Type': RECEIPT_TYPES[ext] || 'application/octet-stream', 'Content-Length': buf.length,
        'Content-Disposition': 'inline; filename="' + e.receipt.file + '"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff'
      });
      return res.end(buf);
    }

    return json(res, 404, { error: 'not_found' });
  }

  return { allowPage, handleApi };
};
