// Albert Courier Express — static site + first-party analytics server
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const STATS_KEY = process.env.STATS_KEY || '8214';
const PORT = process.env.PORT || 3000;

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

function appendEvent(evt) {
  fs.appendFile(EVENTS_FILE, JSON.stringify(evt) + '\n', (err) => {
    if (err) console.error('Failed to write event:', err);
  });
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

function buildStats() {
  const events = loadEvents();
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
    pageCounts[r.path] = (pageCounts[r.path] || 0) + 1;
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

  // Raw action counts: contact clicks and quote/inquiry funnel (not tied to the page-session table above)
  const clickCounts = {};
  let quoteStarts = 0;
  let quoteCompletes = 0;
  let inquiryCompletes = 0;

  events.forEach((e) => {
    if (!e) return;
    if (e.type === 'click' && e.action) {
      clickCounts[e.action] = (clickCounts[e.action] || 0) + 1;
    } else if (e.type === 'quote_start') {
      quoteStarts++;
    } else if (e.type === 'quote_complete') {
      quoteCompletes++;
    } else if (e.type === 'inquiry_complete') {
      inquiryCompletes++;
    }
  });

  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    totalPageviews: rows.length,
    uniqueVisitors: uniqueSids.size,
    avgDurationSec: durCount ? Math.round((totalDur / durCount) / 1000) : 0,
    topPages: topN(pageCounts, 10),
    topReferrers: topN(refCounts, 10),
    devices: topN(deviceCounts, 5),
    browsers: topN(browserCounts, 6),
    operatingSystems: topN(osCounts, 6),
    languages: topN(langCounts, 6),
    clicks: topN(clickCounts, 10),
    funnel: { quoteStarts, quoteCompletes, inquiryCompletes },
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

function serveStatic(req, res, urlPath) {
  let filePath = decodeURIComponent(urlPath.split('?')[0]);
  if (filePath === '/') filePath = '/index.html';
  let fullPath = path.join(ROOT, filePath);

  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(fullPath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      fullPath = path.join(fullPath, 'index.html');
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

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

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
      const validTypes = ['pageview', 'duration', 'click', 'quote_start', 'quote_complete', 'inquiry_complete'];
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
    if (key !== STATS_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const stats = buildStats();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(stats));
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
