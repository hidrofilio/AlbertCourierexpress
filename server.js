// Albert Courier Express — static site + first-party analytics server
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
// Inbox for notes written from the phone. Claude files them into the private
// NEGOCIO repo when working; this is the drop point, not the archive.
const NOTES_FILE = path.join(DATA_DIR, 'notes.jsonl');
// La clave vive SOLO en la variable STATS_KEY de Railway: este repositorio es
// público. Si la variable no está puesta, no entra nadie — es preferible quedarse
// fuera un rato a dejar el buzón de notas abierto de par en par.
const STATS_KEY = process.env.STATS_KEY || '';
const PORT = process.env.PORT || 3000;

// Al rechazar, decimos si Railway nos está pasando la variable — nunca su valor.
// Sirve para distinguir "la clave es otra" de "la variable no llega", que es el
// fallo que ya nos despistó dos veces.
function refuse(res) {
  res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify({ error: 'unauthorized', key_configured: Boolean(STATS_KEY) }));
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function anonymizeIp(ip) {
  if (!ip) return 'unknown';
  ip = ip.replace('::ffff:', '');
  if (ip.includes('.')) {
    const parts = ip.split('.');
    parts[3] = '0';
    return parts.join('.');
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }
  return 'unknown';
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// buildStats() parses the whole log on every dashboard load, so the log is
// capped. At this site's volume the cap holds years of history.
const MAX_EVENTS = 50000;
let appendsSinceTrimCheck = 0;

function trimEvents() {
  try {
    const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
    if (lines.length > MAX_EVENTS) {
      fs.writeFileSync(EVENTS_FILE, lines.slice(-MAX_EVENTS).join('\n') + '\n');
      console.log('Trimmed analytics log to the last ' + MAX_EVENTS + ' events');
    }
  } catch (e) {
    console.error('Failed to trim events file:', e);
  }
}

function appendEvent(evt) {
  fs.appendFile(EVENTS_FILE, JSON.stringify(evt) + '\n', (err) => {
    if (err) console.error('Failed to write event:', err);
  });
  if (++appendsSinceTrimCheck >= 1000) {
    appendsSinceTrimCheck = 0;
    trimEvents();
  }
}

function loadEvents() {
  try {
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8');
    if (!raw.trim()) return [];
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function isBot(ua) {
  if (!ua) return false;
  return /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|monitor|uptime|curl|wget|python-requests|headless/i.test(ua);
}

function parseUA(ua) {
  ua = ua || '';
  let browser = 'Other';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari';

  let os = 'Other';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { browser, os };
}

// The classmates' CPC test site sends its visits to the same log, but they are
// kept out of the business figures and reported in their own section.
const isStudyEvent = (e) => typeof e.path === 'string' && e.path.startsWith('/cpc-study');

// What the students do, read from their saved progress: who signed up, when
// they were last active, how many questions they answered and how long they studied.
function buildStudyAccounts() {
  const now = Date.now();
  const DAY = 86400000;
  const list = [];
  let files = [];
  try { files = fs.readdirSync(STUDY_USERS_DIR).filter((f) => f.endsWith('.json')); } catch (e) { /* none yet */ }
  files.forEach((f) => {
    try {
      const u = JSON.parse(fs.readFileSync(path.join(STUDY_USERS_DIR, f), 'utf8'));
      const st = u.state || {};
      list.push({
        nick: u.nick, exam: u.exam, created: u.created, updated: u.updated,
        answered: Number(st.answered) || 0,
        minutes: Math.round((Number(st.secs) || 0) / 60),
        finished: Object.keys(st.results || {}).length
      });
    } catch (e) { /* skip a damaged file */ }
  });
  let feedbackCount = 0;
  try { feedbackCount = fs.readFileSync(STUDY_FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean).length; } catch (e) { /* none yet */ }
  const sum = (k) => list.reduce((a, u) => a + u[k], 0);
  list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return {
    students: list.length,
    goods: list.filter((u) => u.exam === 'goods').length,
    passenger: list.filter((u) => u.exam === 'passenger').length,
    activeToday: list.filter((u) => now - (u.updated || 0) < DAY).length,
    activeWeek: list.filter((u) => now - (u.updated || 0) < 7 * DAY).length,
    answered: sum('answered'),
    hours: Math.round(sum('minutes') / 6) / 10,
    testsFinished: sum('finished'),
    feedback: feedbackCount,
    list: list.slice(0, 60)
  };
}

function buildStats() {
  const allEvents = loadEvents();
  const events = allEvents.filter((e) => e && !isStudyEvent(e));
  const studyEvents = allEvents.filter((e) => e && isStudyEvent(e));
  const sessions = {}; // sid -> { path, ref, firstSeen, lastSeen, maxDur, device, browser, os, lang }

  events.forEach((e) => {
    if (!e || !e.sid) return;
    if (e.type !== 'pageview' && e.type !== 'duration') return;
    const key = e.sid + '|' + (e.path || '/');
    if (!sessions[key]) {
      sessions[key] = {
        sid: e.sid,
        path: e.path || '/',
        ref: e.ref || '(direct)',
        device: e.device || 'unknown',
        browser: e.browser || 'Other',
        os: e.os || 'Other',
        lang: e.lang || 'unknown',
        firstSeen: e.ts,
        lastSeen: e.ts,
        maxDur: 0
      };
    }
    const s = sessions[key];
    if (e.ts < s.firstSeen) s.firstSeen = e.ts;
    if (e.ts > s.lastSeen) s.lastSeen = e.ts;
    if (typeof e.dur === 'number' && e.dur > s.maxDur) s.maxDur = e.dur;
    if (e.ref) s.ref = e.ref;
    if (e.device) s.device = e.device;
    if (e.browser) s.browser = e.browser;
    if (e.os) s.os = e.os;
    if (e.lang) s.lang = e.lang;
  });

  const rows = Object.values(sessions).sort((a, b) => b.firstSeen - a.firstSeen);

  const pageCounts = {};
  const refCounts = {};
  const deviceCounts = {};
  const browserCounts = {};
  const osCounts = {};
  const langCounts = {};
  const uniqueSids = new Set();
  let totalDur = 0;
  let durCount = 0;

  rows.forEach((r) => {
    const refLabel = r.ref === '(direct)' || !r.ref ? '(direct)' : (() => {
      try { return new URL(r.ref).hostname; } catch (e) { return r.ref.slice(0, 40); }
    })();
    refCounts[refLabel] = (refCounts[refLabel] || 0) + 1;
    deviceCounts[r.device] = (deviceCounts[r.device] || 0) + 1;
    browserCounts[r.browser] = (browserCounts[r.browser] || 0) + 1;
    osCounts[r.os] = (osCounts[r.os] || 0) + 1;
    const langLabel = (r.lang || 'unknown').split('-')[0] || 'unknown';
    langCounts[langLabel] = (langCounts[langLabel] || 0) + 1;
    uniqueSids.add(r.sid);
    if (r.maxDur > 0) { totalDur += r.maxDur; durCount++; }
  });

  // Counted from the raw events, so a visitor reloading the page counts each
  // time. The session table above collapses those into one row, which on a
  // one-page site made pageviews and unique visitors read as the same number.
  const clickCounts = {};
  const routeQuoted = {};
  const routeSent = {};
  const vehicleQuoted = {};
  let pageviewCount = 0;
  let quoteStarts = 0;
  let quoteCompletes = 0;
  let inquiryCompletes = 0;

  events.forEach((e) => {
    if (!e) return;
    if (e.type === 'pageview') {
      pageviewCount++;
      const p = e.path || '/';
      pageCounts[p] = (pageCounts[p] || 0) + 1;
    }
    if (e.type === 'click' && e.action) {
      clickCounts[e.action] = (clickCounts[e.action] || 0) + 1;
    } else if (e.type === 'quote_start') {
      quoteStarts++;
    } else if (e.type === 'quote_route') {
      if (e.route) routeQuoted[e.route] = (routeQuoted[e.route] || 0) + 1;
      if (e.vehicle) vehicleQuoted[e.vehicle] = (vehicleQuoted[e.vehicle] || 0) + 1;
    } else if (e.type === 'quote_complete') {
      quoteCompletes++;
      if (e.route) routeSent[e.route] = (routeSent[e.route] || 0) + 1;
    } else if (e.type === 'inquiry_complete') {
      inquiryCompletes++;
    }
  });

  // Bucket by Irish local time so the charts match the hours Albert works.
  // Uses formatToParts: pulling the hour out of a formatted string with a
  // regex grabbed the "20" from the year instead.
  const DUBLIN_FMT = (() => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Dublin',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hour12: false, weekday: 'long'
      });
    } catch (e) {
      return null;
    }
  })();

  const WEEKDAY_ES = {
    Monday: 'Lunes', Tuesday: 'Martes', Wednesday: 'Miércoles', Thursday: 'Jueves',
    Friday: 'Viernes', Saturday: 'Sábado', Sunday: 'Domingo'
  };

  function dublinParts(ts) {
    const fallback = new Date(ts);
    if (!DUBLIN_FMT) {
      return {
        day: fallback.toISOString().slice(0, 10),
        hour: fallback.getUTCHours(),
        weekday: WEEKDAYS[fallback.getUTCDay()]
      };
    }
    const parts = DUBLIN_FMT.formatToParts(fallback);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const hour = parseInt(get('hour'), 10);
    return {
      day: get('year') + '-' + get('month') + '-' + get('day'),
      // hour12:false reports midnight as 24 in some engines.
      hour: Number.isNaN(hour) ? fallback.getUTCHours() : (hour === 24 ? 0 : hour),
      weekday: WEEKDAY_ES[get('weekday')] || WEEKDAYS[fallback.getUTCDay()]
    };
  }

  const perDay = {};
  const perHour = {};
  const perWeekday = {};
  const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  events.forEach((e) => {
    if (!e || e.type !== 'pageview') return;
    const { day, hour, weekday } = dublinParts(e.ts);
    perDay[day] = (perDay[day] || 0) + 1;
    perHour[hour] = (perHour[hour] || 0) + 1;
    perWeekday[weekday] = (perWeekday[weekday] || 0) + 1;
  });

  // Last 14 days, including days with no traffic so gaps are visible.
  const visitsPerDay = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = dublinParts(d.getTime()).day;
    visitsPerDay.push([key, perDay[key] || 0]);
  }

  // ---- CPC test site traffic: one visit per browser session; time is what the page was on screen ----
  const studyVisits = {};
  studyEvents.forEach((e) => {
    if (!e.sid || (e.type !== 'pageview' && e.type !== 'duration')) return;
    const v = studyVisits[e.sid] || (studyVisits[e.sid] = { firstSeen: e.ts, maxDur: 0, ref: '', device: e.device || 'unknown', pageviews: 0 });
    if (e.ts < v.firstSeen) v.firstSeen = e.ts;
    if (typeof e.dur === 'number' && e.dur > v.maxDur) v.maxDur = e.dur;
    if (e.type === 'pageview') v.pageviews++;
    if (e.ref && !v.ref) v.ref = e.ref;
  });
  const studyRows = Object.values(studyVisits);
  const studyPerDay = {};
  const studyRefs = {};
  const studyDevices = {};
  let studyMs = 0;
  let studyTimed = 0;
  studyRows.forEach((v) => {
    const day = dublinParts(v.firstSeen).day;
    studyPerDay[day] = (studyPerDay[day] || 0) + 1;
    let ref = '(directo / WhatsApp)';
    if (v.ref) { try { ref = new URL(v.ref).hostname; } catch (e) { ref = v.ref.slice(0, 40); } }
    studyRefs[ref] = (studyRefs[ref] || 0) + 1;
    studyDevices[v.device] = (studyDevices[v.device] || 0) + 1;
    if (v.maxDur > 0) { studyMs += v.maxDur; studyTimed++; }
  });
  const studyDays = [];
  for (let i = 13; i >= 0; i--) {
    const key = dublinParts(Date.now() - i * 86400000).day;
    studyDays.push([key, studyPerDay[key] || 0]);
  }
  const cpcStudy = {
    visits: studyRows.length,
    pageviews: studyRows.reduce((a, v) => a + v.pageviews, 0),
    avgMinutes: studyTimed ? Math.round(studyMs / studyTimed / 6000) / 10 : 0,
    totalHours: Math.round(studyMs / 360000) / 10,
    visitsPerDay: studyDays,
    referrers: Object.entries(studyRefs).sort((a, b) => b[1] - a[1]).slice(0, 6),
    devices: Object.entries(studyDevices).sort((a, b) => b[1] - a[1]),
    accounts: buildStudyAccounts()
  };

  const hourly = [];
  for (let h = 0; h < 24; h++) hourly.push([String(h).padStart(2, '0') + ':00', perHour[h] || 0]);

  // A visit under 10s means they landed and left without reading anything.
  const shortVisits = rows.filter((r) => r.maxDur > 0 && r.maxDur < 10000).length;
  const measuredVisits = rows.filter((r) => r.maxDur > 0).length;

  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  const ZONE_LABELS = {
    shannon: 'Shannon/Limerick', dublin: 'Dublin', cork: 'Cork',
    belfast: 'Belfast', other: 'Otra ubicación'
  };
  const routeLabel = (code) => code.split('>').map((z) => ZONE_LABELS[z] || z).join(' → ');

  // Every corridor someone priced up, with how many of those turned into a
  // request. Interest with no requests is the signal worth acting on.
  const routes = Object.keys(routeQuoted)
    .map((code) => ({
      route: code,
      label: routeLabel(code),
      quoted: routeQuoted[code],
      sent: routeSent[code] || 0
    }))
    .sort((a, b) => b.quoted - a.quoted)
    .slice(0, 15);

  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    totalPageviews: pageviewCount,
    uniqueVisitors: uniqueSids.size,
    avgDurationSec: durCount ? Math.round((totalDur / durCount) / 1000) : 0,
    topPages: topN(pageCounts, 10),
    topReferrers: topN(refCounts, 10),
    devices: topN(deviceCounts, 5),
    browsers: topN(browserCounts, 6),
    operatingSystems: topN(osCounts, 6),
    languages: topN(langCounts, 6),
    clicks: topN(clickCounts, 10),
    routes,
    vehiclesQuoted: topN(vehicleQuoted, 5),
    funnel: { quoteStarts, quoteCompletes, inquiryCompletes },
    visitsPerDay,
    cpcStudy,
    hourly,
    weekdays: WEEKDAYS.slice(1).concat(WEEKDAYS[0]).map((d) => [d, perWeekday[d] || 0]),
    rates: {
      bounce: pct(shortVisits, measuredVisits),
      startedQuote: pct(quoteStarts, rows.length),
      finishedQuote: pct(quoteCompletes, quoteStarts),
      contacted: pct(quoteCompletes + inquiryCompletes + (clickCounts.call || 0) + (clickCounts.whatsapp || 0), rows.length)
    },
    recent: rows.slice(0, 100).map((r) => ({
      path: r.path,
      ref: r.ref,
      device: r.device,
      browser: r.browser,
      os: r.os,
      time: new Date(r.firstSeen).toISOString(),
      durationSec: Math.round(r.maxDur / 1000)
    }))
  };
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https: *; style-src 'self' 'unsafe-inline' https: *; script-src 'self' 'unsafe-inline' https: *; font-src 'self' data: https: *; connect-src 'self' https: *; media-src 'self' https: *; object-src 'none'; frame-src 'self' https: *;",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-XSS-Protection': '1; mode=block'
};

