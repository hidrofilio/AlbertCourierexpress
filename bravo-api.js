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
const createMail = require('./bravo-mail');
const TPL = createMail.templates;

const DEFAULTS = {
  vehicles: {
    car: { seats: 4, perKm: 1.0, minFare: 30, perHour: 40 },
    van: { seats: 7, perKm: 1.3, minFare: 40, perHour: 52 }
  },
  minHoursAhead: 24,
  hourly: { min: 2, max: 12 },
  autoInvoice: true, // factura automática al reservar (con el IVA por defecto)
  cancelHours: 24, // el cliente cancela solo hasta estas horas antes
  backupEmail: false, // mandar a Alberto la copia de seguridad por correo cada lunes
  reminders: true, // al cliente, el día antes
  notifyCompany: true, // a la empresa de transporte, al asignarle el viaje y la víspera
  ownerAlerts: true, // a Alberto, si un viaje de mañana sigue sin asignar
  reviewUrl: '', // enlace para dejar una opinión en Google (vacío: no se pide)
  payEmail: true, // al marcar un pago (empresa de transporte o proveedor), mandarle el justificante por correo
  // Provisional: solo salidas desde la provincia de Málaga (caja aproximada)
  originBox: { latMin: 36.28, latMax: 37.32, lonMin: -5.65, lonMax: -3.75 },
  // Datos de las facturas: PROVISIONALES, se cambian desde el panel (Ajustes).
  // Nunca la dirección de casa de Alberto.
  invoice: { issuerName: 'Bravo Transfers', taxId: '', address: '', email: 'info@albertcourierexpress.com', phone: '+353 87 459 2308', defaultVat: 10, footer: '' }
};
const SPAIN_BOX = { latMin: 35.8, latMax: 43.9, lonMin: -9.5, lonMax: 4.5 };
const STATUSES = ['pendiente', 'asignada', 'hecha', 'cancelada'];
// Equipaje especial que se puede pedir al reservar
const SPECIAL = { golf: 'Palos de golf', bike: 'Bicicleta', surf: 'Tabla de surf', ski: 'Esquís', wheelchair: 'Silla de ruedas', pram: 'Carrito de bebé', pet: 'Mascota', other: 'Otro (ver comentarios)' };
const COOKIE = 'bravo_pass';

