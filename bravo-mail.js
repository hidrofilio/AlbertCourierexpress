// Bravo Transfers — correos automáticos a los clientes (y avisos a Alberto).
//
// Se mandan por la API de un servicio de envío (por HTTPS, sin dependencias):
//   EMAIL_API  = 'brevo' (por defecto) o 'resend'
//   EMAIL_KEY  = la clave del servicio (variable de Railway; NUNCA en este repo)
//   EMAIL_FROM = el remitente (por defecto info@albertcourierexpress.com, verificado en el servicio)
// Sin EMAIL_KEY no se manda nada: el correo queda como «pendiente» y se reenvía desde el panel.
// BRAVO_EMAIL_URL apunta a un servidor falso en las pruebas.
'use strict';
const http = require('http');
const https = require('https');

module.exports = function createMail() {
  const api = (process.env.EMAIL_API || 'brevo').toLowerCase() === 'resend' ? 'resend' : 'brevo';
  const key = process.env.EMAIL_KEY || '';
  const fake = process.env.BRAVO_EMAIL_URL || '';
  const from = process.env.EMAIL_FROM || 'info@albertcourierexpress.com';
  const fromName = process.env.EMAIL_FROM_NAME || 'Bravo Transfers';
  const owner = process.env.EMAIL_OWNER || from; // a quién avisar de mensajes y cancelaciones

  function configured() { return Boolean(key || fake); }

  function post(url, headers, body) {
    return new Promise((resolve) => {
      const u = new URL(url);
      const lib = u.protocol === 'http:' ? http : https;
      const data = Buffer.from(JSON.stringify(body));
      const req = lib.request({ method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
        headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': data.length }, headers) }, (res) => {
        let txt = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (txt.length < 4000) txt += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: txt }));
      });
      req.setTimeout(12000, () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ status: 0, body: e.message }));
      req.end(data);
    });
  }

  // m = { to, toName, subject, html, text, attachments: [{ name, buf }], replyTo }
  async function send(m) {
    if (!configured()) return { ok: false, error: 'not_configured' };
    const att = (m.attachments || []).filter(Boolean);
    let r;
    if (api === 'resend') {
      r = await post(fake || 'https://api.resend.com/emails', { Authorization: 'Bearer ' + key }, {
        from: `${fromName} <${from}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text,
        reply_to: m.replyTo || owner, attachments: att.map((a) => ({ filename: a.name, content: a.buf.toString('base64') }))
      });
    } else {
      const body = {
        sender: { name: fromName, email: from }, to: [{ email: m.to, name: m.toName || m.to }], subject: m.subject,
        htmlContent: m.html, textContent: m.text, replyTo: { email: m.replyTo || owner }
      };
      if (att.length) body.attachment = att.map((a) => ({ name: a.name, content: a.buf.toString('base64') }));
      r = await post(fake || 'https://api.brevo.com/v3/smtp/email', { 'api-key': key }, body);
    }
    const ok = r.status >= 200 && r.status < 300;
    return ok ? { ok: true } : { ok: false, error: 'HTTP ' + r.status + ' ' + String(r.body).slice(0, 200) };
  }

  return { send, configured, owner, provider: api };
};

// ---------- plantillas ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ',') + ' €';
const dmy = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || ''); };

const L = {
  es: {
    hello: 'Hola', thanks: 'Gracias por reservar con Bravo Transfers. Estos son los datos de tu reserva:',
    thanksGroup: 'Hemos recibido tu petición de presupuesto para un grupo. Te lo enviaremos lo antes posible.',
    update: 'Te enviamos los datos actualizados de tu reserva:',
    subject: 'Tu reserva {ref} con Bravo Transfers', subjectGroup: 'Tu petición de presupuesto {ref} · Bravo Transfers', subjectUpdate: 'Tu reserva {ref}: datos actualizados',
    ref: 'Reserva', when: 'Día y hora', from: 'Desde', to: 'Hasta', pickup: 'Recogida', hours: 'Horas', ret: 'Vuelta', pax: 'Pasajeros',
    veh: 'Vehículo', flight: 'Vuelo', driver: 'Conductor', car: 'Coche', total: 'Total (IVA incluido)', paid: 'Pago', quote: 'Presupuesto pendiente',
    attached: 'Te adjuntamos la factura y el justificante en PDF.', attachedOne: 'Te adjuntamos el justificante en PDF.',
    driverLater: 'Antes del viaje te enviaremos el nombre de tu conductor, el coche y la matrícula.',
    area: 'Tu área de cliente', areaText: 'Ahí puedes ver tus reservas y tus facturas, cancelar o pedir un cambio, y escribirnos.',
    user: 'Usuario', pass: 'Contraseña', enter: 'Entrar en mi área de cliente', cancel: 'Cancelación gratis hasta {h} horas antes del viaje.',
    questions: '¿Dudas? Responde a este correo o escríbenos por WhatsApp.', bye: 'Buen viaje,', test: 'Versión de prueba: no se ha cobrado nada.',
    car_v: 'Coche (hasta 4)', van_v: 'Monovolumen (hasta 7)',
    loginSubject: 'Tu enlace para entrar · Bravo Transfers', loginText: 'Pulsa el botón para entrar en tu área de cliente. El enlace vale para una sola vez y caduca en {h} horas.',
    msgSubject: 'Tienes un mensaje de Bravo Transfers', msgText: 'Te hemos contestado en tu área de cliente:', read: 'Leer y contestar'
  },
  en: {
    hello: 'Hi', thanks: 'Thank you for booking with Bravo Transfers. Here are your booking details:',
    thanksGroup: 'We have received your group quote request. We will send you a quote as soon as possible.',
    update: 'Here are the updated details of your booking:',
    subject: 'Your booking {ref} with Bravo Transfers', subjectGroup: 'Your quote request {ref} · Bravo Transfers', subjectUpdate: 'Your booking {ref}: updated details',
    ref: 'Booking', when: 'Date and time', from: 'From', to: 'To', pickup: 'Pick-up', hours: 'Hours', ret: 'Return', pax: 'Passengers',
    veh: 'Vehicle', flight: 'Flight', driver: 'Driver', car: 'Car', total: 'Total (VAT included)', paid: 'Payment', quote: 'Quote pending',
    attached: 'Your invoice and booking confirmation are attached as PDF files.', attachedOne: 'Your booking confirmation is attached as a PDF file.',
    driverLater: 'Before your trip we will send you your driver’s name, the car and its number plate.',
    area: 'Your customer area', areaText: 'There you can see your bookings and invoices, cancel or ask for a change, and message us.',
    user: 'User', pass: 'Password', enter: 'Go to my customer area', cancel: 'Free cancellation up to {h} hours before the trip.',
    questions: 'Any questions? Reply to this email or message us on WhatsApp.', bye: 'Have a good trip,', test: 'Test version: nothing has been charged.',
    car_v: 'Car (up to 4)', van_v: 'People carrier (up to 7)',
    loginSubject: 'Your sign-in link · Bravo Transfers', loginText: 'Tap the button to sign in to your customer area. The link works once and expires in {h} hours.',
    msgSubject: 'You have a message from Bravo Transfers', msgText: 'We have replied in your customer area:', read: 'Read and reply'
  }
};

function shell(lang, inner, base) {
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#faf6ee;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#17120d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ee;padding:16px 8px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e7dccb">
<tr><td style="padding:18px 20px;border-bottom:3px solid #e5b44b">
<img src="${base}/api/bravo/logo.png" width="72" alt="" style="vertical-align:middle;border:0">
<span style="font-family:Georgia,serif;font-size:22px;font-weight:bold;letter-spacing:2px;vertical-align:middle;margin-left:8px">BRAVO</span>
<span style="font-size:10px;letter-spacing:4px;color:#df7a2c;vertical-align:middle">TRANSFERS</span></td></tr>
<tr><td style="padding:20px">${inner}</td></tr>
<tr><td style="padding:14px 20px;border-top:1px solid #e7dccb;font-size:12px;color:#6f6252">Bravo Transfers · Málaga · <a href="https://wa.me/353874592308" style="color:#6f6252">WhatsApp</a></td></tr>
</table></td></tr></table></body></html>`;
}
const btn = (url, label) => `<p style="margin:18px 0"><a href="${esc(url)}" style="background:#17120d;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold;display:inline-block">${esc(label)}</a></p>`;

// Correo de la reserva (al reservar, o con los datos actualizados desde el panel)
function bookingEmail(b, o) {
  const t = L[b.lang === 'en' ? 'en' : 'es'];
  const group = b.kind === 'group';
  const from = group ? b.fromText : (b.from && b.from.label) || '';
  const to = group ? b.toText : (b.to && b.to.label) || '';
  const rows = [
    [t.ref, b.ref], [t.when, dmy(b.date) + ' · ' + b.time],
    [b.kind === 'hourly' ? t.pickup : t.from, from], [b.kind === 'hourly' ? t.hours : t.to, b.kind === 'hourly' ? String(b.hours) : to],
    [t.ret, b.roundTrip ? dmy(b.returnDate) + ' · ' + b.returnTime : ''], [t.pax, String(b.passengers)],
    [t.veh, b.vehicle === 'van' ? t.van_v : b.vehicle === 'car' ? t.car_v : ''], [t.flight, b.flight || ''],
    [t.driver, (b.chauffeur || b.driverName) && ['asignada', 'hecha'].includes(b.status) ? (b.chauffeur || b.driverName) + ((b.chauffeur ? b.chauffeurPhone || b.driverPhone : b.driverPhone) ? ' · ' + (b.chauffeur ? b.chauffeurPhone || b.driverPhone : b.driverPhone) : '') : ''],
    [t.car, b.driverCar && ['asignada', 'hecha'].includes(b.status) ? b.driverCar : ''],
    [t.total, b.price != null ? money(b.price) : t.quote], [t.paid, b.payment || '']
  ].filter((r) => r[1]);
  const table = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:12px 0">' +
    rows.map((r) => `<tr><td style="padding:7px 8px;color:#6f6252;border-bottom:1px solid #f0e8da;width:38%">${esc(r[0])}</td><td style="padding:7px 8px;border-bottom:1px solid #f0e8da;${r[0] === t.total ? 'font-weight:bold;font-size:16px' : ''}">${esc(r[1])}</td></tr>`).join('') + '</table>';
  const intro = o.update ? t.update : group ? t.thanksGroup : t.thanks;
  let html = `<p style="font-size:16px;margin:0 0 6px">${esc(t.hello)} ${esc(b.name)},</p><p style="margin:0 0 6px">${esc(intro)}</p>${table}`;
  html += `<p style="margin:10px 0">${esc(o.withInvoice ? t.attached : t.attachedOne)}</p>`;
  if (!group && !b.driverName && !b.chauffeur) html += `<p style="margin:10px 0">${esc(t.driverLater)}</p>`;
  html += `<div style="background:#faf6ee;border-radius:10px;padding:12px 14px;margin:16px 0"><b>${esc(t.area)}</b><p style="margin:6px 0">${esc(t.areaText)}</p>`;
  if (o.password) html += `<p style="margin:6px 0">${esc(t.user)}: <b>${esc(b.email)}</b><br>${esc(t.pass)}: <b style="font-family:monospace;font-size:15px">${esc(o.password)}</b></p>`;
  html += btn(o.areaUrl, t.enter) + '</div>';
  if (!group) html += `<p style="margin:10px 0;color:#6f6252">${esc(t.cancel.replace('{h}', o.cancelHours))}</p>`;
  html += `<p style="margin:10px 0">${esc(t.questions)}</p><p style="margin:10px 0">${esc(t.bye)}<br>Bravo Transfers</p>`;
  if (o.test) html += `<p style="margin:10px 0;color:#df7a2c;font-size:12px">${esc(t.test)}</p>`;
  const text = [t.hello + ' ' + b.name + ',', '', intro, '']
    .concat(rows.map((r) => r[0] + ': ' + r[1]), ['', o.withInvoice ? t.attached : t.attachedOne, '', t.area + ': ' + o.areaUrl])
    .concat(o.password ? [t.user + ': ' + b.email, t.pass + ': ' + o.password] : [])
    .concat(['', t.questions, '', t.bye, 'Bravo Transfers']).join('\n');
  const subject = (o.update ? t.subjectUpdate : group ? t.subjectGroup : t.subject).replace('{ref}', b.ref);
  return { subject, html: shell(b.lang === 'en' ? 'en' : 'es', html, o.base), text };
}

function loginEmail(c, o) {
  const t = L[c.lang === 'en' ? 'en' : 'es'];
  const html = `<p style="font-size:16px;margin:0 0 6px">${esc(t.hello)}${c.name ? ' ' + esc(c.name) : ''},</p><p>${esc(t.loginText.replace('{h}', o.hours))}</p>${btn(o.url, t.enter)}`;
  return { subject: t.loginSubject, html: shell(c.lang === 'en' ? 'en' : 'es', html, o.base), text: t.loginText.replace('{h}', o.hours) + '\n\n' + o.url };
}

function messageEmail(c, text, o) {
  const t = L[c.lang === 'en' ? 'en' : 'es'];
  const html = `<p style="font-size:16px;margin:0 0 6px">${esc(t.hello)}${c.name ? ' ' + esc(c.name) : ''},</p><p>${esc(t.msgText)}</p>` +
    `<div style="background:#faf6ee;border-radius:10px;padding:12px 14px;white-space:pre-wrap">${esc(text)}</div>${btn(o.url, t.read)}`;
  return { subject: t.msgSubject, html: shell(c.lang === 'en' ? 'en' : 'es', html, o.base), text: t.msgText + '\n\n' + text + '\n\n' + o.url };
}

// Aviso a Alberto (siempre en español)
function ownerEmail(subject, lines, o) {
  const html = `<p style="margin:0 0 8px"><b>${esc(subject)}</b></p>` + lines.map((l) => `<p style="margin:4px 0;white-space:pre-wrap">${esc(l)}</p>`).join('') + btn(o.url, 'Abrir el panel');
  return { subject: 'Bravo Transfers — ' + subject, html: shell('es', html, o.base), text: lines.join('\n') + '\n\n' + o.url };
}

// Al conductor o al proveedor, cuando se le paga: el justificante de pago (y su hoja o su factura)
const VIA = { banco: 'por transferencia', tarjeta: 'con tarjeta', efectivo: 'en efectivo', bizum: 'por Bizum' };
function paymentEmail(p, o) {
  const first = String(p.payee.name || '').split(' ')[0];
  const rows = p.lines.map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(l.concept)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(l.total)}</td></tr>`).join('');
  const extra = [p.kind === 'driver' ? 'la hoja de servicio' : '', p.attachTheirs ? 'tu factura' + (p.theirInvoice ? ' nº ' + p.theirInvoice : '') : ''].filter(Boolean);
  const att = 'Te adjuntamos el justificante de pago en PDF' + (extra.length ? ' y ' + extra.join(' y ') : '') + '.';
  const html = `<p style="font-size:16px;margin:0 0 6px">Hola${first ? ' ' + esc(first) : ''},</p>` +
    `<p>Te hemos pagado <b>${money(p.total)}</b> el ${dmy(p.paid.date)} ${esc(VIA[p.paid.via] || '')}.</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:8px 0">${rows}` +
    `<tr><td style="padding:8px;font-weight:bold">Total pagado</td><td style="padding:8px;text-align:right;font-weight:bold;white-space:nowrap">${money(p.total)}</td></tr></table>` +
    `<p>${esc(att)}</p>` + (p.kind === 'driver' ? '<p>Gracias por el servicio.</p>' : '<p>Gracias.</p>') +
    `<p style="margin:10px 0">Un saludo,<br>Bravo Transfers</p>`;
  const text = [`Hola${first ? ' ' + first : ''},`, '', `Te hemos pagado ${money(p.total)} el ${dmy(p.paid.date)} ${VIA[p.paid.via] || ''}.`, '']
    .concat(p.lines.map((l) => '- ' + l.concept + ': ' + money(l.total)), ['', att, '', 'Un saludo,', 'Bravo Transfers']).join('\n');
  return { subject: `Pago de ${money(p.total)} · Bravo Transfers` + (p.ref ? ' · ' + p.ref : ''), html: shell('es', html, o.base), text };
}

// ---------- avisos automáticos ----------
const R = {
  es: {
    remSubject: 'Mañana: tu traslado {ref}', remIntro: 'Te recordamos tu traslado de mañana:', when: 'Día y hora', from: 'Recogida', to: 'Destino', hours: 'Horas',
    pax: 'Pasajeros', flight: 'Vuelo', driver: 'Tu conductor', car: 'Coche', later: 'En cuanto tengamos el conductor, te mandamos su nombre, el coche y la matrícula.',
    help: '¿Algún cambio? Escríbenos por WhatsApp o desde tu cuenta.', area: 'Ver mi reserva', bye: 'Buen viaje,',
    revSubject: '¿Qué tal tu viaje con Bravo Transfers?', revText: 'Gracias por viajar con nosotros. Si te ha gustado, ¿nos dejas tu opinión en Google? Son dos minutos y nos ayuda mucho.',
    revBtn: 'Dejar mi opinión', revBad: 'Si algo no fue bien, contéstanos a este correo y lo arreglamos.', thanks: 'Gracias,'
  },
  en: {
    remSubject: 'Tomorrow: your transfer {ref}', remIntro: 'A reminder of your transfer tomorrow:', when: 'Date and time', from: 'Pick-up', to: 'Drop-off', hours: 'Hours',
    pax: 'Passengers', flight: 'Flight', driver: 'Your driver', car: 'Car', later: 'As soon as we have your driver, we will send you their name, the car and its number plate.',
    help: 'Any changes? Message us on WhatsApp or from your account.', area: 'See my booking', bye: 'Have a good trip,',
    revSubject: 'How was your trip with Bravo Transfers?', revText: 'Thank you for travelling with us. If you liked it, would you leave us a review on Google? It takes two minutes and helps us a lot.',
    revBtn: 'Leave a review', revBad: 'If something went wrong, reply to this email and we will put it right.', thanks: 'Thank you,'
  }
};
function rowsHtml(rows) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:8px 0">' +
    rows.filter((r) => r[1]).map((r) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#6f6252;width:38%">${esc(r[0])}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(r[1])}</td></tr>`).join('') + '</table>';
}
const who = (b) => b.chauffeur || b.driverName || '';
const whoPhone = (b) => (b.chauffeur ? b.chauffeurPhone || b.driverPhone : b.driverPhone) || '';
// Al cliente, el día antes
function reminderEmail(b, o) {
  const lang = b.lang === 'en' ? 'en' : 'es', t = R[lang];
  const from = (b.from && b.from.label) || b.fromText || '', to = (b.to && b.to.label) || b.toText || '';
  const rows = [[t.when, dmy(b.date) + ' · ' + b.time], [t.from, from], [b.kind === 'hourly' ? t.hours : t.to, b.kind === 'hourly' ? String(b.hours) : to], [t.pax, String(b.passengers)], [t.flight, b.flight],
    [t.driver, who(b) ? who(b) + (whoPhone(b) ? ' · ' + whoPhone(b) : '') : ''], [t.car, who(b) ? b.driverCar : '']];
  const html = `<p style="font-size:16px;margin:0 0 6px">${esc(L[lang].hello)} ${esc(String(b.name || '').split(' ')[0])},</p><p>${esc(t.remIntro)}</p>` + rowsHtml(rows) +
    (who(b) ? '' : `<p>${esc(t.later)}</p>`) + `<p>${esc(t.help)}</p>` + (o.areaUrl ? btn(o.areaUrl, t.area) : '') + `<p style="margin:10px 0">${esc(t.bye)}<br>Bravo Transfers</p>`;
  const text = [L[lang].hello + ' ' + String(b.name || '').split(' ')[0] + ',', '', t.remIntro, ''].concat(rows.filter((r) => r[1]).map((r) => r[0] + ': ' + r[1]),
    ['', who(b) ? '' : t.later, t.help, o.areaUrl || '', '', t.bye, 'Bravo Transfers']).join('\n');
  return { subject: t.remSubject.replace('{ref}', b.ref), html: shell(lang, html, o.base), text };
}
// Al cliente, el día después: su opinión en Google
function reviewEmail(b, o) {
  const lang = b.lang === 'en' ? 'en' : 'es', t = R[lang];
  const html = `<p style="font-size:16px;margin:0 0 6px">${esc(L[lang].hello)} ${esc(String(b.name || '').split(' ')[0])},</p><p>${esc(t.revText)}</p>` + btn(o.reviewUrl, t.revBtn) +
    `<p style="color:#6f6252">${esc(t.revBad)}</p><p style="margin:10px 0">${esc(t.thanks)}<br>Bravo Transfers</p>`;
  const text = [L[lang].hello + ' ' + String(b.name || '').split(' ')[0] + ',', '', t.revText, o.reviewUrl, '', t.revBad, '', t.thanks, 'Bravo Transfers'].join('\n');
  return { subject: t.revSubject, html: shell(lang, html, o.base), text };
}
// A la empresa de transporte: el servicio nuevo (al asignarlo) o el de mañana (la víspera), con su hoja
function companyEmail(b, o) {
  const tomorrow = o.kind === 'tomorrow';
  const from = (b.from && b.from.label) || b.fromText || '', to = (b.to && b.to.label) || b.toText || '';
  const rows = [['Día y hora', dmy(b.date) + ' · ' + b.time], ['Recogida', from], [b.kind === 'hourly' ? 'Horas' : 'Destino', b.kind === 'hourly' ? String(b.hours) : to],
    ['Vuelta', b.roundTrip ? dmy(b.returnDate) + ' · ' + b.returnTime : ''], ['Pasajeros', String(b.passengers)], ['Vuelo', b.flight],
    ['Maletas', b.kind === 'group' ? '' : String(b.bags || 0) + (b.childSeats ? ' · sillas de niño: ' + b.childSeats : '')],
    ['Cliente', b.name + (b.phone ? ' · ' + b.phone : '')], ['Conductor', b.chauffeur || ''], ['Nota', b.driverNote], ['Se te paga', b.driverPay != null ? money(b.driverPay) : '']];
  const intro = tomorrow ? 'Te recordamos el servicio de mañana:' : 'Te asignamos este servicio de Bravo Transfers:';
  const html = `<p style="font-size:16px;margin:0 0 6px">Hola ${esc(String(b.driverName || '').split(' ')[0])},</p><p>${esc(intro)}</p>` + rowsHtml(rows) +
    '<p>Te adjuntamos la hoja de servicio en PDF.</p><p style="color:#a8501a"><b>Recuerda comunicar el servicio al registro del Ministerio antes de empezar.</b></p>' +
    (tomorrow ? '' : '<p>Si no puedes hacerlo, avísanos cuanto antes.</p>') + '<p style="margin:10px 0">Gracias,<br>Bravo Transfers</p>';
  const text = ['Hola ' + String(b.driverName || '').split(' ')[0] + ',', '', intro, ''].concat(rows.filter((r) => r[1]).map((r) => r[0] + ': ' + r[1]),
    ['', 'Te adjuntamos la hoja de servicio en PDF.', 'Recuerda comunicar el servicio al registro del Ministerio antes de empezar.', '', 'Gracias,', 'Bravo Transfers']).join('\n');
  return { subject: (tomorrow ? 'Mañana: servicio ' + b.ref + ' a las ' + b.time : 'Nuevo servicio ' + b.ref + ' · ' + dmy(b.date) + ' ' + b.time) + ' · Bravo Transfers', html: shell('es', html, o.base), text };
}

// El presupuesto, con un botón para aceptarlo en su cuenta
function quoteEmail(b, o) {
  const en = b.lang === 'en', q = b.quote;
  const from = (b.from && b.from.label) || b.fromText || '', to = (b.to && b.to.label) || b.toText || '';
  const rows = [[en ? 'Date and time' : 'Día y hora', dmy(b.date) + ' · ' + b.time], [en ? 'From' : 'Desde', from], [en ? 'To' : 'Hasta', b.kind === 'hourly' ? '' : to],
    [en ? 'Passengers' : 'Personas', String(b.passengers)], [en ? 'Total (VAT included)' : 'Total (IVA incluido)', money(q.price)], [en ? 'Valid until' : 'Válido hasta', dmy(q.validUntil)]];
  const intro = en ? 'Here is your quote ' + q.number + ' from Bravo Transfers:' : 'Aquí tienes tu presupuesto ' + q.number + ' de Bravo Transfers:';
  const html = `<p style="font-size:16px;margin:0 0 6px">${esc(L[en ? 'en' : 'es'].hello)} ${esc(String(b.name || '').split(' ')[0])},</p><p>${esc(intro)}</p>` + rowsHtml(rows) +
    (q.notes ? `<div style="background:#faf6ee;border-radius:10px;padding:12px 14px;white-space:pre-wrap">${esc(q.notes)}</div>` : '') +
    `<p>${esc(en ? 'The quote is attached as a PDF. You can accept it in your account:' : 'Te adjuntamos el presupuesto en PDF. Puedes aceptarlo en tu cuenta:')}</p>` +
    btn(o.areaUrl, en ? 'Accept or decline the quote' : 'Aceptar o rechazar el presupuesto') +
    `<p style="margin:10px 0">${esc(en ? 'Best regards,' : 'Un saludo,')}<br>Bravo Transfers</p>`;
  const text = [intro, ''].concat(rows.filter((r) => r[1]).map((r) => r[0] + ': ' + r[1]), [q.notes || '', '', o.areaUrl, '', 'Bravo Transfers']).join('\n');
  return { subject: (en ? 'Your quote ' : 'Tu presupuesto ') + q.number + ' · Bravo Transfers', html: shell(en ? 'en' : 'es', html, o.base), text };
}

module.exports.templates = { bookingEmail, loginEmail, messageEmail, ownerEmail, paymentEmail, reminderEmail, reviewEmail, companyEmail, quoteEmail };
