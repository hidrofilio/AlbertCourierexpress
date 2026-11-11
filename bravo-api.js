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

const DEFAULTS = {
  vehicles: {
    car: { seats: 4, perKm: 1.0, minFare: 30, perHour: 40 },
    van: { seats: 7, perKm: 1.3, minFare: 40, perHour: 52 }
  },
  minHoursAhead: 24,
  hourly: { min: 2, max: 12 },
  // Provisional: solo salidas desde la provincia de Málaga (caja aproximada)
  originBox: { latMin: 36.28, latMax: 37.32, lonMin: -5.65, lonMax: -3.75 }
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
    return out;
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
      saveBooking(b);
      return json(res, 200, { ref: b.ref, kind: b.kind, price: b.price, km: b.km });
    }

    if (req.method === 'GET' && route === 'admin/bookings') {
      const list = allBookings().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return json(res, 200, { bookings: list });
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
      b.updatedAt = new Date().toISOString();
      saveBooking(b);
      return json(res, 200, { ok: true, booking: b });
    }

    return json(res, 404, { error: 'not_found' });
  }

  return { allowPage, handleApi };
};