module.exports = function createBravo({ DATA_DIR, readBody, getClientIp }) {
  const KEY = process.env.BRAVO_KEY || process.env.STATS_KEY || '';
  const mail = createMail();
  const BASE = (process.env.PUBLIC_URL || 'https://albertcourierexpress.com').replace(/\/$/, '');
  const OSRM = (process.env.BRAVO_OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  const DIR = path.join(DATA_DIR, 'bravo');
  const geo = require('./bravo-geo')(DIR);
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
    if (typeof s.autoInvoice === 'boolean') out.autoInvoice = s.autoInvoice;
    if (Number.isFinite(s.cancelHours)) out.cancelHours = s.cancelHours;
    if (typeof s.payEmail === 'boolean') out.payEmail = s.payEmail;
    if (typeof s.backupEmail === 'boolean') out.backupEmail = s.backupEmail;
    for (const k of ['reminders', 'notifyCompany', 'ownerAlerts']) if (typeof s[k] === 'boolean') out[k] = s[k];
    if (typeof s.reviewUrl === 'string') out.reviewUrl = s.reviewUrl;
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
    const out = { vehicles: {}, minHoursAhead: cur.minHoursAhead, invoice: {}, autoInvoice: cur.autoInvoice, cancelHours: cur.cancelHours, payEmail: cur.payEmail, backupEmail: cur.backupEmail };
    if (d.backupEmail !== undefined) out.backupEmail = d.backupEmail === true || d.backupEmail === 'true';
    for (const k of ['reminders', 'notifyCompany', 'ownerAlerts']) out[k] = d[k] !== undefined ? (d[k] === true || d[k] === 'true') : cur[k];
    out.reviewUrl = cur.reviewUrl;
    if (d.reviewUrl !== undefined) {
      const u = String(d.reviewUrl || '').trim();
      if (u && (!/^https:\/\/[^\s<>"']+$/.test(u) || u.length > 300)) return { error: 'bad_review_url' };
      out.reviewUrl = u;
    }
    if (d.autoInvoice !== undefined) out.autoInvoice = d.autoInvoice === true || d.autoInvoice === 'true';
    if (d.payEmail !== undefined) out.payEmail = d.payEmail === true || d.payEmail === 'true';
    if (d.cancelHours !== undefined) {
      const ch = num(d.cancelHours, 0, 168, 0);
      if (ch == null) return { error: 'bad_cancel_hours' };
      out.cancelHours = ch;
    }
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
  function makeInvoice(b, vatRate, cus) {
    const s = settings().invoice;
    const date = today();
    const total = Math.round(b.price * 100) / 100;
    const base = Math.round((total / (1 + vatRate / 100)) * 100) / 100;
    const previous = b.invoice ? [b.invoice].concat(b.previousInvoices || []) : (b.previousInvoices || []);
    b.invoice = {
      number: nextInvoiceNumber(date.slice(0, 4)), date, status: 'emitida', vatRate, total, base,
      vat: Math.round((total - base) * 100) / 100,
      issuer: { name: s.issuerName, taxId: s.taxId, address: s.address, email: s.email, phone: s.phone, footer: s.footer },
      customer: { name: clean(cus.customerName, 120) || b.name, taxId: clean(cus.customerTaxId, 30), address: cleanLong(cus.customerAddress, 200), email: b.email },
      concept: pdf.concept(b), createdAt: new Date().toISOString()
    };
    if (previous.length) b.previousInvoices = previous;
    ensureTokens(b);
  }

  // ---------- papeles: de cada empresa de transporte y de la propia empresa, con su caducidad ----------
  const DOCS_DIR = path.join(DIR, 'docs');
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const DOCS_LIST = path.join(DIR, 'docs.json');
  const DOC_KINDS = ['Licencia VTC', 'Tarjeta de transporte', 'ITV', 'Seguro del vehículo', 'Permiso de circulación', 'Carné de conducir',
    'Alta de autónomo o escrituras', 'Contrato', 'Certificado de Hacienda o Seguridad Social', 'Otro'];
  function docsList() { try { return JSON.parse(fs.readFileSync(DOCS_LIST, 'utf8')); } catch (e) { return []; } }
  function removeDocFile(x) { if (x && x.file) { try { fs.unlinkSync(path.join(DOCS_DIR, x.file)); } catch (e) { /* ya no estaba */ } } }

  // ---------- copia de seguridad: una al día en el servidor (se guardan 30) ----------
  const BACKUPS = path.join(DIR, 'backups');
  fs.mkdirSync(BACKUPS, { recursive: true });
  function backupData() {
    let counters = {};
    try { counters = JSON.parse(fs.readFileSync(path.join(DIR, 'invoice-counter.json'), 'utf8')); } catch (e) { /* ninguno */ }
    return { exportedAt: new Date().toISOString(), settings: settings(), drivers: drivers(), bookings: allBookings(), ledger: ledger(), bank: bank(), inbox: inbox(), invoiceCounters: counters,
      customers: customers().map((c) => ({ id: c.id, email: c.email, name: c.name, phone: c.phone, lang: c.lang, createdAt: c.createdAt, lastLogin: c.lastLogin || null })),
      messages: messages(), docs: docsList(), partners: partners(), codes: codes(),
      users: users().map((u) => ({ id: u.id, name: u.name, user: u.user, active: u.active !== false })) };
  }
  function autoBackup() {
    try {
      const day = today(), name = 'bravo-' + day + '.json', file = path.join(BACKUPS, name);
      if (!fs.existsSync(file)) {
        writeJson(file, backupData());
        const all = fs.readdirSync(BACKUPS).filter((n) => /^bravo-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
        for (const n of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(BACKUPS, n));
      }
      // Los lunes, si Alberto lo pide en Ajustes, la copia le llega por correo
      const sent = path.join(BACKUPS, 'emailed.json');
      let last = '';
      try { last = JSON.parse(fs.readFileSync(sent, 'utf8')).day || ''; } catch (e) { /* nunca */ }
      if (settings().backupEmail && mail.configured() && new Date(day + 'T12:00:00Z').getUTCDay() === 1 && last !== day) {
        writeJson(sent, { day });
        const buf = fs.readFileSync(file);
        const m = TPL.ownerEmail('Copia de seguridad del ' + day, ['Te adjuntamos la copia de seguridad de Bravo Transfers (reservas, facturas, cuentas, banco, empresas y ajustes).', 'Guárdala en el ordenador, en Albert-Privado. No la reenvíes: lleva datos de clientes.'], { url: BASE + '/bravo/panel/', base: BASE });
        mail.send({ to: mail.owner, subject: m.subject, html: m.html, text: m.text, attachments: [{ name, buf }] }).catch(() => {});
      }
    } catch (e) { /* la próxima vez */ }
  }
  setTimeout(autoBackup, 4000).unref();
  setInterval(autoBackup, 3600000).unref();

  // ---------- rutas de la portada: «desde X €» desde el aeropuerto ----------
  const AGP = { lat: 36.6749, lon: -4.4991, label: 'Aeropuerto de Málaga (AGP)' };
  const ROUTES = [
    ['marbella', 'Marbella', 'Costa del Sol', 36.5101, -4.8825], ['torremolinos', 'Torremolinos', 'Costa del Sol', 36.6203, -4.4998],
    ['benalmadena', 'Benalmádena', 'Costa del Sol', 36.5988, -4.5167], ['fuengirola', 'Fuengirola', 'Costa del Sol', 36.5398, -4.6247],
    ['estepona', 'Estepona', 'Costa del Sol', 36.4256, -5.1466], ['nerja', 'Nerja', 'Axarquía', 36.7577, -3.8752],
    ['ronda', 'Ronda', 'Pueblos blancos', 36.7423, -5.1671], ['granada', 'Granada', 'La Alhambra', 37.1773, -3.5986],
    ['sevilla', 'Sevilla', 'La Giralda', 37.3891, -5.9845], ['centro', 'Málaga centro', 'Ciudad', 36.7213, -4.4214]
  ];
  let routesCache = { key: '', at: 0, list: [] };
  async function routePrices() {
    const cfg = settings(), key = JSON.stringify(cfg.vehicles);
    if (routesCache.key === key && Date.now() - routesCache.at < 12 * 3600000 && routesCache.list.length) return routesCache.list;
    const list = [];
    for (const [id, name, sub, lat, lon] of ROUTES) {
      try {
        const r = await drive(AGP, { lat, lon });
        if (!r) continue;
        const prices = priceOptions(cfg, 'transfer', r.km, 0, 1, false).map((o) => o.price);
        list.push({ id, name, sub, lat, lon, km: r.km, minutes: r.minutes, from: Math.min.apply(null, prices) });
      } catch (e) { /* esa ruta, sin precio */ }
    }
    routesCache = { key, at: Date.now(), list };
    return list;
  }

  // ---------- hoteles y agencias (cada uno con su enlace) y códigos de descuento ----------
  const PARTNERS = path.join(DIR, 'partners.json');
  const CODES = path.join(DIR, 'codes.json');
  function partners() { try { return JSON.parse(fs.readFileSync(PARTNERS, 'utf8')); } catch (e) { return []; } }
  function codes() { try { return JSON.parse(fs.readFileSync(CODES, 'utf8')); } catch (e) { return []; } }
  // El código del cliente, si vale; si no, el descuento del hotel o agencia que lo trajo (no se suman)
  function discountFor(d) {
    const out = { pct: 0, code: '', partner: '' };
    const pc = String(d.partner || '').trim().toLowerCase();
    const p = pc ? partners().find((x) => x.active !== false && x.code === pc) : null;
    if (p) out.partner = p.code;
    const raw = String(d.code || '').trim().toUpperCase();
    if (raw) {
      const c = codes().find((x) => x.code === raw);
      if (c && c.active !== false && (!c.validUntil || c.validUntil >= today()) && (!c.maxUses || (c.uses || 0) < c.maxUses)) { out.pct = c.percent; out.code = c.code; }
      else out.badCode = true;
    }
    if (!out.code && p && p.discount > 0) out.pct = p.discount;
    return out;
  }
  function applyDiscount(trip, disc) {
    if (disc.pct > 0) trip.options = trip.options.map((o) => Object.assign({}, o, { fullPrice: o.price, price: Math.ceil(o.price * (1 - disc.pct / 100)) }));
    trip.discount = disc.pct > 0 ? { pct: disc.pct, code: disc.code, byPartner: !disc.code && Boolean(disc.partner) } : null;
    return trip;
  }

  // ---------- presupuestos (grupos y reservas sin precio) ----------
  function acceptQuote(b, by) {
    b.price = b.quote.price;
    b.quote.status = 'aceptado'; b.quote.acceptedAt = new Date().toISOString(); b.quote.acceptedBy = by;
    // La factura se hace al cobrar, no al aceptar (ver admin/client-paid)
  }
  async function sendQuoteEmail(ref) {
    let b;
    try { b = JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8')); } catch (e) { return { ok: false, error: 'not_found' }; }
    if (!b.quote || !isEmail(b.email)) return { ok: false, error: 'no_email' };
    const cl = customers(), c = cl.find((x) => x.id === b.customerId) || cl.find((x) => x.email === normEmail(b.email));
    let link = areaUrl('');
    if (c) { link = areaUrl(loginToken(c, 14 * 24)); saveCustomers(cl); }
    const m = TPL.quoteEmail(b, { areaUrl: link, base: BASE });
    const r = await mail.send({ to: b.email, toName: b.name, subject: m.subject, html: m.html, text: m.text, attachments: [{ name: b.quote.number + '.pdf', buf: pdf.quotePdf(b, issuerFull()) }] });
    try {
      const fresh = JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8'));
      fresh.emails = (fresh.emails || []).concat([{ at: new Date().toISOString(), kind: 'presupuesto', ok: r.ok, error: r.error || '', to: b.email }]).slice(-20);
      saveBooking(fresh);
    } catch (e) { /* ya no está */ }
    return r;
  }

  // ---------- avisos automáticos (cada 15 minutos) ----------
  function madridHour() { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date())) % 24; }
  function companyAddr(b) {
    if (isEmail(b.driverEmail)) return b.driverEmail.trim();
    const n = String(b.driverName || '').toLowerCase(), d = drivers().find((x) => x.name && x.name.toLowerCase() === n);
    return d && isEmail(d.email) ? d.email : '';
  }
  // Manda un aviso y lo apunta en la reserva (leída de nuevo, por si se cambió mientras tanto)
  async function sendNotice(ref, kind, build) {
    let b;
    try { b = JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8')); } catch (e) { return { ok: false, error: 'not_found' }; }
    const m = build(b);
    if (!m) return { ok: false, error: 'nothing' };
    const r = await mail.send(m);
    try {
      const fresh = JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8'));
      fresh.reminders = Object.assign(fresh.reminders || {}, m.mark || {});
      fresh.emails = (fresh.emails || []).concat([{ at: new Date().toISOString(), kind, ok: r.ok, error: r.error || '', to: m.to }]).slice(-20);
      saveBooking(fresh);
    } catch (e) { /* ya no está */ }
    return r;
  }
  function companyNotice(b, kind) {
    const to = companyAddr(b);
    if (!to) return null;
    const m = TPL.companyEmail(b, { kind, base: BASE });
    const mark = kind === 'tomorrow' ? { companyTomorrow: new Date().toISOString() } : { companyNewFor: b.driverName + '|' + b.date + '|' + b.time };
    return { to, toName: b.driverName, subject: m.subject, html: m.html, text: m.text, mark, attachments: [{ name: 'hoja-' + b.ref + '.pdf', buf: pdf.driverSheetPdf(b, issuerOf(settings())) }] };
  }
  let remBusy = false;
  async function runReminders(force) {
    if (remBusy) return { sent: 0, busy: true };
    if (!mail.configured()) return { sent: 0, emailOff: true };
    remBusy = true;
    let sent = 0;
    try {
      const cfg = settings(), t0 = today(), t1 = addDays(t0, 1), tm1 = addDays(t0, -1), late = force || madridHour() >= 10;
      for (const b of allBookings()) {
        if (b.status === 'cancelada') continue;
        const done = b.reminders || {};
        // 1. Al cliente, el día antes, en cuanto el viaje tiene empresa (si no, a las 18 se avisa a Alberto)
        if (cfg.reminders && late && b.kind !== 'group' && isEmail(b.email) && b.date === t1 && !done.client && b.driverName) {
          await sendNotice(b.ref, 'recordatorio', (x) => {
            let link = areaUrl('');
            const cl = customers(), c = cl.find((y) => y.id === x.customerId);
            if (c) { link = areaUrl(loginToken(c, 48)); saveCustomers(cl); }
            const m = TPL.reminderEmail(x, { areaUrl: link, base: BASE });
            return { to: x.email, toName: x.name, subject: m.subject, html: m.html, text: m.text, mark: { client: new Date().toISOString() } };
          });
          sent++;
        }
        // 2. A la empresa, la víspera
        if (cfg.notifyCompany && late && b.driverName && b.date === t1 && !done.companyTomorrow && companyAddr(b)) {
          await sendNotice(b.ref, 'empresa: mañana', (x) => companyNotice(x, 'tomorrow'));
          sent++;
        }
        // 3. Al cliente, el día después: su opinión (solo si hay enlace)
        if (cfg.reviewUrl && late && isEmail(b.email) && b.date === tm1 && ['asignada', 'hecha'].includes(b.status) && !done.review) {
          await sendNotice(b.ref, 'opinión', (x) => {
            const m = TPL.reviewEmail(x, { reviewUrl: cfg.reviewUrl, base: BASE });
            return { to: x.email, toName: x.name, subject: m.subject, html: m.html, text: m.text, mark: { review: new Date().toISOString() } };
          });
          sent++;
        }
      }
      // 4. A Alberto: viajes de mañana sin asignar (una vez al día, desde las 18)
      const ALERTS = path.join(DIR, 'alerts.json');
      let al = {};
      try { al = JSON.parse(fs.readFileSync(ALERTS, 'utf8')); } catch (e) { /* ninguno */ }
      const loose = allBookings().filter((b) => b.date === t1 && b.status !== 'cancelada' && !b.driverName);
      if (cfg.ownerAlerts && loose.length && al.unassigned !== t0 && (force || madridHour() >= 18)) {
        al.unassigned = t0; writeJson(ALERTS, al);
        const m = TPL.ownerEmail('Mañana hay ' + loose.length + ' viaje' + (loose.length === 1 ? '' : 's') + ' sin asignar', loose.map((b) => b.ref + ' · ' + b.time + ' · ' +
          (b.kind === 'group' ? b.fromText : (b.from && b.from.label) || '') + (b.kind === 'hourly' ? ' (' + b.hours + ' h)' : ' → ' + (b.kind === 'group' ? b.toText : (b.to && b.to.label) || '')) + ' · ' + b.passengers + ' pers.'),
          { url: BASE + '/bravo/panel/', base: BASE });
        await mail.send({ to: mail.owner, subject: m.subject, html: m.html, text: m.text });
        sent++;
      }
    } finally { remBusy = false; }
    return { sent };
  }
  setTimeout(() => { runReminders(false).catch(() => {}); }, 8000).unref();
  setInterval(() => { runReminders(false).catch(() => {}); }, 15 * 60000).unref();

  // ---------- clientes: su cuenta, contraseña, sesiones y mensajes ----------
  const CUSTOMERS = path.join(DIR, 'customers.json');
  const MESSAGES = path.join(DIR, 'messages.json');
  function customers() { try { return JSON.parse(fs.readFileSync(CUSTOMERS, 'utf8')); } catch (e) { return []; } }
  function saveCustomers(list) { writeJson(CUSTOMERS, list); }
  function messages() { try { return JSON.parse(fs.readFileSync(MESSAGES, 'utf8')); } catch (e) { return []; } }
  function saveMessages(list) { writeJson(MESSAGES, list); }
  const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
  const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  function newPassword() {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (const x of crypto.randomBytes(10)) out += A[x % A.length];
    return out;
  }
  // Al reservar: busca la cuenta por el correo o la crea con una contraseña nueva (que solo va en el correo)
  function upsertCustomer(b) {
    const list = customers(), email = normEmail(b.email);
    let c = list.find((x) => x.email === email), password = null;
    if (!c) {
      password = newPassword();
      const salt = crypto.randomBytes(16).toString('hex');
      c = { id: crypto.randomBytes(6).toString('hex'), email, name: b.name, phone: b.phone, lang: b.lang, salt, pw: hashPw(password, salt), createdAt: new Date().toISOString(), sessions: [], tokens: [] };
      list.push(c);
    }
    saveCustomers(list);
    return { c, password };
  }
  function custCookie(req, value, maxAge) {
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
    return `bravo_cust=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }
  function newSession(c) {
    const tok = crypto.randomBytes(24).toString('hex');
    c.sessions = (c.sessions || []).filter((x) => x.exp > Date.now()).slice(-9);
    c.sessions.push({ h: sha(tok), exp: Date.now() + 60 * 86400000 });
    return tok;
  }
  function loginToken(c, hours) {
    const tok = crypto.randomBytes(24).toString('hex');
    c.tokens = (c.tokens || []).filter((x) => x.exp > Date.now()).slice(-4);
    c.tokens.push({ h: sha(tok), exp: Date.now() + hours * 3600000 });
    return tok;
  }
  function currentCustomer(req) {
    const tok = cookies(req).bravo_cust;
    if (!tok || !/^[a-f0-9]{48}$/.test(tok)) return null;
    const h = sha(tok), list = customers();
    const c = list.find((x) => (x.sessions || []).some((y) => y.h === h && y.exp > Date.now()));
    return c ? { c, list, h } : null;
  }
  const areaUrl = (tok) => BASE + '/bravo/cuenta/' + (tok ? '?t=' + tok : '');
  function mine(c) { return allBookings().filter((b) => b.customerId === c.id || normEmail(b.email) === c.email); }
  function custView(b, cfg) {
    const assigned = ['asignada', 'hecha'].includes(b.status);
    const when = madridMs(b.date, b.time);
    return {
      ref: b.ref, kind: b.kind, date: b.date, time: b.time, hours: b.hours || null,
      from: b.kind === 'group' ? b.fromText : (b.from && b.from.label) || '', to: b.kind === 'group' ? b.toText : (b.to && b.to.label) || '',
      roundTrip: Boolean(b.roundTrip), returnDate: b.returnDate || '', returnTime: b.returnTime || '', passengers: b.passengers, vehicle: b.vehicle || '',
      via: (b.via && b.via.label) || '', meetSign: Boolean(b.meetSign), special: b.special || '',
      fromPt: b.from && Number.isFinite(b.from.lat) ? { lat: b.from.lat, lon: b.from.lon, label: b.from.label } : null,
      toPt: b.to && Number.isFinite(b.to.lat) ? { lat: b.to.lat, lon: b.to.lon, label: b.to.label } : null,
      km: b.km || null, price: b.price, status: b.status, payment: b.payment || '', paid: pdf.isPaid(b), flight: b.flight || '', bags: b.bags, childSeats: b.childSeats, comments: b.comments || '',
      driver: assigned && (b.chauffeur || b.driverName) ? { name: b.chauffeur || b.driverName, phone: (b.chauffeur ? b.chauffeurPhone || b.driverPhone : b.driverPhone) || '', car: b.driverCar || '' } : null,
      docs: {
        justificante: '/api/bravo/doc/' + b.clientToken + '/justificante.pdf',
        invoices: allInvoices(b).map((i) => ({ number: i.number, kind: i.kind || 'factura', status: i.status, total: i.total, url: '/api/bravo/doc/' + b.clientToken + '/f/' + i.number + '.pdf' }))
      },
      canCancel: ['pendiente', 'asignada'].includes(b.status) && Boolean(when) && when > Date.now() + cfg.cancelHours * 3600000,
      quote: b.quote ? { number: b.quote.number, price: b.quote.price, validUntil: b.quote.validUntil, notes: b.quote.notes || '', status: b.quote.status,
        canAnswer: b.quote.status === 'enviado' && b.quote.validUntil >= today() && b.status !== 'cancelada', url: '/api/bravo/doc/' + b.clientToken + '/presupuesto.pdf' } : null,
      cancelledBy: b.cancelledBy || null
    };
  }

  // ---------- correos ----------
  function issuerOf(cfg) { return { name: cfg.invoice.issuerName, email: cfg.invoice.email, phone: cfg.invoice.phone }; }
  // Manda al cliente el correo de su reserva, con la factura y el justificante; lo apunta en la reserva
  async function sendBookingEmail(ref, o) {
    o = o || {};
    let b;
    try { b = JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8')); } catch (e) { return { ok: false, error: 'not_found' }; }
    const cfg = settings();
    const list = customers(), c = list.find((x) => x.id === b.customerId) || list.find((x) => x.email === normEmail(b.email));
    let link = areaUrl('');
    if (c) { link = areaUrl(loginToken(c, 14 * 24)); saveCustomers(list); }
    const atts = [];
    if (activeInvoice(b)) atts.push({ name: b.invoice.number + '.pdf', buf: pdf.invoicePdf(b) });
    atts.push({ name: (b.lang === 'en' ? 'booking-' : 'reserva-') + b.ref + '.pdf', buf: pdf.confirmationPdf(b, issuerOf(cfg)) });
    const m = TPL.bookingEmail(b, { password: o.password, update: o.update, paidMail: o.paidMail, paid: pdf.isPaid(b), withInvoice: activeInvoice(b), areaUrl: link, cancelHours: cfg.cancelHours, base: BASE, test: /pruebas/.test(b.payment || '') });
    const r = await mail.send({ to: b.email, toName: b.name, subject: m.subject, html: m.html, text: m.text, attachments: atts });
    try {
      const fresh = JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8'));
      fresh.emails = (fresh.emails || []).concat([{ at: new Date().toISOString(), kind: o.paidMail ? 'pago recibido' : o.update ? 'actualización' : 'reserva', ok: r.ok, error: r.error || '' }]).slice(-20);
      saveBooking(fresh);
    } catch (e) { /* la reserva ya no está */ }
    return r;
  }
  function notifyOwner(subject, lines) {
    if (!mail.configured()) return;
    const m = TPL.ownerEmail(subject, lines.filter(Boolean), { url: BASE + '/bravo/panel/', base: BASE });
    mail.send({ to: mail.owner, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
  }
  // Tras reservar: la cuenta del cliente, la factura automática y el correo
  function afterBooking(b, o) {
    o = o || {};
    let password = null;
    if (b.email) { const r = upsertCustomer(b); b.customerId = r.c.id; password = r.password; }
    const cfg = settings();
    // La factura sola se hace cuando el cliente paga (12/11): al reservar sale «Reserva y presupuesto», pendiente de pago
    if (cfg.autoInvoice && b.price > 0 && !activeInvoice(b) && pdf.isPaid(b)) makeInvoice(b, cfg.invoice.defaultVat, {});
    saveBooking(b);
    if (b.email && o.sendEmail !== false) setImmediate(() => { sendBookingEmail(b.ref, { password }).catch(() => {}); });
    return { newAccount: Boolean(password) };
  }
  function allInvoices(b) { return [b.invoice].concat(b.previousInvoices || [], b.creditNotes || []).filter(Boolean); }

  // Cuentas del Plan General Contable (PGC) para cada categoría
  const PGC = {
    'Empresas de transporte (reservas)': ['607', 'Trabajos realizados por otras empresas'],
    'Empresas de transporte (sin reserva)': ['607', 'Trabajos realizados por otras empresas'],
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
    'Comisiones bancarias': ['626', 'Servicios bancarios y similares'],
    'Nóminas': ['640', 'Sueldos y salarios'],
    'Facturas de la web': ['705', 'Prestaciones de servicios'],
    'Servicio fuera de la web': ['705', 'Prestaciones de servicios'],
    'Otros ingresos': ['759', 'Ingresos por servicios diversos']
  };

  // ---------- contabilidad: gastos e ingresos apuntados a mano ----------
  const LEDGER = path.join(DIR, 'ledger.json');
  const RECEIPTS = path.join(DIR, 'receipts');
  fs.mkdirSync(RECEIPTS, { recursive: true });
  const EXPENSE_CATS = ['Empresas de transporte (sin reserva)', 'Combustible y peajes', 'Vehículos', 'Seguros', 'Publicidad', 'Web, software y comisiones',
    'Gestoría y asesoría', 'Teléfono e internet', 'Oficina y material', 'Impuestos y tasas', 'Comisiones bancarias', 'Otros gastos'];
  const INCOME_CATS = ['Servicio fuera de la web', 'Otros ingresos'];
  const RECEIPT_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
  function ledger() {
    let list;
    try { list = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch (e) { return []; }
    // La categoría se llamaba «Conductores (sin reserva)» hasta el 11/11/2026
    for (const e of list) if (e.category === 'Conductores (sin reserva)') e.category = 'Empresas de transporte (sin reserva)';
    return list;
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
          category: 'Facturas de la web', base: inv.base, vatRate: inv.vatRate, vat: inv.vat, total: inv.total, ref: b.ref, paid: inv.paid || null });
      }
      if (b.status !== 'cancelada' && b.driverPay != null && b.driverPay > 0 && inRange(b.date)) {
        const rate = Number.isFinite(b.driverVat) ? b.driverVat : 0;
        const sv = splitVat(b.driverPay, rate);
        out.push({ date: b.date, kind: 'gasto', source: 'conductor', concept: 'Pago del viaje ' + b.ref + (b.driverName ? ' a ' + b.driverName : ''), party: b.driverName || '',
          category: 'Empresas de transporte (reservas)', base: sv.base, vatRate: rate, vat: sv.vat, total: b.driverPay, ref: b.ref, paid: b.driverPaid || null });
      }
      if (b.status !== 'cancelada' && b.price > 0 && !activeInvoice(b) && inRange(b.date)) { unbilledN++; unbilledSum += b.price; }
    }
    for (const e of ledger()) {
      if (!inRange(e.date)) continue;
      if (e.type === 'nomina') {
        out.push({ date: e.date, kind: 'gasto', source: 'nomina', id: e.id, concept: e.concept || 'Nómina', party: e.party, category: 'Nóminas', number: '', taxId: e.taxId || '',
          base: e.total, vatRate: 0, vat: 0, total: e.total, payroll: e.payroll, notes: e.notes, receipt: Boolean(e.receipt), paid: e.paid || null });
        continue;
      }
      out.push({ date: e.date, kind: e.type, source: 'manual', id: e.id, concept: e.concept, party: e.party, category: e.category, number: e.number || '', taxId: e.taxId || '',
        base: e.base, vatRate: e.vatRate, vat: e.vat, total: e.total, notes: e.notes, receipt: Boolean(e.receipt), paid: e.paid || null, email: e.email || '' });
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
    const noms = out.filter((m) => m.source === 'nomina');
    t.nominas = r(noms.reduce((a, m) => a + m.total, 0));
    t.irpfRetenido = r(noms.reduce((a, m) => a + (m.payroll ? m.payroll.irpf : 0), 0));
    t.seguridadSocial = r(noms.reduce((a, m) => a + (m.payroll ? m.payroll.ssEmp + m.payroll.ssCo : 0), 0));
    for (const mv of out) mv.account = (PGC[mv.category] || ['629', 'Otros servicios'])[0];
    // IVA por tipo
    const byRate = (kind) => {
      const g = {};
      for (const mv of out.filter((x) => x.kind === kind && x.source !== 'nomina')) {
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
    const recibidas = asc.filter((m) => m.kind === 'gasto' && m.source !== 'nomina').map((m) => Object.assign({}, m, { party: m.party ? m.party + ' · ' + m.concept : m.concept }));
    const nominas = asc.filter((m) => m.source === 'nomina');
    const accts = {};
    const addAcct = (code, name, base, vat, total) => {
      const x = accts[code] || (accts[code] = { account: code, name, n: 0, base: 0, vat: 0, total: 0 });
      x.n++; x.base += base; x.vat += vat; x.total += total;
    };
    for (const m of recibidas) { const [code, name] = PGC[m.category] || ['629', 'Otros servicios']; addAcct(code, name, m.base, m.vat, m.total); }
    for (const m of nominas) {
      const p = m.payroll;
      addAcct('640', 'Sueldos y salarios', p.gross, 0, p.gross);
      if (p.ssCo) addAcct('642', 'Seguridad Social a cargo de la empresa', p.ssCo, 0, p.ssCo);
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
      if (m.source === 'nomina') {
        // Nómina: 640 bruto y 642 SS de la empresa al debe; 4751 IRPF, 476 SS y 465 neto al haber
        const p = m.payroll;
        lines = [{ account: '640', name: 'Sueldos y salarios', debe: p.gross }];
        if (p.ssCo) lines.push({ account: '642', name: 'Seguridad Social a cargo de la empresa', debe: p.ssCo });
        if (p.irpf) lines.push({ account: '4751', name: 'Hacienda Pública, acreedora por retenciones practicadas', haber: p.irpf });
        if (p.ssEmp + p.ssCo) lines.push({ account: '476', name: 'Organismos de la Seguridad Social, acreedores', haber: Math.round((p.ssEmp + p.ssCo) * 100) / 100 });
        lines.push({ account: '465', name: 'Remuneraciones pendientes de pago', haber: p.net });
        diario.push({ date: m.date, concept: m.concept + (m.party ? ' · ' + m.party : ''), lines });
        continue;
      }
      if (m.kind === 'ingreso') {
        lines = [{ account: '430', name: 'Clientes', debe: T }, { account: code, name, haber: B }];
        if (V) lines.push({ account: '477', name: 'Hacienda Pública, IVA repercutido', haber: V });
      } else {
        lines = [{ account: code, name, debe: B }];
        if (V) lines.push({ account: '472', name: 'Hacienda Pública, IVA soportado', debe: V });
        lines.push({ account: '410', name: 'Acreedores por prestaciones de servicios', haber: T });
      }
      if (neg) lines = lines.map((l) => ({ account: l.account, name: l.name, debe: l.haber, haber: l.debe }));
      diario.push({ date: m.date, concept: m.concept + (m.party ? ' · ' + m.party : ''), lines });
    }
    // Cobros y pagos del periodo (banco 572, caja 570) y lo que mete o saca el socio (551)
    const cashAcc = (via) => (via === 'efectivo' ? ['570', 'Caja, euros'] : ['572', 'Bancos e instituciones de crédito c/c vista, euros']);
    for (const it of payables()) {
      if (!it.paid || !(it.paid.date >= acc.from && it.paid.date <= acc.to)) continue;
      const [ca, cn] = cashAcc(it.paid.via);
      const A = Math.abs(it.amount);
      const other = it.amount > 0 || it.type === 'invoice' ? ['430', 'Clientes'] : it.nomina ? ['465', 'Remuneraciones pendientes de pago'] : ['410', 'Acreedores por prestaciones de servicios'];
      const incoming = it.amount > 0;
      diario.push({ date: it.paid.date, concept: (incoming ? 'Cobro · ' : 'Pago · ') + it.label,
        lines: incoming ? [{ account: ca, name: cn, debe: A }, { account: other[0], name: other[1], haber: A }]
          : [{ account: other[0], name: other[1], debe: A }, { account: ca, name: cn, haber: A }] });
    }
    const TAX = { iva: ['4750', 'Hacienda Pública, acreedora por IVA'], irpf: ['4751', 'Hacienda Pública, acreedora por retenciones practicadas'],
      is: ['4752', 'Hacienda Pública, acreedora por impuesto sobre sociedades'], otros: ['4759', 'Hacienda Pública, acreedora por otros conceptos'] };
    for (const l of bank().lines) {
      if (!l.match || !['tax', 'ss'].includes(l.match.type) || !(l.date >= acc.from && l.date <= acc.to)) continue;
      const [ta, tn] = l.match.type === 'ss' ? ['476', 'Organismos de la Seguridad Social, acreedores'] : (TAX[l.match.tax] || TAX.otros);
      const A = Math.abs(l.amount), [ca, cn] = cashAcc('banco');
      diario.push({ date: l.date, concept: (l.match.type === 'ss' ? 'Pago a la Seguridad Social · ' : 'Pago a Hacienda · ') + l.concept,
        lines: l.amount < 0 ? [{ account: ta, name: tn, debe: A }, { account: ca, name: cn, haber: A }] : [{ account: ca, name: cn, debe: A }, { account: ta, name: tn, haber: A }] });
    }
    for (const l of bank().lines) {
      if (!l.match || l.match.type !== 'socio' || !(l.date >= acc.from && l.date <= acc.to)) continue;
      const A = Math.abs(l.amount), [ca, cn] = cashAcc('banco');
      const so = ['551', 'Cuenta corriente con socios y administradores'];
      diario.push({ date: l.date, concept: (l.amount > 0 ? 'Aportación del socio · ' : 'Retirada del socio · ') + l.concept,
        lines: l.amount > 0 ? [{ account: ca, name: cn, debe: A }, { account: so[0], name: so[1], haber: A }]
          : [{ account: so[0], name: so[1], debe: A }, { account: ca, name: cn, haber: A }] });
    }
    diario.sort((a, c) => a.date.localeCompare(c.date));
    diario.forEach((a) => { a.n = ++n; });
    // Lo pendiente de cobrar y de pagar a la fecha final
    const pend = payables().filter((it) => it.date <= acc.to && (!it.paid || it.paid.date > acc.to));
    const bankLines = bank().lines.filter((l) => l.date >= acc.from && l.date <= acc.to).sort((a, c) => a.date.localeCompare(c.date));
    // Lo que se debe a Hacienda por retenciones y a la Seguridad Social, a la fecha final
    let irpfDue = 0, ssDue = 0;
    for (const e of ledger()) if (e.type === 'nomina' && e.date <= acc.to && e.payroll) { irpfDue += e.payroll.irpf; ssDue += e.payroll.ssEmp + e.payroll.ssCo; }
    for (const l of bank().lines) {
      if (!l.match || l.date > acc.to) continue;
      if (l.match.type === 'tax' && l.match.tax === 'irpf') irpfDue += l.amount;
      if (l.match.type === 'ss') ssDue += l.amount;
    }
    return { emitidas, recibidas, expenseAccounts, diario, nominas, pendingTaxes: { irpf: r(irpfDue), ss: r(ssDue) },
      pendingIn: pend.filter((x) => x.amount > 0), pendingOut: pend.filter((x) => x.amount < 0),
      bankLines: bankLines.map((l) => ({ date: l.date, concept: l.concept, amount: l.amount, status: lineStatus(l) })) };
  }

  // ---------- banco: extractos, movimientos y conciliación ----------
  const BANK = path.join(DIR, 'bank.json');
  const STATEMENTS = path.join(DIR, 'statements');
  const INBOX = path.join(DIR, 'inbox');
  const INBOX_LIST = path.join(DIR, 'inbox.json');
  fs.mkdirSync(STATEMENTS, { recursive: true });
  fs.mkdirSync(INBOX, { recursive: true });
  function writeJson(file, obj) { fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 1)); fs.renameSync(file + '.tmp', file); }
  function bank() {
    try { const b = JSON.parse(fs.readFileSync(BANK, 'utf8')); return { statements: b.statements || [], lines: b.lines || [] }; }
    catch (e) { return { statements: [], lines: [] }; }
  }
  function saveBank(b) { writeJson(BANK, b); }
  function inbox() { try { return JSON.parse(fs.readFileSync(INBOX_LIST, 'utf8')); } catch (e) { return []; } }
  const cents = (n) => Math.round(Number(n) * 100);
  function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function lineStatus(l) {
    if (!l.match) return 'pendiente';
    if (l.match.type === 'tax') return 'pago a Hacienda (' + ({ iva: 'IVA', irpf: 'retenciones', is: 'sociedades' }[l.match.tax] || 'otros') + ')';
    return { socio: 'socio', transfer: 'traspaso', ignore: 'ignorado', ss: 'Seguridad Social' }[l.match.type] || ('conciliado: ' + (l.match.label || ''));
  }

  // Lo que se cobra o se paga: facturas, rectificativas, pagos a conductores y apuntes. Importe + entra, − sale.
  function payables() {
    const out = [];
    for (const b of allBookings()) {
      const invs = allInvoices(b);
      for (const inv of invs) {
        if (inv.status === 'anulada') continue;
        // Una factura rectificada sin cobrar y su rectificativa se anulan entre sí: no quedan pendientes.
        // Si la original estaba cobrada, la rectificativa queda como dinero a devolver.
        if (inv.status === 'rectificada' && !inv.paid) continue;
        if (inv.kind === 'rectificativa') { const orig = invs.find((x) => x.number === inv.rectifies); if (!orig || !orig.paid) continue; }
        out.push({ type: 'invoice', key: inv.number, date: inv.date, amount: inv.total, paid: inv.paid || null,
          label: (inv.kind === 'rectificativa' ? 'Rectificativa ' : 'Factura ') + inv.number + ' · ' + ((inv.customer && inv.customer.name) || b.name) });
      }
      if (b.status !== 'cancelada' && b.driverPay > 0) {
        out.push({ type: 'driver', key: b.ref, date: b.date, amount: -b.driverPay, paid: b.driverPaid || null, label: 'Pago del viaje ' + b.ref + (b.driverName ? ' a ' + b.driverName : '') });
      }
    }
    for (const e of ledger()) {
      if (e.type === 'nomina') {
        out.push({ type: 'ledger', key: e.id, date: e.date, amount: -e.payroll.net, paid: e.paid || null, nomina: true, label: 'Nómina: ' + (e.party || '') + (e.concept ? ' · ' + e.concept : '') });
        continue;
      }
      out.push({ type: 'ledger', key: e.id, date: e.date, amount: e.type === 'ingreso' ? e.total : -e.total, paid: e.paid || null,
        label: (e.type === 'ingreso' ? 'Ingreso: ' : 'Gasto: ') + e.concept + (e.party ? ' · ' + e.party : '') });
    }
    return out;
  }
  // Un pago marcado a mano «por el banco» o Bizum se puede casar luego con su movimiento, sin perder si ya se mandó el justificante
  const openToBank = (it) => !it.paid || (!it.paid.lineId && ['banco', 'bizum'].includes(it.paid.via));
  function setPaid(t, paid) {
    if (paid && t.paid && t.paid.emailed) paid.emailed = t.paid.emailed;
    if (t.type === 'ledger') {
      const list = ledger(), e = list.find((x) => x.id === t.key);
      if (!e) return false;
      e.paid = paid; saveLedger(list); return true;
    }
    for (const b of allBookings()) {
      if (t.type === 'driver' && b.ref === t.key) { b.driverPaid = paid; saveBooking(b); return true; }
      if (t.type === 'invoice') {
        const inv = allInvoices(b).find((x) => x.number === t.key);
        if (inv) { inv.paid = paid; saveBooking(b); return true; }
      }
    }
    return false;
  }
  const isEmail = (e) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(String(e || '').trim());
  const dmyApi = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (d || ''); };
  // Un pago a un conductor (por su reserva) o a un proveedor (un gasto), con lo que va en su justificante
  function payment(type, key) {
    if (type === 'driver') {
      const b = allBookings().find((x) => x.ref === key);
      if (!b || !(b.driverPay > 0)) return null;
      const dn = String(b.driverName || '').toLowerCase();
      const drv = drivers().find((x) => x.name && x.name.toLowerCase() === dn) || {};
      const rate = Number(b.driverVat) || 0, sv = splitVat(b.driverPay, rate);
      const from = b.kind === 'group' ? b.fromText : (b.from && b.from.label) || '';
      const to = b.kind === 'group' ? b.toText : b.kind === 'hourly' ? b.hours + ' h' : (b.to && b.to.label) || '';
      return { type, key, id: b.ref, ref: b.ref, kind: 'driver', b,
        payee: { name: b.driverName || drv.name || '', taxId: drv.taxId || '', email: b.driverEmail || drv.email || '' }, paid: b.driverPaid || null,
        lines: [{ concept: 'Servicio ' + b.ref + ' · ' + dmyApi(b.date) + ' ' + b.time + ' · ' + from + (to ? ' → ' + to : ''), base: sv.base, vatRate: rate, vat: sv.vat, total: b.driverPay }],
        total: b.driverPay, theirInvoice: b.driverInvoiceNo || '' };
    }
    if (type === 'ledger') {
      const e = ledger().find((x) => x.id === key);
      if (!e || e.type !== 'gasto') return null; // ni ingresos ni nóminas (la nómina ya la da la gestoría)
      return { type, key, id: e.number || 'Gasto ' + dmyApi(e.date), ref: '', kind: 'supplier', e,
        payee: { name: e.party || '', taxId: e.taxId || '', email: e.email || '' }, paid: e.paid || null,
        lines: [{ concept: e.concept, base: e.base, vatRate: e.vatRate, vat: e.vat, total: e.total }], total: e.total, theirInvoice: e.number || '' };
    }
    return null;
  }
  function issuerFull() { const i = settings().invoice; return { name: i.issuerName, taxId: i.taxId, address: i.address, email: i.email, phone: i.phone }; }
  async function sendPaymentEmail(type, key) {
    const p = payment(type, key);
    if (!p) return { ok: false, error: 'not_found' };
    if (!p.paid) return { ok: false, error: 'not_paid' };
    if (!isEmail(p.payee.email)) return { ok: false, error: 'no_email' };
    if (!mail.configured()) return { ok: false, error: 'email_not_configured' };
    const slug = String(p.id).replace(/[^A-Za-z0-9-]+/g, '-');
    const atts = [{ name: 'justificante-pago-' + slug + '.pdf', buf: pdf.paymentPdf(p, issuerFull()) }];
    if (p.kind === 'driver') atts.push({ name: 'hoja-' + p.b.ref + '.pdf', buf: pdf.driverSheetPdf(p.b, issuerOf(settings())) });
    if (p.kind === 'supplier' && p.e.receipt) {
      try {
        atts.push({ name: 'factura-' + slug + '.' + p.e.receipt.file.split('.').pop(), buf: fs.readFileSync(path.join(RECEIPTS, p.e.receipt.file)) });
        p.attachTheirs = true;
      } catch (e) { /* sin su factura */ }
    }
    const m = TPL.paymentEmail(p, { base: BASE });
    const r = await mail.send({ to: p.payee.email.trim(), toName: p.payee.name, subject: m.subject, html: m.html, text: m.text, attachments: atts });
    const log = { at: new Date().toISOString(), ok: r.ok, error: r.error || '', to: p.payee.email.trim() };
    if (type === 'driver') {
      try { const b = JSON.parse(fs.readFileSync(bookingFile(key), 'utf8')); if (b.driverPaid) { b.driverPaid.emailed = log; saveBooking(b); } } catch (e) { /* ya no está */ }
    } else {
      const list = ledger(), e = list.find((x) => x.id === key);
      if (e && e.paid) { e.paid.emailed = log; saveLedger(list); }
    }
    return r;
  }
  // Solo pagos recientes: subir un extracto antiguo no le manda nada a nadie (para esos, el botón del panel)
  function autoPayEmail(type, key) {
    if (type !== 'driver' && type !== 'ledger') return;
    if (!settings().payEmail || !mail.configured()) return;
    const p = payment(type, key);
    if (!p || !p.paid || p.paid.emailed || !isEmail(p.payee.email) || p.paid.date < addDays(today(), -15)) return;
    setImmediate(() => { sendPaymentEmail(type, key).catch(() => {}); });
  }
  function candidates(l, items) {
    return items.filter((it) => openToBank(it) && cents(it.amount) === cents(l.amount) && it.date >= addDays(l.date, -60) && it.date <= addDays(l.date, 15));
  }
  // Empareja solo lo que no tiene dudas: un movimiento con un único candidato, que no sirve para otro movimiento
  function autoMatch(bk) {
    const items = payables();
    const pending = bk.lines.filter((l) => !l.match);
    const cands = new Map(pending.map((l) => [l.id, candidates(l, items)]));
    const uses = new Map();
    for (const list of cands.values()) for (const it of list) uses.set(it.type + ':' + it.key, (uses.get(it.type + ':' + it.key) || 0) + 1);
    let n = 0;
    for (const l of pending) {
      const list = cands.get(l.id);
      if (list.length !== 1 || uses.get(list[0].type + ':' + list[0].key) !== 1) continue;
      const it = list[0];
      if (setPaid(it, { date: l.date, via: 'banco', lineId: l.id })) { l.match = { type: it.type, key: it.key, label: it.label, auto: true }; n++; autoPayEmail(it.type, it.key); }
    }
    return n;
  }

  // ---------- leer extractos: Norma 43 (bancos españoles) y CSV ----------
  function parseAmount(s) {
    s = String(s == null ? '' : s).replace(/[€$£\s]/g, '').replace(/EUR/i, '');
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc > -1) s = s.replace(',', '.');
    else if (ld > -1 && s.length - ld - 1 === 3 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
  }
  const MONTHS = { jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, oct: 10, nov: 11, dec: 12, dic: 12 };
  function parseDay(s) {
    s = String(s || '').trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{2,4})$/.exec(s);
    if (m && MONTHS[m[2].toLowerCase()]) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + String(MONTHS[m[2].toLowerCase()]).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    return null;
  }
  function parseN43(text) {
    const out = [];
    let last = null;
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.replace(/\s+$/, '');
      if (l.startsWith('22') && l.length >= 42) {
        const d = l.slice(10, 16);
        const amount = (l[27] === '1' ? -1 : 1) * Number(l.slice(28, 42)) / 100;
        last = { date: '20' + d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4, 6), concept: (l.slice(52, 64) + ' ' + l.slice(64, 80)).replace(/\s+/g, ' ').trim(), amount, balance: null };
        out.push(last);
      } else if (l.startsWith('23') && last) {
        const c = (l.slice(4, 42) + ' ' + l.slice(42, 80)).replace(/\s+/g, ' ').trim();
        if (c) last.concept = last.concept ? c + ' · ' + last.concept : c;
      }
    }
    return out;
  }
  function splitCsv(line, delim) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  function parseCsv(text) {
    const rows = text.split(/\r?\n/).filter((l) => l.trim());
    if (rows.length < 2) return [];
    const delim = [';', '\t', ','].map((d) => [d, rows.slice(0, 10).reduce((a, r) => a + r.split(d).length, 0)]).sort((a, c) => c[1] - a[1])[0][0];
    let hi = -1, col = {};
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const h = splitCsv(rows[i], delim).map((x) => x.toLowerCase());
      const find = (re, not) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
      const date = find(/fecha|date|posted/, /valor|value/);
      const date2 = find(/fecha|date/);
      const amount = find(/^importe|amount|cantidad|^importe \(/, /saldo|balance/);
      const debit = find(/cargo|debe|debit|salida|money out|paid out/);
      const credit = find(/abono|haber|credit|entrada|money in|paid in/);
      if ((date > -1 || date2 > -1) && (amount > -1 || debit > -1 || credit > -1)) {
        hi = i;
        col = { date: date > -1 ? date : date2, amount, debit, credit, concept: find(/concepto|descripci|description|details|detalle|narrative|movimiento|referencia/), balance: find(/saldo|balance/) };
        break;
      }
    }
    if (hi < 0) return [];
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      const c = splitCsv(r, delim);
      const date = parseDay(c[col.date]);
      let amount = col.amount > -1 ? parseAmount(c[col.amount]) : null;
      if (amount == null && (col.debit > -1 || col.credit > -1)) {
        const dv = col.debit > -1 ? parseAmount(c[col.debit]) : null, cv = col.credit > -1 ? parseAmount(c[col.credit]) : null;
        if (dv != null || cv != null) amount = (cv || 0) - Math.abs(dv || 0);
      }
      if (!date || amount == null || amount === 0) continue;
      out.push({ date, concept: col.concept > -1 ? c[col.concept] : '', amount, balance: col.balance > -1 ? parseAmount(c[col.balance]) : null });
    }
    return out;
  }
  function cleanLines(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list.slice(0, 5000) : []) {
      const date = isDay(x.date) ? x.date : parseDay(x.date);
      const amount = typeof x.amount === 'number' ? x.amount : parseAmount(x.amount);
      if (!date || amount == null || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10000000) continue;
      const balance = x.balance == null || x.balance === '' ? null : (typeof x.balance === 'number' ? x.balance : parseAmount(x.balance));
      out.push({ date, concept: clean(x.concept, 160), amount: Math.round(amount * 100) / 100, balance: Number.isFinite(balance) ? Math.round(balance * 100) / 100 : null });
    }
    return out;
  }
  function addLines(bk, st, parsed) {
    const key = (l) => [l.date, cents(l.amount), l.concept, l.balance == null ? '' : cents(l.balance)].join('|');
    const seen = new Set(bk.lines.map(key));
    let added = 0;
    for (const l of cleanLines(parsed)) {
      if (seen.has(key(l))) continue;
      seen.add(key(l));
      bk.lines.push(Object.assign({ id: crypto.randomBytes(5).toString('hex'), statementId: st.id, match: null }, l));
      added++;
    }
    const mine = bk.lines.filter((l) => l.statementId === st.id);
    st.lines = mine.length;
    if (mine.length) { st.from = mine.reduce((a, l) => (l.date < a ? l.date : a), mine[0].date); st.to = mine.reduce((a, l) => (l.date > a ? l.date : a), mine[0].date); }
    if (mine.length) st.status = 'leído';
    return added;
  }
  function unmatchLine(bk, l) {
    if (l.match && ['invoice', 'ledger', 'driver'].includes(l.match.type)) setPaid({ type: l.match.type, key: l.match.key }, null);
    l.match = null;
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
  function adminAuthed(req) {
    if (!TOKEN) return false;
    const got = Buffer.from(cookies(req)[COOKIE] || '');
    const want = Buffer.from(TOKEN);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  // ---------- usuarios del panel (el sobrino…): ven los viajes, no el dinero ----------
  const USERS = path.join(DIR, 'users.json');
  function users() { try { return JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch (e) { return []; } }
  function opSession(req) {
    const tok = cookies(req).bravo_op;
    if (!tok || !/^[a-f0-9]{48}$/.test(tok)) return null;
    const h = crypto.createHash('sha256').update(tok).digest('hex'), list = users();
    const u = list.find((x) => x.active !== false && (x.sessions || []).some((y) => y.h === h && y.exp > Date.now()));
    return u ? { u, list, h } : null;
  }
  function whoIs(req) {
    if (adminAuthed(req)) return { role: 'admin', name: 'Alberto' };
    const s = opSession(req);
    return s ? { role: 'operador', name: s.u.name, id: s.u.id } : null;
  }
  function authed(req) { return Boolean(whoIs(req)); }
  function opCookie(req, value, maxAge) {
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
    return `bravo_op=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }
  // Lo que puede hacer un usuario que no es Alberto (todo lo demás del panel, no)
  const OP_ROUTES = new Set(['GET admin/me', 'GET admin/bookings', 'POST admin/update', 'POST admin/incident', 'POST admin/book', 'GET admin/drivers',
    'GET admin/docs', 'GET admin/docs/file', 'GET admin/messages', 'POST admin/messages/reply', 'POST admin/messages/read', 'GET admin/settings', 'GET admin/partners']);
  const OP_UPDATE = ['ref', 'status', 'driverName', 'driverPhone', 'driverEmail', 'driverCar', 'chauffeur', 'chauffeurPhone', 'driverNote', 'ministry', 'clientDoc', 'notes', 'date', 'time'];
  const MONEY = ['price', 'driverPay', 'driverVat', 'driverPaid', 'driverInvoiceNo', 'invoice', 'previousInvoices', 'creditNotes', 'quote', 'quotes', 'discount', 'payment'];
  function forOperator(b) { const o = Object.assign({}, b); for (const k of MONEY) delete o[k]; return o; }
  // Registro de cambios: quién, cuándo y qué
  const AUDIT = path.join(DIR, 'audit.jsonl');
  function audit(me, what, extra) {
    try { fs.appendFileSync(AUDIT, JSON.stringify(Object.assign({ at: new Date().toISOString(), who: me ? me.name : '?', role: me ? me.role : '', what }, extra || {})) + '\n'); } catch (e) { /* sin registro */ }
  }
  function cookieHeader(req, value, maxAge) {
    const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  const GATE_HTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/png" href="/api/bravo/icon-64.png"><link rel="apple-touch-icon" href="/api/bravo/icon-180.png">
<title>Bravo Transfers</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#faf6ee;color:#17120d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px;box-sizing:border-box}
.box{width:100%;max-width:340px;text-align:center}.logo{width:180px;height:auto;display:block;margin:0 auto 8px}
h1{font-family:Georgia,serif;letter-spacing:.06em;margin:0 0 4px;font-size:1.6rem}p{color:#6f6252;margin:0 0 22px;font-size:.92rem}
input{width:100%;box-sizing:border-box;padding:14px;border-radius:10px;border:1.5px solid #e7dccb;background:#fff;color:#17120d;font-size:16px;margin-bottom:12px}
button{width:100%;padding:14px;border:0;border-radius:10px;background:linear-gradient(135deg,#e5b44b,#df7a2c);color:#17120d;font-weight:700;font-size:16px}
#e{color:#b3261e;min-height:1.2em;margin-top:10px;font-size:.9rem}</style></head><body><form class="box" id="f">
<img class="logo" src="/api/bravo/logo.png" alt=""><h1>BRAVO TRANSFERS</h1><p>En preparación · Coming soon</p>
<input id="u" placeholder="Usuario" autocomplete="username" autocapitalize="none" hidden>
<input type="password" id="k" placeholder="Contraseña" autocomplete="current-password" required>
<button>Entrar</button><div id="e"></div>
<a href="#" id="t" style="display:inline-block;margin-top:14px;color:#6f6252;font-size:.9rem">Entrar con usuario</a></form><script>
document.getElementById('t').addEventListener('click',function(ev){ev.preventDefault();var u=document.getElementById('u');u.hidden=!u.hidden;this.textContent=u.hidden?'Entrar con usuario':'Entrar solo con la contraseña';if(!u.hidden)u.focus();});
document.getElementById('f').addEventListener('submit',async function(ev){ev.preventDefault();
var e=document.getElementById('e');e.textContent='';var u=document.getElementById('u');
var body=u.hidden?{key:document.getElementById('k').value}:{user:u.value,password:document.getElementById('k').value};
try{var r=await fetch('/api/bravo/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
if(r.ok){location.reload();return;}e.textContent=r.status===429?'Demasiados intentos. Espera un rato.':u.hidden?'Contraseña incorrecta.':'Usuario o contraseña incorrectos.';}
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
    // Parada en el camino: los km pasan por ella
    const via = d.via ? point(d.via, SPAIN_BOX) : null;
    if (d.via && !via) return { error: 'bad_via' };
    let route;
    try {
      if (via) {
        const a = await drive(from, via), b = await drive(via, to);
        route = a && b ? { km: Math.round((a.km + b.km) * 10) / 10, minutes: a.minutes + b.minutes } : null;
      } else route = await drive(from, to);
    } catch (e) { return { error: 'route_unavailable' }; }
    if (!route) return { error: 'no_route' };
    if (route.km < 0.5) return { error: 'same_place' };
    const roundTrip = Boolean(d.roundTrip);
    return {
      kind, passengers, from, to, via, roundTrip, km: route.km, minutes: route.minutes,
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
      let key = '', ld = {};
      try { ld = JSON.parse(await readBody(req, 2000)); key = String(ld.key || ''); } catch (e) { /* vacío */ }
      if (ld.user) {
        // Un usuario del panel (no Alberto)
        const name = String(ld.user).trim().toLowerCase(), uk = 'fail:u:' + crypto.createHash('sha256').update(name).digest('hex');
        if (over(uk, 8, 3600000)) return json(res, 429, { error: 'too_many_attempts' });
        const list = users(), u = list.find((x) => x.user === name && x.active !== false);
        let good = false;
        if (u) { const a1 = Buffer.from(hashPw(String(ld.password || '').slice(0, 200), u.salt), 'hex'), b1 = Buffer.from(u.pw, 'hex'); good = a1.length === b1.length && crypto.timingSafeEqual(a1, b1); }
        if (!good) { over('fail:' + ip, 10, 900000, true); over('fail:all', 60, 3600000, true); over(uk, 8, 3600000, true); return json(res, 401, { error: 'wrong_login' }); }
        const tok = crypto.randomBytes(24).toString('hex');
        u.sessions = (u.sessions || []).filter((x) => x.exp > Date.now()).slice(-4);
        u.sessions.push({ h: crypto.createHash('sha256').update(tok).digest('hex'), exp: Date.now() + 30 * 86400000 });
        u.lastLogin = new Date().toISOString();
        writeJson(USERS, list);
        audit({ name: u.name, role: 'operador' }, 'entra en el panel');
        return json(res, 200, { ok: true, role: 'operador' }, { 'Set-Cookie': opCookie(req, tok, 30 * 86400) });
      }
      const a = Buffer.from(key), b = Buffer.from(KEY);
      if (!KEY || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        over('fail:' + ip, 10, 900000, true);
        over('fail:all', 60, 3600000, true);
        return json(res, 401, { error: 'wrong_key', key_configured: Boolean(KEY) });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, TOKEN, 30 * 86400) });
    }
    if (req.method === 'POST' && route === 'logout') {
      const os = opSession(req);
      if (os) { os.u.sessions = os.u.sessions.filter((x) => x.h !== os.h); writeJson(USERS, os.list); }
      res.setHeader('Set-Cookie', [cookieHeader(req, '', 0), opCookie(req, '', 0)]);
      return json(res, 200, { ok: true });
    }

    // El logo y los iconos: públicos (la pantalla de la contraseña y el icono del iPhone los necesitan)
    const IMG = { 'logo.png': 'logo.png', 'icon-180.png': 'apple-touch-icon.png', 'icon-64.png': 'icon-64.png', 'hero.jpg': 'hero.jpg' };
    if (req.method === 'GET' && IMG[route]) {
      let buf;
      try { buf = fs.readFileSync(path.join(__dirname, 'bravo', IMG[route])); } catch (e) { return json(res, 404, { error: 'not_found' }); }
      res.writeHead(200, { 'Content-Type': /\.jpg$/.test(IMG[route]) ? 'image/jpeg' : 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
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
    const docm = /^doc\/([a-f0-9]{32})\/(justificante|factura|hoja|presupuesto)\.pdf$/.exec(route);
    if (req.method === 'GET' && docm) {
      if (over('doc:' + ip, 200, 3600000, true)) return json(res, 429, { error: 'too_many' });
      const [, tok, kind] = docm;
      const isDriver = kind === 'hoja';
      const b = allBookings().find((x) => (isDriver ? x.driverToken : x.clientToken) === tok);
      if (!b || (kind === 'factura' && !b.invoice) || (kind === 'presupuesto' && !b.quote)) return json(res, 404, { error: 'not_found' });
      if (kind === 'presupuesto') {
        const qb = pdf.quotePdf(b, issuerFull());
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': qb.length, 'Content-Disposition': 'inline; filename="' + b.quote.number + '.pdf"',
          'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
        return res.end(qb);
      }
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
    const me = whoIs(req);
    if (me.role !== 'admin' && route.startsWith('admin/') && !OP_ROUTES.has(req.method + ' ' + route)) return json(res, 403, { error: 'forbidden' });
    if (req.method === 'POST' && route.startsWith('admin/') && !['admin/messages/read', 'admin/reminders/run', 'admin/update', 'admin/book'].includes(route)) audit(me, route);
    const cfg = settings();
    if (req.method === 'GET' && route === 'admin/me') return json(res, 200, { role: me.role, name: me.name });

    // ---------- usuarios del panel y registro de cambios (solo Alberto) ----------
    if (req.method === 'GET' && route === 'admin/users') {
      return json(res, 200, { users: users().map((u) => ({ id: u.id, name: u.name, user: u.user, active: u.active !== false, createdAt: u.createdAt, lastLogin: u.lastLogin || null })) });
    }
    if (req.method === 'POST' && (route === 'admin/users/save' || route === 'admin/users/delete')) {
      let d;
      try { d = JSON.parse(await readBody(req, 2000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const list = users();
      if (route === 'admin/users/delete') { writeJson(USERS, list.filter((x) => x.id !== d.id)); return json(res, 200, { ok: true }); }
      const name = clean(d.name, 60), user = String(d.user || '').trim().toLowerCase();
      if (name.length < 2) return json(res, 400, { error: 'bad_name' });
      if (!/^[a-z0-9._-]{3,30}$/.test(user)) return json(res, 400, { error: 'bad_user' });
      if (list.some((x) => x.user === user && x.id !== d.id)) return json(res, 400, { error: 'user_taken' });
      let u = d.id ? list.find((x) => x.id === d.id) : null;
      if (d.id && !u) return json(res, 404, { error: 'not_found' });
      const pw = String(d.password || '');
      if ((!u || pw) && (pw.length < 10 || pw.length > 200)) return json(res, 400, { error: 'short_password' });
      if (!u) { u = { id: crypto.randomBytes(4).toString('hex'), createdAt: new Date().toISOString(), sessions: [] }; list.push(u); }
      Object.assign(u, { name, user, role: 'operador', active: d.active !== false });
      if (pw) { u.salt = crypto.randomBytes(16).toString('hex'); u.pw = hashPw(pw, u.salt); u.sessions = []; }
      if (!u.active) u.sessions = [];
      writeJson(USERS, list);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && route === 'admin/audit') {
      let lines = [];
      try { lines = fs.readFileSync(AUDIT, 'utf8').trim().split('\n').filter(Boolean).slice(-300).reverse().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) { /* vacío */ }
      return json(res, 200, { entries: lines });
    }

    if (req.method === 'GET' && route === 'config') {
      return json(res, 200, {
        vehicles: Object.fromEntries(Object.entries(cfg.vehicles).map(([id, v]) => [id, { seats: v.seats }])),
        minHoursAhead: cfg.minHoursAhead, hourly: cfg.hourly
      });
    }

    // Buscador de direcciones (por el servidor: lista propia, lo ya buscado, OpenStreetMap y plan B)
    if (req.method === 'GET' && (route === 'geo' || route === 'geo/suggest')) {
      if (over('geo:' + ip, route === 'geo' ? 120 : 600, 3600000, true)) return json(res, 429, { error: 'too_many' });
      const sp = new URL(url, 'http://x').searchParams;
      const q = String(sp.get('q') || '').slice(0, 160), lang = sp.get('lang') === 'en' ? 'en' : 'es';
      if (route === 'geo/suggest') return json(res, 200, { results: geo.suggest(q, lang) });
      return json(res, 200, await geo.search(q, lang));
    }
    if (req.method === 'GET' && route === 'routes') {
      if (over('routes:' + ip, 60, 3600000, true)) return json(res, 429, { error: 'too_many' });
      // hero: si hay foto de portada (bravo/hero.jpg), para no pedirla en balde
      return json(res, 200, { from: AGP, routes: await routePrices(), hero: fs.existsSync(path.join(__dirname, 'bravo', 'hero.jpg')) });
    }

    if (req.method === 'POST' && route === 'quote') {
      if (over('quote:' + ip, 120, 3600000, true)) return json(res, 429, { error: 'too_many' });
      let d;
      try { d = JSON.parse(await readBody(req, 4000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const trip = await readTrip(d, cfg);
      if (trip.error) return json(res, 400, trip);
      const disc = discountFor(d);
      if (disc.badCode) return json(res, 400, { error: 'bad_code' });
      return json(res, 200, applyDiscount(trip, disc));
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
      const disc = discountFor(d);
      if (disc.badCode) return json(res, 400, { error: 'bad_code' });
      const base = {
        createdAt: new Date().toISOString(), lang, date, time, ...who, partner: disc.partner,
        comments: cleanLong(d.comments, 1000),
        status: 'pendiente', driverName: '', driverPhone: '', driverPay: null, ministry: false, notes: '',
        payment: 'sin cobrar (pruebas)', source: 'web'
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
        const acct = afterBooking(b);
        return json(res, 200, { ref: b.ref, kind: 'group', newAccount: acct.newAccount, emailOn: mail.configured(), area: '/bravo/cuenta/' });
      }

      if (when < Date.now() + cfg.minHoursAhead * 3600000) return json(res, 400, { error: 'too_soon', minHoursAhead: cfg.minHoursAhead });
      const trip = await readTrip(d, cfg);
      if (trip.error) return json(res, 400, trip);
      applyDiscount(trip, disc);
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
        flight: clean(d.flight, 12), bags: int(d.bags, 0, 20) || 0, childSeats: int(d.childSeats, 0, 6) || 0,
        via: trip.via || null, meetSign: Boolean(d.meetSign), special: SPECIAL[d.special] ? d.special : ''
      }, base);
      if (trip.discount) {
        b.discount = { pct: trip.discount.pct, code: trip.discount.code, amount: Math.round((opt.fullPrice - opt.price) * 100) / 100 };
        if (trip.discount.code) { const cs = codes(), c = cs.find((x) => x.code === trip.discount.code); if (c) { c.uses = (c.uses || 0) + 1; writeJson(CODES, cs); } }
      }
      ensureTokens(b);
      saveBooking(b);
      const acct = afterBooking(b);
      return json(res, 200, { ref: b.ref, kind: b.kind, price: b.price, km: b.km, paid: pdf.isPaid(b), doc: '/api/bravo/doc/' + b.clientToken + '/justificante.pdf',
        invoiceDoc: activeInvoice(b) ? '/api/bravo/doc/' + b.clientToken + '/f/' + b.invoice.number + '.pdf' : '', newAccount: acct.newAccount, emailOn: mail.configured(), area: '/bravo/cuenta/' });
    }

    // ---------- área de cliente ----------
    if (route.startsWith('customer/')) {
      const sub = route.slice('customer/'.length);
      if (req.method === 'POST' && (sub === 'login' || sub === 'link')) {
        if (over('clogin:' + ip, 10, 900000) || over('clogin:all', 300, 3600000)) return json(res, 429, { error: 'too_many_attempts' });
        let d;
        try { d = JSON.parse(await readBody(req, 2000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const list = customers();
        let c = null;
        const ekey = 'clogin:e:' + sha(normEmail(d.email));
        if (sub === 'login' && over(ekey, 8, 3600000)) return json(res, 429, { error: 'too_many_attempts' });
        if (sub === 'login') {
          const cand = list.find((x) => x.email === normEmail(d.email));
          if (cand && cand.pw) {
            const a = Buffer.from(hashPw(String(d.password || '').slice(0, 200), cand.salt), 'hex'), b2 = Buffer.from(cand.pw, 'hex');
            if (a.length === b2.length && crypto.timingSafeEqual(a, b2)) c = cand;
          }
        } else if (/^[a-f0-9]{48}$/.test(d.token || '')) {
          const h = sha(d.token);
          c = list.find((x) => (x.tokens || []).some((t) => t.h === h && t.exp > Date.now()));
          if (c) c.tokens = c.tokens.filter((t) => t.h !== h); // el enlace vale una sola vez
        }
        if (!c) {
          over('clogin:' + ip, 10, 900000, true); over('clogin:all', 300, 3600000, true);
          if (sub === 'login') over(ekey, 8, 3600000, true);
          return json(res, 401, { error: sub === 'login' ? 'wrong_login' : 'bad_link' });
        }
        const tok = newSession(c);
        c.lastLogin = new Date().toISOString();
        saveCustomers(list);
        return json(res, 200, { ok: true }, { 'Set-Cookie': custCookie(req, tok, 60 * 86400) });
      }
      if (req.method === 'POST' && sub === 'forgot') {
        if (over('cforgot:' + ip, 5, 3600000, true)) return json(res, 429, { error: 'too_many' });
        let d;
        try { d = JSON.parse(await readBody(req, 1000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const list = customers(), c = list.find((x) => x.email === normEmail(d.email));
        if (c && mail.configured() && !over('cforgot:e:' + c.id, 3, 3600000, true)) {
          const tok = loginToken(c, 2);
          saveCustomers(list);
          const m = TPL.loginEmail(c, { url: areaUrl(tok), hours: 2, base: BASE });
          mail.send({ to: c.email, toName: c.name, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
        }
        // La misma respuesta exista o no la cuenta (para no delatar qué correos son clientes)
        return json(res, 200, { ok: true, emailOn: mail.configured() });
      }
      if (req.method === 'POST' && sub === 'logout') {
        const cur = currentCustomer(req);
        if (cur) { cur.c.sessions = cur.c.sessions.filter((x) => x.h !== cur.h); saveCustomers(cur.list); }
        return json(res, 200, { ok: true }, { 'Set-Cookie': custCookie(req, '', 0) });
      }
      const cur = currentCustomer(req);
      if (!cur) return json(res, 401, { error: 'no_session' });
      const { c, list } = cur;
      if (req.method === 'POST' && sub === 'read') {
        const all = messages();
        for (const m of all) if (m.customerId === c.id && m.from === 'bravo') m.readByCustomer = true;
        saveMessages(all);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && sub === 'me') {
        const all = messages();
        const bookings = mine(c).sort((a, b2) => (b2.date + b2.time).localeCompare(a.date + a.time)).map((b) => custView(b, cfg));
        return json(res, 200, {
          customer: { email: c.email, name: c.name, phone: c.phone || '', lang: c.lang || 'es' }, bookings, cancelHours: cfg.cancelHours,
          newFromBravo: all.filter((m) => m.customerId === c.id && m.from === 'bravo' && !m.readByCustomer).length,
          messages: all.filter((m) => m.customerId === c.id).map((m) => ({ from: m.from, text: m.text, ref: m.ref || '', kind: m.kind || 'mensaje', at: m.at }))
        });
      }
      if (req.method === 'POST' && sub === 'profile') {
        let d;
        try { d = JSON.parse(await readBody(req, 2000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const name = clean(d.name, 80), phone = clean(d.phone, 25);
        if (name.length < 2) return json(res, 400, { error: 'bad_name' });
        if (phone && !/^\+?[0-9 ()-]{6,24}$/.test(phone)) return json(res, 400, { error: 'bad_phone' });
        c.name = name; c.phone = phone; c.lang = d.lang === 'en' ? 'en' : 'es';
        saveCustomers(list);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'password') {
        let d;
        try { d = JSON.parse(await readBody(req, 2000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const a = Buffer.from(hashPw(String(d.current || '').slice(0, 200), c.salt), 'hex'), b2 = Buffer.from(c.pw, 'hex');
        if (!(a.length === b2.length && crypto.timingSafeEqual(a, b2))) return json(res, 400, { error: 'wrong_password' });
        const np = String(d.next || '');
        if (np.length < 8 || np.length > 200) return json(res, 400, { error: 'short_password' });
        c.salt = crypto.randomBytes(16).toString('hex'); c.pw = hashPw(np, c.salt);
        c.sessions = c.sessions.filter((x) => x.h === cur.h); // cierra la sesión en los demás aparatos
        saveCustomers(list);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'cancel') {
        let d;
        try { d = JSON.parse(await readBody(req, 1000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const b = mine(c).find((x) => x.ref === d.ref);
        if (!b) return json(res, 404, { error: 'not_found' });
        if (!custView(b, cfg).canCancel) return json(res, 400, { error: 'cannot_cancel', cancelHours: cfg.cancelHours });
        b.status = 'cancelada'; b.cancelledBy = 'cliente'; b.cancelledAt = new Date().toISOString();
        saveBooking(b);
        const all = messages();
        all.push({ id: crypto.randomBytes(5).toString('hex'), customerId: c.id, from: 'sistema', text: (c.lang === 'en' ? 'Booking ' + b.ref + ' cancelled by the customer.' : 'Reserva ' + b.ref + ' cancelada por el cliente.'), ref: b.ref, kind: 'cancelación', at: new Date().toISOString(), readByBravo: false, readByCustomer: true });
        saveMessages(all);
        notifyOwner('Cancelación de ' + b.ref, ['El cliente ' + c.name + ' (' + c.email + ') ha cancelado la reserva ' + b.ref + ' del ' + b.date + ' a las ' + b.time + '.', activeInvoice(b) ? 'Tiene la factura ' + b.invoice.number + ': hay que hacer la rectificativa (y devolver el dinero si lo pagó).' : '']);
        return json(res, 200, { ok: true, booking: custView(b, cfg), invoiced: activeInvoice(b) });
      }
      if (req.method === 'POST' && sub === 'quote') {
        let d;
        try { d = JSON.parse(await readBody(req, 1000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const b = mine(c).find((x) => x.ref === d.ref);
        if (!b || !b.quote) return json(res, 404, { error: 'not_found' });
        if (!custView(b, cfg).quote.canAnswer) return json(res, 400, { error: 'cannot_answer' });
        if (d.action === 'accept') acceptQuote(b, 'cliente');
        else if (d.action === 'reject') { b.quote.status = 'rechazado'; b.quote.rejectedAt = new Date().toISOString(); }
        else return json(res, 400, { error: 'bad_action' });
        saveBooking(b);
        if (d.action === 'accept' && b.email) setImmediate(() => { sendBookingEmail(b.ref, { update: true }).catch(() => {}); });
        notifyOwner('Presupuesto ' + b.quote.number + (d.action === 'accept' ? ' ACEPTADO' : ' rechazado') + ' (' + b.ref + ')',
          [c.name + ' (' + c.email + ') ha ' + (d.action === 'accept' ? 'aceptado' : 'rechazado') + ' el presupuesto ' + b.quote.number + ' de ' + b.quote.price + ' € para el ' + b.date + ' a las ' + b.time + '.']);
        return json(res, 200, { ok: true, booking: custView(b, cfg) });
      }
      if (req.method === 'POST' && sub === 'message') {
        if (over('cmsg:' + c.id, 30, 3600000, true)) return json(res, 429, { error: 'too_many' });
        let d;
        try { d = JSON.parse(await readBody(req, 6000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        const text = cleanLong(d.text, 2000);
        if (!text) return json(res, 400, { error: 'empty' });
        const ref = d.ref && mine(c).some((x) => x.ref === d.ref) ? d.ref : '';
        const kind = d.kind === 'cambio' ? 'cambio' : 'mensaje';
        const all = messages();
        all.push({ id: crypto.randomBytes(5).toString('hex'), customerId: c.id, from: 'cliente', text, ref, kind, at: new Date().toISOString(), readByBravo: false });
        saveMessages(all);
        notifyOwner((kind === 'cambio' ? 'Petición de cambio' : 'Mensaje') + ' de ' + c.name + (ref ? ' (' + ref + ')' : ''), [text, 'Cliente: ' + c.name + ' · ' + c.email + (c.phone ? ' · ' + c.phone : '')]);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not_found' });
    }

    // ---------- mensajes de los clientes, para el panel ----------
    if (req.method === 'GET' && route === 'admin/messages') {
      const all = messages(), cs = customers();
      const threads = cs.map((c) => {
        const ms = all.filter((m) => m.customerId === c.id);
        return { customer: { id: c.id, email: c.email, name: c.name, phone: c.phone || '', lang: c.lang || 'es', lastLogin: c.lastLogin || null }, messages: ms,
          unread: ms.filter((m) => m.from !== 'bravo' && !m.readByBravo).length, last: ms.length ? ms[ms.length - 1].at : c.createdAt,
          bookings: mine(c).map((b) => ({ ref: b.ref, date: b.date, status: b.status })) };
      }).sort((a, b) => (b.unread - a.unread) || String(b.last).localeCompare(String(a.last)));
      return json(res, 200, { threads, unread: threads.reduce((a, t) => a + t.unread, 0), emailOn: mail.configured() });
    }
    if (req.method === 'POST' && (route === 'admin/messages/reply' || route === 'admin/messages/read')) {
      let d;
      try { d = JSON.parse(await readBody(req, 6000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const cl = customers(), c = cl.find((x) => x.id === d.customerId);
      if (!c) return json(res, 404, { error: 'not_found' });
      const all = messages();
      for (const m of all) if (m.customerId === c.id && m.from !== 'bravo') m.readByBravo = true;
      if (route === 'admin/messages/read') { saveMessages(all); return json(res, 200, { ok: true }); }
      const text = cleanLong(d.text, 2000);
      if (!text) return json(res, 400, { error: 'empty' });
      all.push({ id: crypto.randomBytes(5).toString('hex'), customerId: c.id, from: 'bravo', text, ref: clean(d.ref, 12), kind: 'mensaje', at: new Date().toISOString(), readByBravo: true, readByCustomer: false });
      saveMessages(all);
      let emailed = false;
      if (mail.configured()) {
        const tok = loginToken(c, 14 * 24);
        saveCustomers(cl);
        const m = TPL.messageEmail(c, text, { url: areaUrl(tok), base: BASE });
        const r = await mail.send({ to: c.email, toName: c.name, subject: m.subject, html: m.html, text: m.text });
        emailed = r.ok;
      }
      return json(res, 200, { ok: true, emailed });
    }
    if (req.method === 'POST' && route === 'admin/reminders/run') {
      const r = await runReminders(true);
      return json(res, 200, r);
    }
    if (req.method === 'GET' && route === 'admin/payment.pdf') {
      const sp = new URL(url, 'http://x').searchParams;
      const p = payment(sp.get('type'), sp.get('key'));
      if (!p || !p.paid) return json(res, 404, { error: 'not_found' });
      const buf = pdf.paymentPdf(p, issuerFull());
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Content-Disposition': 'inline; filename="justificante-pago.pdf"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    }
    if (req.method === 'POST' && route === 'admin/pay-email') {
      let d;
      try { d = JSON.parse(await readBody(req, 1000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const r = await sendPaymentEmail(String(d.type || ''), String(d.key || ''));
      return json(res, r.ok ? 200 : (r.error === 'not_found' ? 404 : r.error && r.error.startsWith('HTTP') ? 502 : 400), r);
    }
    if (req.method === 'POST' && route === 'admin/email-booking') {
      let d;
      try { d = JSON.parse(await readBody(req, 1000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      if (!/^BT-\d{4,6}$/.test(d.ref || '')) return json(res, 400, { error: 'bad_ref' });
      if (!mail.configured()) return json(res, 400, { error: 'email_not_configured' });
      const r = await sendBookingEmail(d.ref, { update: true });
      return json(res, r.ok ? 200 : 502, r);
    }

    // ---------- reserva a mano (teléfono, WhatsApp, hotel…) ----------
    if (req.method === 'POST' && route === 'admin/book') {
      let d;
      try { d = JSON.parse(await readBody(req, 12000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const kind = ['transfer', 'hourly', 'group'].includes(d.kind) ? d.kind : 'transfer';
      const name = clean(d.name, 80), phone = clean(d.phone, 25), email = clean(d.email, 120).toLowerCase();
      if (name.length < 2) return json(res, 400, { error: 'bad_name' });
      if (phone && !/^\+?[0-9 ()-]{6,24}$/.test(phone)) return json(res, 400, { error: 'bad_phone' });
      if (email && !isEmail(email)) return json(res, 400, { error: 'bad_email' });
      if (!phone && !email) return json(res, 400, { error: 'need_contact' });
      const date = clean(d.date, 10), time = clean(d.time, 5);
      if (!madridMs(date, time)) return json(res, 400, { error: 'bad_date' });
      const fromText = clean(d.fromText, 160), toText = clean(d.toText, 160);
      if (!fromText) return json(res, 400, { error: 'bad_places' });
      if (kind !== 'hourly' && !toText) return json(res, 400, { error: 'bad_places' });
      const passengers = int(d.passengers, 1, 500);
      if (!passengers) return json(res, 400, { error: 'bad_passengers' });
      if (me.role !== 'admin') d.price = null;
      const price = d.price === '' || d.price == null ? null : num(d.price, 0, 100000, 2);
      if (price === null && !(d.price === '' || d.price == null)) return json(res, 400, { error: 'bad_price' });
      const hours = kind === 'hourly' ? int(d.hours, 1, 24) : null;
      if (kind === 'hourly' && !hours) return json(res, 400, { error: 'bad_hours' });
      let returnDate = '', returnTime = '';
      const roundTrip = kind === 'transfer' && Boolean(d.roundTrip);
      if (roundTrip) {
        returnDate = clean(d.returnDate, 10); returnTime = clean(d.returnTime, 5);
        const back = madridMs(returnDate, returnTime);
        if (!back || back <= madridMs(date, time)) return json(res, 400, { error: 'bad_return' });
      }
      const km = d.km === '' || d.km == null ? null : num(d.km, 0, 5000, 1);
      const SOURCES = ['teléfono', 'whatsapp', 'correo', 'hotel', 'agencia', 'otro'];
      const b = {
        ref: nextRef(), kind, createdAt: new Date().toISOString(), lang: d.lang === 'en' ? 'en' : 'es', date, time, name, phone, email,
        comments: cleanLong(d.comments, 1000), status: 'pendiente', driverName: '', driverPhone: '', driverPay: null, ministry: false,
        notes: cleanLong(d.notes, 2000), payment: clean(d.payment, 60) || 'sin cobrar', source: SOURCES.includes(d.source) ? d.source : 'otro',
        passengers, price, manual: true, partner: partners().some((x) => x.code === String(d.partner || '')) ? String(d.partner) : ''
      };
      if (kind === 'group') Object.assign(b, { fromText, toText });
      else Object.assign(b, {
        from: { label: fromText }, to: kind === 'hourly' ? null : { label: toText }, roundTrip, returnDate, returnTime, hours, km, minutes: null,
        vehicle: ['car', 'van'].includes(d.vehicle) ? d.vehicle : '', flight: clean(d.flight, 12), bags: int(d.bags, 0, 20) || 0, childSeats: int(d.childSeats, 0, 6) || 0,
        via: clean(d.viaText, 160) ? { label: clean(d.viaText, 160) } : null, meetSign: Boolean(d.meetSign), special: SPECIAL[d.special] ? d.special : ''
      });
      ensureTokens(b);
      saveBooking(b);
      b.history = [{ at: new Date().toISOString(), who: me.name, fields: ['reserva creada a mano'] }];
      const acct = afterBooking(b, { sendEmail: d.sendEmail === true });
      audit(me, 'reserva a mano', { ref: b.ref });
      const saved = JSON.parse(fs.readFileSync(bookingFile(b.ref), 'utf8'));
      return json(res, 200, { ok: true, booking: me.role === 'admin' ? saved : forOperator(saved), newAccount: acct.newAccount });
    }

    // ---------- presupuestos ----------
    if (req.method === 'POST' && (route === 'admin/quote' || route === 'admin/quote/status')) {
      let d;
      try { d = JSON.parse(await readBody(req, 4000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      if (!/^BT-\d{4,6}$/.test(d.ref || '')) return json(res, 400, { error: 'bad_ref' });
      let b;
      try { b = JSON.parse(fs.readFileSync(bookingFile(d.ref), 'utf8')); } catch (e) { return json(res, 404, { error: 'not_found' }); }
      if (activeInvoice(b)) return json(res, 409, { error: 'invoiced' });
      if (route === 'admin/quote') {
        const price = num(d.price, 1, 100000, 2);
        if (price == null) return json(res, 400, { error: 'bad_price' });
        const days = int(d.validDays, 1, 90) || 7;
        if (b.quote) b.quotes = (b.quotes || []).concat([b.quote]);
        b.quote = { number: nextInvoiceNumber(today().slice(0, 4), 'P'), date: today(), price, validUntil: addDays(today(), days), notes: cleanLong(d.notes, 600),
          status: 'enviado', createdAt: new Date().toISOString() };
        saveBooking(b);
        let emailed = false;
        if (d.sendEmail && isEmail(b.email) && mail.configured()) { const r = await sendQuoteEmail(b.ref); emailed = r.ok; }
        return json(res, 200, { ok: true, booking: JSON.parse(fs.readFileSync(bookingFile(b.ref), 'utf8')), emailed });
      }
      if (!b.quote) return json(res, 404, { error: 'no_quote' });
      if (d.status === 'aceptado') acceptQuote(b, 'Alberto');
      else if (d.status === 'rechazado') { b.quote.status = 'rechazado'; b.quote.rejectedAt = new Date().toISOString(); }
      else return json(res, 400, { error: 'bad_status' });
      saveBooking(b);
      return json(res, 200, { ok: true, booking: b });
    }

    // ---------- hoteles y agencias ----------
    if (req.method === 'GET' && route === 'admin/partners' && me.role !== 'admin') return json(res, 200, { partners: partners().map((p) => ({ id: p.id, code: p.code, name: p.name, type: p.type, active: p.active })) });
    if (req.method === 'GET' && route === 'admin/partners') {
      const all = allBookings(), month = today().slice(0, 7);
      return json(res, 200, { partners: partners().map((p) => {
        const mine2 = all.filter((b) => b.partner === p.code && b.status !== 'cancelada');
        const now = mine2.filter((b) => b.date.slice(0, 7) === month);
        return Object.assign({}, p, { total: mine2.length, thisMonth: now.length, thisMonthSum: Math.round(now.reduce((a, b) => a + (b.price || 0), 0) * 100) / 100 });
      }) });
    }
    if (req.method === 'POST' && (route === 'admin/partners/save' || route === 'admin/partners/delete')) {
      let d;
      try { d = JSON.parse(await readBody(req, 4000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const list = partners();
      if (route === 'admin/partners/delete') {
        writeJson(PARTNERS, list.filter((x) => x.id !== d.id));
        return json(res, 200, { ok: true });
      }
      const name = clean(d.name, 80);
      if (name.length < 2) return json(res, 400, { error: 'bad_name' });
      const code = String(d.code || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(code)) return json(res, 400, { error: 'bad_code' });
      if (list.some((x) => x.code === code && x.id !== d.id)) return json(res, 400, { error: 'code_taken' });
      if (d.email && !isEmail(d.email)) return json(res, 400, { error: 'bad_email' });
      const commission = num(d.commission === '' || d.commission == null ? 0 : d.commission, 0, 50, 2), discount = num(d.discount === '' || d.discount == null ? 0 : d.discount, 0, 50, 2);
      if (commission == null || discount == null) return json(res, 400, { error: 'bad_percent' });
      let p = d.id ? list.find((x) => x.id === d.id) : null;
      if (d.id && !p) return json(res, 404, { error: 'not_found' });
      if (!p) { p = { id: crypto.randomBytes(4).toString('hex'), createdAt: new Date().toISOString() }; list.push(p); }
      Object.assign(p, { name, code, type: ['hotel', 'agencia', 'empresa', 'otro'].includes(d.type) ? d.type : 'hotel', contact: clean(d.contact, 80), email: clean(d.email, 120),
        phone: clean(d.phone, 25), taxId: clean(d.taxId, 30), commission, discount, notes: cleanLong(d.notes, 500), active: d.active !== false });
      writeJson(PARTNERS, list);
      return json(res, 200, { ok: true, partner: p });
    }
    if (req.method === 'GET' && route === 'admin/partners/statement.pdf') {
      const sp = new URL(url, 'http://x').searchParams;
      const p = partners().find((x) => x.id === sp.get('id')), month = sp.get('month') || '';
      if (!p || !/^\d{4}-\d{2}$/.test(month)) return json(res, 404, { error: 'not_found' });
      const rows = allBookings().filter((b) => b.partner === p.code && b.status !== 'cancelada' && b.date.slice(0, 7) === month)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .map((b) => ({ date: b.date, ref: b.ref, name: b.name, route: b.kind === 'group' ? b.fromText + ' → ' + b.toText : ((b.from && b.from.label) || '') + (b.kind === 'hourly' ? ' (' + b.hours + ' h)' : ' → ' + ((b.to && b.to.label) || '')),
          price: b.price || 0, commission: Math.round((b.price || 0) * (p.commission || 0)) / 100, invoice: activeInvoice(b) ? b.invoice.number : '' }));
      const buf = pdf.partnerPdf(p, month, rows, issuerFull());
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length, 'Content-Disposition': 'inline; filename="' + p.code + '-' + month + '.pdf"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    }

    // ---------- códigos de descuento ----------
    if (req.method === 'GET' && route === 'admin/codes') return json(res, 200, { codes: codes() });
    if (req.method === 'POST' && (route === 'admin/codes/save' || route === 'admin/codes/delete')) {
      let d;
      try { d = JSON.parse(await readBody(req, 2000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const code = String(d.code || '').trim().toUpperCase();
      const list = codes();
      if (route === 'admin/codes/delete') { writeJson(CODES, list.filter((x) => x.code !== code)); return json(res, 200, { ok: true, codes: codes() }); }
      if (!/^[A-Z0-9][A-Z0-9-]{2,19}$/.test(code)) return json(res, 400, { error: 'bad_code' });
      const percent = num(d.percent, 1, 50, 2);
      if (percent == null) return json(res, 400, { error: 'bad_percent' });
      if (d.validUntil && !isDay(d.validUntil)) return json(res, 400, { error: 'bad_date' });
      let c = list.find((x) => x.code === code);
      if (!c) { c = { code, uses: 0, createdAt: new Date().toISOString() }; list.push(c); }
      Object.assign(c, { percent, validUntil: d.validUntil || '', maxUses: int(d.maxUses, 1, 100000) || 0, note: clean(d.note, 80), active: d.active !== false });
      writeJson(CODES, list);
      return json(res, 200, { ok: true, codes: list });
    }

    // ---------- incidencias de un viaje (retraso, queja, objeto perdido…) ----------
    if (req.method === 'POST' && route === 'admin/incident') {
      let d;
      try { d = JSON.parse(await readBody(req, 4000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      if (!/^BT-\d{4,6}$/.test(d.ref || '')) return json(res, 400, { error: 'bad_ref' });
      let b;
      try { b = JSON.parse(fs.readFileSync(bookingFile(d.ref), 'utf8')); } catch (e) { return json(res, 404, { error: 'not_found' }); }
      b.incidents = b.incidents || [];
      const KINDS = ['retraso', 'queja', 'objeto perdido', 'accidente', 'daños', 'otro'];
      if (d.action === 'add') {
        const text = cleanLong(d.text, 1000);
        if (!text) return json(res, 400, { error: 'empty' });
        b.incidents.push({ id: crypto.randomBytes(4).toString('hex'), at: new Date().toISOString(), kind: KINDS.includes(d.kind) ? d.kind : 'otro', text, resolved: false });
      } else {
        const it = b.incidents.find((x) => x.id === d.id);
        if (!it) return json(res, 404, { error: 'not_found' });
        if (d.action === 'resolve') { it.resolved = true; it.resolvedAt = new Date().toISOString(); }
        else if (d.action === 'reopen') { it.resolved = false; it.resolvedAt = null; }
        else if (d.action === 'delete') b.incidents = b.incidents.filter((x) => x !== it);
        else return json(res, 400, { error: 'bad_action' });
      }
      b.history = (b.history || []).concat([{ at: new Date().toISOString(), who: me.name, fields: ['incidencia: ' + (d.action === 'add' ? 'nueva' : d.action)] }]).slice(-30);
      saveBooking(b);
      return json(res, 200, { ok: true, booking: me.role === 'admin' ? b : forOperator(b) });
    }

    if (req.method === 'GET' && route === 'admin/bookings') {
      const list = allBookings().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      for (const b of list) if (ensureTokens(b)) saveBooking(b);
      return json(res, 200, { bookings: me.role === 'admin' ? list : list.map(forOperator) });
    }

    if (route === 'admin/settings' && me.role !== 'admin') {
      return json(res, 200, { role: me.role, email: { configured: mail.configured(), provider: mail.provider }, notifyCompany: settings().notifyCompany, reviewUrl: settings().reviewUrl, invoice: { defaultVat: 0 } });
    }
    if (route === 'admin/settings') {
      if (req.method === 'GET') {
        const s = settings();
        return json(res, 200, { vehicles: s.vehicles, minHoursAhead: s.minHoursAhead, invoice: s.invoice, autoInvoice: s.autoInvoice, cancelHours: s.cancelHours, payEmail: s.payEmail, backupEmail: s.backupEmail,
          reminders: s.reminders, notifyCompany: s.notifyCompany, ownerAlerts: s.ownerAlerts, reviewUrl: s.reviewUrl,
          email: { configured: mail.configured(), provider: mail.provider }, weakKey: !process.env.BRAVO_KEY || KEY.length < 10 });
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
        return json(res, 200, { ok: true, vehicles: s.vehicles, minHoursAhead: s.minHoursAhead, invoice: s.invoice, autoInvoice: s.autoInvoice, cancelHours: s.cancelHours, payEmail: s.payEmail, backupEmail: s.backupEmail,
          reminders: s.reminders, notifyCompany: s.notifyCompany, ownerAlerts: s.ownerAlerts, reviewUrl: s.reviewUrl,
          email: { configured: mail.configured(), provider: mail.provider }, weakKey: !process.env.BRAVO_KEY || KEY.length < 10 });
      }
    }

    if (route === 'admin/drivers') {
      if (req.method === 'GET') return json(res, 200, { drivers: me.role === 'admin' ? drivers() : drivers().map((x) => { const o = Object.assign({}, x); delete o.rateKm; delete o.rateHour; delete o.rateMin; return o; }) });
      if (req.method === 'POST') {
        let d;
        try { d = JSON.parse(await readBody(req, 60000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
        if (!Array.isArray(d.drivers) || d.drivers.length > 200) return json(res, 400, { error: 'bad_list' });
        const list = d.drivers.map((x) => ({
          id: /^[a-f0-9]{8}$/.test(x.id || '') ? x.id : crypto.randomBytes(4).toString('hex'),
          name: clean(x.name, 80), phone: clean(x.phone, 25), licence: clean(x.licence, 40),
          email: isEmail(x.email) ? clean(x.email, 120) : '', taxId: clean(x.taxId, 30),
          rateKm: num(x.rateKm === '' || x.rateKm == null ? 0 : x.rateKm, 0, 20, 2) || 0,
          rateHour: num(x.rateHour === '' || x.rateHour == null ? 0 : x.rateHour, 0, 1000, 2) || 0,
          rateMin: num(x.rateMin === '' || x.rateMin == null ? 0 : x.rateMin, 0, 5000, 2) || 0,
          car: clean(x.car, 60), plate: clean(x.plate, 15), seats: int(x.seats, 1, 80) || null, notes: cleanLong(x.notes, 500)
        })).filter((x) => x.name);
        fs.writeFileSync(DRIVERS + '.tmp', JSON.stringify(list, null, 1));
        fs.renameSync(DRIVERS + '.tmp', DRIVERS);
        const ids = new Set(list.map((x) => x.id)), ds = docsList();
        const keep = ds.filter((x) => x.owner === 'company' || ids.has(x.owner));
        if (keep.length !== ds.length) { ds.filter((x) => !keep.includes(x)).forEach(removeDocFile); writeJson(DOCS_LIST, keep); }
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
      makeInvoice(b, vatRate, d);
      // Si ya estaba cobrada y es su primera factura, la factura nace cobrada
      if (b.clientPaid && !(b.previousInvoices || []).some((x) => x.paid)) b.invoice.paid = { date: b.clientPaid.date, via: b.clientPaid.via };
      saveBooking(b);
      return json(res, 200, { ok: true, booking: b });
    }

    // El cobro del cliente, marcado a mano. Con «factura sola», la factura se hace aquí y se le manda por correo
    if (req.method === 'POST' && route === 'admin/client-paid') {
      const r = await loadRef();
      if (r.error) return json(res, r.error === 'not_found' ? 404 : 400, r);
      const { d, b } = r;
      if (d.clear === true) {
        b.clientPaid = null;
        if (activeInvoice(b) && b.invoice.paid && !b.invoice.paid.lineId) b.invoice.paid = null;
        b.history = (b.history || []).concat([{ at: new Date().toISOString(), who: me.name, fields: ['cobro deshecho'] }]).slice(-30);
        saveBooking(b);
        return json(res, 200, { ok: true, booking: b });
      }
      if (!(b.price > 0)) return json(res, 400, { error: 'no_price' });
      if (b.status === 'cancelada') return json(res, 409, { error: 'cancelled' });
      if (!['tarjeta', 'banco', 'bizum', 'efectivo'].includes(d.via) || !isDay(d.date)) return json(res, 400, { error: 'bad_paid' });
      const paid = { date: d.date, via: d.via };
      b.clientPaid = paid;
      const cfg = settings();
      let invoiced = false;
      if (!activeInvoice(b) && cfg.autoInvoice) { makeInvoice(b, cfg.invoice.defaultVat, {}); invoiced = true; }
      if (activeInvoice(b) && !(b.invoice.paid && b.invoice.paid.lineId)) b.invoice.paid = { date: paid.date, via: paid.via };
      b.history = (b.history || []).concat([{ at: new Date().toISOString(), who: me.name, fields: ['cobrado (' + paid.via + ')' + (invoiced ? ' · factura ' + b.invoice.number : '')] }]).slice(-30);
      saveBooking(b);
      // «Pago recibido» (con la factura, si la hay, y el PDF que dice PAGADO): una sola vez por reserva,
      // también si la factura ya existía de antes
      const already = (b.emails || []).some((e) => e.kind === 'pago recibido' && e.ok);
      const emailed = !already && isEmail(b.email) && mail.configured();
      if (emailed) setImmediate(() => { sendBookingEmail(b.ref, { paidMail: true }).catch(() => {}); });
      return json(res, 200, { ok: true, booking: b, invoiced, emailed });
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
      if (r.b.driverPaid && r.b.driverPaid.lineId) {
        const bk = bank(), l = bk.lines.find((x) => x.id === r.b.driverPaid.lineId);
        if (l) { l.match = null; saveBank(bk); }
      }
      fs.unlinkSync(bookingFile(r.b.ref));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && route === 'admin/export.csv') {
      const month = new URL(url, 'http://x').searchParams.get('month') || today().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return json(res, 400, { error: 'bad_month' });
      const n2 = (v) => (v == null || v === '' ? '' : String(Math.round(Number(v) * 100) / 100).replace('.', ','));
      const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['Reserva', 'Día', 'Hora', 'Tipo', 'Desde', 'Hasta', 'Personas', 'Vehículo', 'Km', 'Cliente', 'Teléfono', 'Correo',
        'Precio', 'Empresa de transporte', 'Pago a la empresa', 'Te queda', 'Estado', 'Factura', 'Fecha factura', 'Estado factura', 'Base', 'IVA %', 'IVA', 'Total factura'];
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
      if (me.role !== 'admin') d = Object.fromEntries(Object.entries(d).filter(([k]) => OP_UPDATE.includes(k)));
      const ref = /^BT-\d{4,6}$/.test(d.ref || '') ? d.ref : null;
      let b = null;
      try { b = ref && JSON.parse(fs.readFileSync(bookingFile(ref), 'utf8')); } catch (e) { /* no existe */ }
      if (!b) return json(res, 404, { error: 'not_found' });
      const old = JSON.parse(JSON.stringify(b));
      if (d.status !== undefined) {
        if (!STATUSES.includes(d.status)) return json(res, 400, { error: 'bad_status' });
        b.status = d.status;
      }
      const before = old.driverName + '|' + old.date + '|' + old.time;
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
      if (d.date !== undefined || d.time !== undefined) {
        const nd = d.date !== undefined ? clean(d.date, 10) : b.date, nt = d.time !== undefined ? clean(d.time, 5) : b.time;
        if (!madridMs(nd, nt)) return json(res, 400, { error: 'bad_date' });
        b.date = nd; b.time = nt;
      }
      if (d.driverVat !== undefined) {
        const v = num(d.driverVat, 0, 30, 2);
        if (v == null) return json(res, 400, { error: 'bad_vat' });
        b.driverVat = v;
      }
      if (d.driverCar !== undefined) b.driverCar = clean(d.driverCar, 80);
      if (d.driverEmail !== undefined) {
        if (d.driverEmail && !isEmail(d.driverEmail)) return json(res, 400, { error: 'bad_email' });
        b.driverEmail = clean(d.driverEmail, 120);
      }
      if (d.driverInvoiceNo !== undefined) b.driverInvoiceNo = clean(d.driverInvoiceNo, 40);
      if (d.chauffeur !== undefined) b.chauffeur = clean(d.chauffeur, 80);
      if (d.clientDoc !== undefined) b.clientDoc = clean(d.clientDoc, 40);
      if (d.chauffeurPhone !== undefined) b.chauffeurPhone = clean(d.chauffeurPhone, 25);
      let newlyPaid = false;
      if (d.driverPaidVia !== undefined && !(b.driverPaid && b.driverPaid.lineId)) {
        if (!d.driverPaidVia) b.driverPaid = null;
        else {
          if (!['banco', 'tarjeta', 'efectivo', 'bizum'].includes(d.driverPaidVia) || !isDay(d.driverPaidDate)) return json(res, 400, { error: 'bad_paid' });
          if (!(b.driverPaid && b.driverPaid.date === d.driverPaidDate && b.driverPaid.via === d.driverPaidVia)) { b.driverPaid = { date: d.driverPaidDate, via: d.driverPaidVia }; newlyPaid = true; }
        }
      }
      if (d.price !== undefined) {
        const p = d.price === '' || d.price === null ? null : num(d.price, 0, 100000, 2);
        if (p === null && !(d.price === '' || d.price === null)) return json(res, 400, { error: 'bad_price' });
        if (p !== b.price) {
          if (activeInvoice(b)) return json(res, 409, { error: 'invoiced' });
          b.price = p;
        }
      }
      b.updatedAt = new Date().toISOString();
      const changed = ['status', 'date', 'time', 'driverName', 'driverPhone', 'driverEmail', 'driverCar', 'chauffeur', 'chauffeurPhone', 'driverNote', 'ministry', 'clientDoc', 'notes',
        'price', 'driverPay', 'driverVat', 'driverInvoiceNo', 'driverPaid'].filter((k) => JSON.stringify(old[k] == null ? '' : old[k]) !== JSON.stringify(b[k] == null ? '' : b[k]));
      if (changed.length) {
        b.history = (b.history || []).concat([{ at: new Date().toISOString(), who: me.name, fields: changed }]).slice(-30);
        audit(me, 'cambia la reserva', { ref: b.ref, fields: changed });
      }
      saveBooking(b);
      if (newlyPaid) autoPayEmail('driver', b.ref);
      // La empresa recibe el servicio (con su hoja) al asignárselo, o si cambia el día o la hora
      const nowKey = b.driverName + '|' + b.date + '|' + b.time;
      let companyNotified = false;
      if (b.driverName && nowKey !== before && b.status !== 'cancelada' && b.date >= today() && settings().notifyCompany && mail.configured() && companyAddr(b) &&
          (b.reminders || {}).companyNewFor !== nowKey) {
        companyNotified = true;
        setImmediate(() => { sendNotice(b.ref, 'empresa: nuevo servicio', (x) => companyNotice(x, 'new')).catch(() => {}); });
      }
      return json(res, 200, { ok: true, booking: me.role === 'admin' ? b : forOperator(b), companyNotified });
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
      const ORIGIN = { factura: 'Factura de la web', rectificativa: 'Factura rectificativa', conductor: 'Reserva (pago a la empresa de transporte)', manual: 'Apuntado a mano' };
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
      const type = ['ingreso', 'gasto', 'nomina'].includes(d.type) ? d.type : null;
      if (!type) return json(res, 400, { error: 'bad_type' });
      if (!isDay(d.date)) return json(res, 400, { error: 'bad_date' });
      let total, vatRate, payroll = null, category;
      if (type === 'nomina') {
        // Nómina: bruto − IRPF − SS del trabajador = neto (lo que se transfiere). Coste = bruto + SS de la empresa.
        if (!clean(d.party, 80)) return json(res, 400, { error: 'bad_worker' });
        const gross = num(d.gross, 0.01, 1000000, 2);
        const irpf = num(d.irpf === '' || d.irpf == null ? 0 : d.irpf, 0, 1000000, 2);
        const ssEmp = num(d.ssEmp === '' || d.ssEmp == null ? 0 : d.ssEmp, 0, 1000000, 2);
        const ssCo = num(d.ssCo === '' || d.ssCo == null ? 0 : d.ssCo, 0, 1000000, 2);
        if (gross == null) return json(res, 400, { error: 'bad_gross' });
        if (irpf == null || ssEmp == null || ssCo == null) return json(res, 400, { error: 'bad_payroll' });
        const net = Math.round((gross - irpf - ssEmp) * 100) / 100;
        if (net < 0) return json(res, 400, { error: 'bad_payroll' });
        payroll = { gross, irpf, ssEmp, ssCo, net };
        total = Math.round((gross + ssCo) * 100) / 100; vatRate = 0; category = 'Nóminas';
      } else {
        category = d.category;
        if (!(type === 'gasto' ? EXPENSE_CATS : INCOME_CATS).includes(category)) return json(res, 400, { error: 'bad_category' });
        total = num(d.total, 0.01, 1000000, 2);
        if (total == null) return json(res, 400, { error: 'bad_total' });
        vatRate = num(d.vatRate, 0, 30, 2);
        if (vatRate == null) return json(res, 400, { error: 'bad_vat' });
      }
      const concept = clean(d.concept, 120) || (type === 'nomina' ? 'Nómina' : '');
      if (!concept) return json(res, 400, { error: 'bad_concept' });
      const list = ledger();
      let e = d.id ? list.find((x) => x.id === d.id) : null;
      if (d.id && !e) return json(res, 404, { error: 'not_found' });
      if (!e) { e = { id: crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString(), receipt: null }; list.push(e); }
      if (d.partyEmail !== undefined && d.partyEmail !== '' && !isEmail(d.partyEmail)) return json(res, 400, { error: 'bad_email' });
      if (d.partyEmail !== undefined) e.email = clean(d.partyEmail, 120);
      Object.assign(e, { type, date: d.date, concept, party: clean(d.party, 80), number: clean(d.number, 40), taxId: clean(d.taxId, 30), category, total, vatRate, payroll, notes: cleanLong(d.notes, 500), updatedAt: new Date().toISOString() }, splitVat(total, vatRate));
      if (d.removeReceipt) { removeReceipt(e); e.receipt = null; }
      // Ticket que estaba en la bandeja: pasa a ser el de este apunte
      if (d.inboxId) {
        const items = inbox(), it = items.find((x) => x.id === d.inboxId);
        if (!it) return json(res, 404, { error: 'inbox_not_found' });
        removeReceipt(e);
        const ext = it.file.split('.').pop(), file = e.id + '.' + ext;
        fs.renameSync(path.join(INBOX, it.file), path.join(RECEIPTS, file));
        e.receipt = { file, name: it.name, size: it.size };
        writeJson(INBOX_LIST, items.filter((x) => x !== it));
      }
      // Pagado: por una línea del banco, o a mano (efectivo, tarjeta, banco)
      let lineToMatch = null;
      if (d.bankLineId) {
        const bk0 = bank(), l = bk0.lines.find((x) => x.id === d.bankLineId);
        if (!l || l.match) return json(res, 400, { error: 'bad_line' });
        if (type === 'nomina' && cents(-payroll.net) !== cents(l.amount)) return json(res, 400, { error: 'net_differs' });
        e.paid = { date: l.date, via: 'banco', lineId: l.id };
        lineToMatch = l.id;
      } else if (d.paidVia !== undefined && !(e.paid && e.paid.lineId)) {
        if (['banco', 'tarjeta', 'efectivo'].includes(d.paidVia) && isDay(d.paidDate)) {
          if (!(e.paid && e.paid.date === d.paidDate && e.paid.via === d.paidVia)) e.paid = { date: d.paidDate, via: d.paidVia };
        }
        else if (!d.paidVia) e.paid = null;
      }
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
      if (lineToMatch) {
        const bk = bank(), l = bk.lines.find((x) => x.id === lineToMatch);
        l.match = { type: 'ledger', key: e.id, label: (type === 'ingreso' ? 'Ingreso: ' : type === 'nomina' ? 'Nómina: ' + e.party + ' · ' : 'Gasto: ') + e.concept };
        saveBank(bk);
      }
      if (type === 'gasto' && e.paid) autoPayEmail('ledger', e.id);
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
      if (e.paid && e.paid.lineId) {
        const bk = bank(), l = bk.lines.find((x) => x.id === e.paid.lineId);
        if (l) { l.match = null; saveBank(bk); }
      }
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

    // ---------- banco ----------
    if (req.method === 'GET' && route === 'admin/bank') {
      const sp = new URL(url, 'http://x').searchParams;
      const from = isDay(sp.get('from')) ? sp.get('from') : '0000-01-01', to = isDay(sp.get('to')) ? sp.get('to') : '9999-12-31';
      const bk = bank(), items = payables();
      const lines = bk.lines.filter((l) => l.date >= from && l.date <= to).sort((a, c) => c.date.localeCompare(a.date))
        .map((l) => Object.assign({}, l, { candidates: l.match ? [] : candidates(l, items).map((it) => ({ type: it.type, key: it.key, label: it.label, date: it.date, amount: it.amount })) }));
      const r2 = (n) => Math.round(n * 100) / 100;
      const sums = { n: lines.length, matched: lines.filter((l) => l.match).length, in: r2(lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0)), out: r2(lines.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0)) };
      const withBal = lines.filter((l) => l.balance != null);
      sums.lastBalance = withBal.length ? withBal[0].balance : null;
      return json(res, 200, { statements: bk.statements.slice().sort((a, c) => (c.uploadedAt || '').localeCompare(a.uploadedAt || '')), lines, totals: sums, weakKey: !process.env.BRAVO_KEY || KEY.length < 10 });
    }
    if (req.method === 'POST' && route === 'admin/bank/upload') {
      let d;
      try { d = JSON.parse(await readBody(req, 14000000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const buf = Buffer.from(String(d.data || ''), 'base64');
      if (!buf.length || buf.length > 10 * 1024 * 1024) return json(res, 400, { error: 'file_size' });
      const bk = bank();
      const st = { id: crypto.randomBytes(5).toString('hex'), name: clean(d.name, 100) || 'extracto', uploadedAt: new Date().toISOString(), status: 'pendiente', lines: 0 };
      let parsed = [];
      if (sniff(buf) === 'pdf') { st.kind = 'pdf'; st.file = st.id + '.pdf'; }
      else {
        let text = buf.toString('utf8');
        if (text.includes('\ufffd')) text = buf.toString('latin1');
        if (/\u0000/.test(text)) return json(res, 400, { error: 'file_type' });
        const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
        // Norma 43: cabecera «11» con el código de la cuenta y movimientos «22» de ancho fijo
        if (/^11\d{8}/.test(first) && text.split(/\r?\n/).some((l) => /^22/.test(l) && l.length >= 42)) { st.kind = 'n43'; parsed = parseN43(text); }
        else { st.kind = 'csv'; parsed = parseCsv(text); }
        st.file = st.id + '.' + (st.kind === 'n43' ? 'txt' : 'csv');
      }
      fs.writeFileSync(path.join(STATEMENTS, st.file), buf);
      bk.statements.push(st);
      const added = parsed.length ? addLines(bk, st, parsed) : 0;
      const matched = autoMatch(bk);
      saveBank(bk);
      return json(res, 200, { ok: true, statement: st, added, matched, needsReading: !added });
    }
    // Para Claude: los movimientos que ha leído de un extracto en PDF
    if (req.method === 'POST' && route === 'admin/bank/lines') {
      let d;
      try { d = JSON.parse(await readBody(req, 3000000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const bk = bank(), st = bk.statements.find((x) => x.id === d.statementId);
      if (!st) return json(res, 404, { error: 'not_found' });
      const added = addLines(bk, st, d.lines);
      const matched = autoMatch(bk);
      saveBank(bk);
      return json(res, 200, { ok: true, added, matched, statement: st });
    }
    if (req.method === 'POST' && route === 'admin/bank/automatch') {
      const bk = bank(), matched = autoMatch(bk);
      saveBank(bk);
      return json(res, 200, { ok: true, matched });
    }
    if (req.method === 'GET' && route === 'admin/bank/file') {
      const st = bank().statements.find((x) => x.id === new URL(url, 'http://x').searchParams.get('id'));
      if (!st) return json(res, 404, { error: 'not_found' });
      let buf;
      try { buf = fs.readFileSync(path.join(STATEMENTS, st.file)); } catch (e) { return json(res, 404, { error: 'not_found' }); }
      res.writeHead(200, {
        'Content-Type': st.kind === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8', 'Content-Length': buf.length,
        'Content-Disposition': 'inline; filename="' + st.file + '"', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff'
      });
      return res.end(buf);
    }
    if (req.method === 'POST' && ['admin/bank/match', 'admin/bank/classify', 'admin/bank/unmatch', 'admin/bank/statement-delete'].includes(route)) {
      let d;
      try { d = JSON.parse(await readBody(req, 4000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const bk = bank();
      if (route === 'admin/bank/statement-delete') {
        const st = bk.statements.find((x) => x.id === d.id);
        if (!st) return json(res, 404, { error: 'not_found' });
        for (const l of bk.lines.filter((x) => x.statementId === st.id)) unmatchLine(bk, l);
        bk.lines = bk.lines.filter((x) => x.statementId !== st.id);
        bk.statements = bk.statements.filter((x) => x !== st);
        try { fs.unlinkSync(path.join(STATEMENTS, st.file)); } catch (e) { /* ya no estaba */ }
        saveBank(bk);
        return json(res, 200, { ok: true });
      }
      const l = bk.lines.find((x) => x.id === d.lineId);
      if (!l) return json(res, 404, { error: 'not_found' });
      if (route === 'admin/bank/unmatch') { unmatchLine(bk, l); saveBank(bk); return json(res, 200, { ok: true, line: l }); }
      if (l.match) return json(res, 409, { error: 'already_matched' });
      if (route === 'admin/bank/match') {
        const it = payables().find((x) => x.type === d.type && x.key === d.key);
        if (!it) return json(res, 404, { error: 'not_found' });
        if (!openToBank(it)) return json(res, 409, { error: 'already_paid' });
        if (cents(it.amount) !== cents(l.amount)) return json(res, 400, { error: 'amount_differs' });
        setPaid(it, { date: l.date, via: 'banco', lineId: l.id });
        l.match = { type: it.type, key: it.key, label: it.label };
        saveBank(bk);
        autoPayEmail(it.type, it.key);
        return json(res, 200, { ok: true, line: l });
      }
      // classify: comisión del banco (gasto 626), socio, traspaso u otro
      if (d.kind === 'fee') {
        if (l.amount >= 0) return json(res, 400, { error: 'not_an_expense' });
        const list = ledger();
        const e = Object.assign({ id: crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString(), receipt: null, type: 'gasto', date: l.date,
          concept: l.concept || 'Comisión del banco', party: 'Banco', number: '', taxId: '', category: 'Comisiones bancarias', total: Math.abs(l.amount), vatRate: 0,
          notes: 'Creado desde el extracto del banco', paid: { date: l.date, via: 'banco', lineId: l.id } }, splitVat(Math.abs(l.amount), 0));
        list.push(e); saveLedger(list);
        l.match = { type: 'ledger', key: e.id, label: 'Gasto: ' + e.concept };
      } else if (d.kind === 'tax') {
        l.match = { type: 'tax', tax: ['iva', 'irpf', 'is'].includes(d.tax) ? d.tax : 'otros', note: clean(d.note, 120) };
      } else if (['socio', 'transfer', 'ignore', 'ss'].includes(d.kind)) {
        l.match = { type: d.kind, note: clean(d.note, 120) };
      } else return json(res, 400, { error: 'bad_kind' });
      saveBank(bk);
      return json(res, 200, { ok: true, line: l });
    }

    // ---------- bandeja de tickets (sin apuntar todavía) ----------
    if (req.method === 'GET' && route === 'admin/inbox') return json(res, 200, { items: inbox() });
    if (req.method === 'POST' && route === 'admin/inbox/upload') {
      let d;
      try { d = JSON.parse(await readBody(req, 9000000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const buf = Buffer.from(String(d.data || ''), 'base64');
      if (buf.length > 6 * 1024 * 1024) return json(res, 400, { error: 'receipt_too_big' });
      const ext = sniff(buf);
      if (!ext) return json(res, 400, { error: 'receipt_type' });
      const items = inbox();
      if (items.length >= 500) return json(res, 400, { error: 'inbox_full' });
      const it = { id: crypto.randomBytes(5).toString('hex'), name: clean(d.name, 80) || 'ticket', size: buf.length, uploadedAt: new Date().toISOString() };
      it.file = it.id + '.' + ext;
      fs.writeFileSync(path.join(INBOX, it.file), buf);
      items.push(it); writeJson(INBOX_LIST, items);
      return json(res, 200, { ok: true, item: it });
    }
    if (req.method === 'GET' && route === 'admin/inbox/file') {
      const it = inbox().find((x) => x.id === new URL(url, 'http://x').searchParams.get('id'));
      if (!it) return json(res, 404, { error: 'not_found' });
      let buf;
      try { buf = fs.readFileSync(path.join(INBOX, it.file)); } catch (e) { return json(res, 404, { error: 'not_found' }); }
      res.writeHead(200, {
        'Content-Type': RECEIPT_TYPES[it.file.split('.').pop()] || 'application/octet-stream', 'Content-Length': buf.length,
        'Content-Disposition': 'inline; filename="' + it.file + '"', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff'
      });
      return res.end(buf);
    }
    if (req.method === 'POST' && route === 'admin/inbox/delete') {
      let d;
      try { d = JSON.parse(await readBody(req, 2000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const items = inbox(), it = items.find((x) => x.id === d.id);
      if (!it) return json(res, 404, { error: 'not_found' });
      try { fs.unlinkSync(path.join(INBOX, it.file)); } catch (e) { /* ya no estaba */ }
      writeJson(INBOX_LIST, items.filter((x) => x !== it));
      return json(res, 200, { ok: true });
    }

    // ---------- copia de seguridad de todos los datos (sin los archivos) ----------
    // ---------- papeles ----------
    if (req.method === 'GET' && route === 'admin/docs') return json(res, 200, { docs: docsList(), kinds: DOC_KINDS });
    if (req.method === 'POST' && route === 'admin/docs/save') {
      let d;
      try { d = JSON.parse(await readBody(req, 9000000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const owner = String(d.owner || '');
      if (owner !== 'company' && !drivers().some((x) => x.id === owner)) return json(res, 400, { error: 'bad_owner' });
      if (d.expires && !isDay(d.expires)) return json(res, 400, { error: 'bad_date' });
      const kind = DOC_KINDS.includes(d.kind) ? d.kind : 'Otro';
      const list = docsList();
      let x = d.id ? list.find((y) => y.id === d.id) : null;
      if (d.id && !x) return json(res, 404, { error: 'not_found' });
      if (!x) { x = { id: crypto.randomBytes(5).toString('hex'), owner, createdAt: new Date().toISOString(), file: null }; list.push(x); }
      Object.assign(x, { kind, title: clean(d.title, 80), number: clean(d.number, 40), expires: d.expires || '', notes: cleanLong(d.notes, 300), updatedAt: new Date().toISOString() });
      if (d.file && typeof d.file.data === 'string') {
        const buf = Buffer.from(d.file.data, 'base64');
        if (buf.length > 6 * 1024 * 1024) return json(res, 400, { error: 'receipt_too_big' });
        const ext = sniff(buf);
        if (!ext) return json(res, 400, { error: 'receipt_type' });
        removeDocFile(x);
        x.file = x.id + '.' + ext; x.name = clean(d.file.name, 80) || x.file; x.size = buf.length;
        fs.writeFileSync(path.join(DOCS_DIR, x.file), buf);
      }
      if (!x.file && !x.expires && !x.number) return json(res, 400, { error: 'empty_doc' });
      writeJson(DOCS_LIST, list);
      return json(res, 200, { ok: true, doc: x, docs: list });
    }
    if (req.method === 'POST' && route === 'admin/docs/delete') {
      let d;
      try { d = JSON.parse(await readBody(req, 1000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const list = docsList(), x = list.find((y) => y.id === d.id);
      if (!x) return json(res, 404, { error: 'not_found' });
      removeDocFile(x);
      const rest = list.filter((y) => y !== x);
      writeJson(DOCS_LIST, rest);
      return json(res, 200, { ok: true, docs: rest });
    }
    if (req.method === 'GET' && route === 'admin/docs/file') {
      const x = docsList().find((y) => y.id === new URL(url, 'http://x').searchParams.get('id'));
      if (!x || !x.file) return json(res, 404, { error: 'not_found' });
      let buf;
      try { buf = fs.readFileSync(path.join(DOCS_DIR, x.file)); } catch (e) { return json(res, 404, { error: 'not_found' }); }
      res.writeHead(200, { 'Content-Type': RECEIPT_TYPES[x.file.split('.').pop()] || 'application/octet-stream', 'Content-Length': buf.length,
        'Content-Disposition': 'inline; filename="' + x.file + '"', 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' });
      return res.end(buf);
    }

    // ---------- copias de seguridad guardadas ----------
    if (req.method === 'GET' && route === 'admin/backups') {
      const files = fs.readdirSync(BACKUPS).filter((n) => /^bravo-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse()
        .map((n) => ({ name: n, size: fs.statSync(path.join(BACKUPS, n)).size }));
      return json(res, 200, { backups: files });
    }
    if (req.method === 'GET' && route === 'admin/backups/file') {
      const n = new URL(url, 'http://x').searchParams.get('name') || '';
      if (!/^bravo-\d{4}-\d{2}-\d{2}\.json$/.test(n)) return json(res, 400, { error: 'bad_name' });
      let buf;
      try { buf = fs.readFileSync(path.join(BACKUPS, n)); } catch (e) { return json(res, 404, { error: 'not_found' }); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Content-Disposition': 'attachment; filename="' + n + '"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow' });
      return res.end(buf);
    }

    // ---------- borrar los datos de un cliente (protección de datos) ----------
    // Las facturas se guardan (lo pide la ley): en esas reservas queda solo el nombre.
    if (req.method === 'POST' && route === 'admin/customers/delete') {
      let d;
      try { d = JSON.parse(await readBody(req, 1000)); } catch (e) { return json(res, 400, { error: 'bad_json' }); }
      const cl = customers(), c = cl.find((x) => x.id === d.customerId);
      if (!c) return json(res, 404, { error: 'not_found' });
      const bks = mine(c);
      if (bks.some((b) => ['pendiente', 'asignada'].includes(b.status) && b.date >= today())) return json(res, 409, { error: 'has_upcoming' });
      let kept = 0;
      for (const b of bks) {
        const invoiced = allInvoices(b).length > 0;
        if (invoiced) kept++;
        Object.assign(b, { phone: '', email: '', comments: '', flight: '', clientDoc: '', customerId: null, anonymizedAt: new Date().toISOString() });
        if (!invoiced) b.name = 'Cliente borrado';
        saveBooking(b);
      }
      saveMessages(messages().filter((m) => m.customerId !== c.id));
      saveCustomers(cl.filter((x) => x !== c));
      return json(res, 200, { ok: true, bookings: bks.length, keptForInvoices: kept });
    }

    if (req.method === 'GET' && route === 'admin/backup.json') {
      let counters = {};
      try { counters = JSON.parse(fs.readFileSync(path.join(DIR, 'invoice-counter.json'), 'utf8')); } catch (e) { /* ninguno */ }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="bravo-copia-' + today() + '.json"',
        'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow'
      });
      void counters;
      return res.end(JSON.stringify(backupData(), null, 1));
    }

    return json(res, 404, { error: 'not_found' });
  }

  return { allowPage, handleApi };
};