// Only these extensions are ever served to the public. Anything else (.js at
// the root, .md, .jsonl, .json...) is invisible, so source and data files
// cannot be downloaded even if they sit next to the site.
const PUBLIC_EXTENSIONS = new Set(['.html', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff', '.woff2', '.txt', '.xml']);

// Paths that hold source, docs or collected data — never public.
const BLOCKED_PREFIXES = ['data', 'CAMBIOS', 'CPC-tests', 'CPC course', 'node_modules', '.git'];

function isPublicPath(relPath) {
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return false;
  if (BLOCKED_PREFIXES.some((p) => segments[0] === p)) return false;

  const ext = path.extname(relPath).toLowerCase();
  // The quiz app ships its question bank as JS; that is the only public script.
  if (ext === '.js') return segments[0] === 'cpc';
  return PUBLIC_EXTENSIONS.has(ext);
}

function serveStatic(req, res, urlPath) {
  let filePath;
  try {
    filePath = decodeURIComponent(urlPath.split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (filePath.endsWith('/')) filePath += 'index.html';
  if (filePath === '/') filePath = '/index.html';
  let fullPath = path.join(ROOT, filePath);

  // ROOT + separator, so a sibling directory sharing the prefix cannot escape.
  if (fullPath !== ROOT && !fullPath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const relInitial = path.relative(ROOT, fullPath);
  // A bare directory request is resolved to its index.html below, so allow it through here.
  if (path.extname(relInitial) && !isPublicPath(relInitial)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  fs.stat(fullPath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      fullPath = path.join(fullPath, 'index.html');
    }
    // Re-check after a directory was resolved to its index.html.
    if (!isPublicPath(path.relative(ROOT, fullPath))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    fs.readFile(fullPath, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(fullPath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      const headers = Object.assign({ 'Content-Type': contentType }, SECURITY_HEADERS);
      if (ext === '.html') {
        headers['Cache-Control'] = 'no-cache';
      } else {
        headers['Cache-Control'] = 'public, max-age=3600';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

// ---- CPC study site for classmates (/cpc-study/) ----
// Each student gets a random code shown on screen (no email). Only a hash of the
// code is stored, as the file name of their progress, so a copy of the data
// folder does not reveal anyone's code. The feedback they send is read with
// STATS_KEY, like the notes inbox.
const STUDY_DIR = path.join(DATA_DIR, 'cpc-study');
const STUDY_USERS_DIR = path.join(STUDY_DIR, 'users');
const STUDY_FEEDBACK_FILE = path.join(STUDY_DIR, 'feedback.jsonl');
fs.mkdirSync(STUDY_USERS_DIR, { recursive: true });

const STUDY_MAX_USERS = 300;              // the class is about 25 people
const STUDY_MAX_STATE_BYTES = 150000;     // all 45 tests in progress is well under this
const STUDY_MAX_FEEDBACK_BYTES = 2000000;
const STUDY_EXAMS = ['goods', 'passenger'];
// No 0/O, 1/I/L: the code is read off a phone screen and typed on another one
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newStudyCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return code;
}
function normStudyCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}
function studyUserFile(code) {
  const h = crypto.createHash('sha256').update('cpc-study:' + code).digest('hex');
  return path.join(STUDY_USERS_DIR, h + '.json');
}
function readStudyUser(code) {
  if (code.length !== 8) return null;
  try { return JSON.parse(fs.readFileSync(studyUserFile(code), 'utf8')); } catch (e) { return null; }
}
function writeStudyUser(code, user) {
  const file = studyUserFile(code);
  fs.writeFileSync(file + '.tmp', JSON.stringify(user));
  fs.renameSync(file + '.tmp', file);
}
function countStudyUsers() {
  try { return fs.readdirSync(STUDY_USERS_DIR).filter((f) => f.endsWith('.json')).length; } catch (e) { return 0; }
}
function cleanNick(s) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

// In-memory rate limits. Failed code attempts are also capped for everyone at
// once, so faking the client address cannot be used to guess codes faster.
const studyHits = new Map();
function studyLimited(bucket, max, windowMs) {
  const now = Date.now();
  const rec = studyHits.get(bucket);
  if (!rec || now - rec.start > windowMs) {
    studyHits.set(bucket, { start: now, count: 1 });
    return false;
  }
  rec.count++;
  return rec.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of studyHits) if (now - rec.start > 3600000) studyHits.delete(k);
}, 600000).unref();

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function studyOverLimit(bucket, max, windowMs) {
  const rec = studyHits.get(bucket);
  return Boolean(rec && Date.now() - rec.start <= windowMs && rec.count > max);
}

// Looks the code up. Only wrong codes count towards the limits: 30 per address
// every 15 minutes, and a high cap for everyone together against floods.
// With 31^8 possible codes, guessing one stays out of reach either way.
function studyAuth(req, res, rawCode) {
  const ip = getClientIp(req);
  if (studyOverLimit('fail:' + ip, 30, 900000) || studyOverLimit('fail:all', 5000, 600000)) {
    sendJson(res, 429, { error: 'too_many_attempts' });
    return null;
  }
  const code = normStudyCode(rawCode);
  const user = readStudyUser(code);
  if (!user) {
    studyLimited('fail:' + ip, 30, 900000);
    studyLimited('fail:all', 5000, 600000);
    sendJson(res, 401, { error: 'unknown_code' });
    return null;
  }
  return { code, user };
}

async function handleStudy(req, res, url) {
  const route = url.split('?')[0].replace('/api/cpc-study/', '');

  // Read-only list for Alberto / Claude: who is using it and what they reported
  if (req.method === 'GET' && route === 'admin') {
    const key = new URL(url, 'http://x').searchParams.get('key');
    if (!STATS_KEY || key !== STATS_KEY) { refuse(res); return; }
    const users = [];
    for (const f of fs.readdirSync(STUDY_USERS_DIR).filter((n) => n.endsWith('.json'))) {
      try {
        const u = JSON.parse(fs.readFileSync(path.join(STUDY_USERS_DIR, f), 'utf8'));
        const st = u.state || {};
        users.push({
          nick: u.nick, exam: u.exam, created: u.created, updated: u.updated,
          testsFinished: Object.keys(st.results || {}).length,
          testsInProgress: Object.keys(st.inprogress || {}).length
        });
      } catch (e) { /* skip a damaged file */ }
    }
    let feedback = [];
    try {
      feedback = fs.readFileSync(STUDY_FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean).reverse();
    } catch (e) { /* no feedback yet */ }
    users.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    sendJson(res, 200, { users, feedback });
    return;
  }

  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

  let data;
  try {
    data = JSON.parse(await readBody(req, STUDY_MAX_STATE_BYTES + 5000));
    if (!data || typeof data !== 'object') throw new Error('bad body');
  } catch (e) {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }
  const ip = getClientIp(req);

  if (route === 'signup') {
    const nick = cleanNick(data.nick);
    const exam = STUDY_EXAMS.includes(data.exam) ? data.exam : null;
    if (nick.length < 2 || !exam) { sendJson(res, 400, { error: 'bad_request' }); return; }
    // A whole class may sign up from the same college wifi, so the limit is generous
    if (studyLimited('signup:' + ip, 60, 3600000) || studyLimited('signup:all', 200, 3600000)) {
      sendJson(res, 429, { error: 'too_many_attempts' });
      return;
    }
    if (countStudyUsers() >= STUDY_MAX_USERS) { sendJson(res, 503, { error: 'full' }); return; }
    let code;
    do { code = newStudyCode(); } while (readStudyUser(code));
    const now = Date.now();
    writeStudyUser(code, { nick, exam, created: now, updated: now, state: {} });
    sendJson(res, 200, { code, nick, exam });
    return;
  }

  if (route === 'login') {
    const auth = studyAuth(req, res, data.code);
    if (!auth) return;
    const { user } = auth;
    sendJson(res, 200, { nick: user.nick, exam: user.exam, state: user.state || {} });
    return;
  }

  if (route === 'save') {
    const auth = studyAuth(req, res, data.code);
    if (!auth) return;
    const { code, user } = auth;
    if (data.state !== undefined) {
      if (!data.state || typeof data.state !== 'object' || Array.isArray(data.state) ||
          JSON.stringify(data.state).length > STUDY_MAX_STATE_BYTES) {
        sendJson(res, 400, { error: 'bad_request' });
        return;
      }
      user.state = data.state;
    }
    if (STUDY_EXAMS.includes(data.exam)) user.exam = data.exam;
    const nick = cleanNick(data.nick);
    if (data.nick !== undefined && nick.length >= 2) user.nick = nick;
    user.updated = Date.now();
    try {
      writeStudyUser(code, user);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      console.error('Failed to save study progress:', e);
      sendJson(res, 500, { error: 'save_failed' });
    }
    return;
  }

  if (route === 'feedback') {
    const auth = studyAuth(req, res, data.code);
    if (!auth) return;
    const { code, user } = auth;
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, 2000) : '';
    if (!text) { sendJson(res, 400, { error: 'empty' }); return; }
    if (studyLimited('feedback:' + code, 30, 3600000)) { sendJson(res, 429, { error: 'too_many_attempts' }); return; }
    try {
      if (fs.existsSync(STUDY_FEEDBACK_FILE) && fs.statSync(STUDY_FEEDBACK_FILE).size > STUDY_MAX_FEEDBACK_BYTES) {
        sendJson(res, 503, { error: 'full' });
        return;
      }
      const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
      fs.appendFileSync(STUDY_FEEDBACK_FILE, JSON.stringify({
        ts: Date.now(),
        nick: user.nick,
        exam: user.exam,
        kind: data.kind === 'mistake' ? 'mistake' : 'idea',
        topic: str(data.topic, 10),
        qid: str(data.qid, 20),
        question: str(data.question, 400),
        text
      }) + '\n');
      sendJson(res, 200, { ok: true });
    } catch (e) {
      console.error('Failed to save study feedback:', e);
      sendJson(res, 500, { error: 'save_failed' });
    }
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

// The site lives at the bare domain. Google's business profile links to the www
// address, which used to serve the same page and split the search ranking
// between two addresses. Only page loads are redirected: a POST to /api/*
// would lose its body on a 301.
const CANONICAL_HOST = 'albertcourierexpress.com';

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (host === 'www.' + CANONICAL_HOST && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(301, { Location: 'https://' + CANONICAL_HOST + url, 'Cache-Control': 'public, max-age=86400' });
    res.end();
    return;
  }

  if (req.method === 'POST' && url === '/api/track') {
    try {
      const body = await readBody(req, 5000);
      const data = JSON.parse(body);
      const ip = anonymizeIp(getClientIp(req));
      const ua = req.headers['user-agent'] || '';
      if (isBot(ua)) {
        res.writeHead(204);
        res.end();
        return;
      }
      const { browser, os } = parseUA(ua);
      const validTypes = ['pageview', 'duration', 'click', 'quote_start', 'quote_route', 'quote_complete', 'inquiry_complete'];
      const type = validTypes.includes(data.type) ? data.type : 'pageview';
      appendEvent({
        ts: Date.now(),
        type,
        path: typeof data.path === 'string' ? data.path.slice(0, 200) : '/',
        ref: typeof data.ref === 'string' ? data.ref.slice(0, 300) : '',
        sid: typeof data.sid === 'string' ? data.sid.slice(0, 60) : 'unknown',
        dur: typeof data.dur === 'number' ? Math.min(data.dur, 3 * 60 * 60 * 1000) : undefined,
        device: typeof data.device === 'string' ? data.device.slice(0, 20) : 'unknown',
        lang: typeof data.lang === 'string' ? data.lang.slice(0, 10) : '',
        action: typeof data.action === 'string' ? data.action.slice(0, 30) : undefined,
        route: typeof data.route === 'string' ? data.route.slice(0, 40) : undefined,
        vehicle: typeof data.vehicle === 'string' ? data.vehicle.slice(0, 20) : undefined,
        browser,
        os,
        ip
      });
      res.writeHead(204);
      res.end();
    } catch (e) {
      res.writeHead(400);
      res.end();
    }
    return;
  }

  if (req.method === 'GET' && url.startsWith('/api/stats')) {
    const key = new URL(url, 'http://x').searchParams.get('key');
    if (!STATS_KEY || key !== STATS_KEY) {
      refuse(res);
      return;
    }
    const stats = buildStats();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(stats));
    return;
  }

  if (url.startsWith('/api/notes')) {
    const key = new URL(url, 'http://x').searchParams.get('key');
    if (!STATS_KEY || key !== STATS_KEY) {
      refuse(res);
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readBody(req, 20000);
        const data = JSON.parse(body);
        const text = typeof data.text === 'string' ? data.text.trim().slice(0, 10000) : '';
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'empty' }));
          return;
        }
        const note = {
          ts: Date.now(),
          topic: typeof data.topic === 'string' ? data.topic.slice(0, 40) : 'general',
          text
        };
        fs.appendFileSync(NOTES_FILE, JSON.stringify(note) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error('Failed to save note:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'save failed' }));
      }
      return;
    }

    if (req.method === 'GET') {
      let notes = [];
      try {
        if (fs.existsSync(NOTES_FILE)) {
          notes = fs.readFileSync(NOTES_FILE, 'utf8').split('\n').filter(Boolean)
            .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
            .filter(Boolean);
        }
      } catch (e) {
        console.error('Failed to read notes:', e);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ notes: notes.reverse() }));
      return;
    }

    res.writeHead(405);
    res.end();
    return;
  }

  if (url.startsWith('/api/cpc-study/')) {
    try {
      await handleStudy(req, res, url);
    } catch (e) {
      console.error('cpc-study error:', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    }
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
