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

function buildStats() {
  const events = loadEvents();
  const sessions = {}; // sid -> { path, ref, ua, firstSeen, lastSeen, maxDur, device }

  events.forEach((e) => {
    if (!e || !e.sid) return;
    const key = e.sid + '|' + (e.path || '/');
    if (!sessions[key]) {
      sessions[key] = {
        sid: e.sid,
        path: e.path || '/',
        ref: e.ref || '(direct)',
        ua: e.ua || '',
        device: e.device || 'unknown',
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
  });

  const rows = Object.values(sessions).sort((a, b) => b.firstSeen - a.firstSeen);

  const pageCounts = {};
  const refCounts = {};
  const deviceCounts = {};
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
    uniqueSids.add(r.sid);
    if (r.maxDur > 0) { totalDur += r.maxDur; durCount++; }
  });

  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    totalPageviews: rows.length,
    uniqueVisitors: uniqueSids.size,
    avgDurationSec: durCount ? Math.round((totalDur / durCount) / 1000) : 0,
    topPages: topN(pageCounts, 10),
    topReferrers: topN(refCounts, 10),
    devices: topN(deviceCounts, 5),
    recent: rows.slice(0, 100).map((r) => ({
      path: r.path,
      ref: r.ref,
      device: r.device,
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
      appendEvent({
        ts: Date.now(),
        type: data.type || 'pageview',
        path: typeof data.path === 'string' ? data.path.slice(0, 200) : '/',
        ref: typeof data.ref === 'string' ? data.ref.slice(0, 300) : '',
        sid: typeof data.sid === 'string' ? data.sid.slice(0, 60) : 'unknown',
        dur: typeof data.dur === 'number' ? Math.min(data.dur, 3 * 60 * 60 * 1000) : undefined,
        device: typeof data.device === 'string' ? data.device.slice(0, 20) : 'unknown',
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
