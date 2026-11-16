// Buscador de direcciones de Bravo Transfers, en el servidor (sin dependencias).
//
// Orden de búsqueda:
//   1. La lista propia (aeropuertos, estaciones, pueblos y ciudades de Andalucía): al instante.
//   2. Lo ya buscado antes (geo-cache.json, en DATA_DIR/bravo): al instante.
//   3. OpenStreetMap (Nominatim), una consulta por segundo como mucho y con nombre propio (su norma).
//   4. Photon (otro buscador libre sobre OpenStreetMap), si el primero falla.
//   5. Si nada funciona pero se nombra un pueblo de la lista («Hotel X, Benalmádena»), el precio
//      se calcula para ese pueblo y se guarda lo que escribió el cliente, para el conductor.
// Lo que no se encuentra se apunta en geo-misses.json, para añadirlo a la lista.
//
// Las sugerencias al escribir salen SOLO de la lista propia y de lo ya buscado: la norma de
// Nominatim no permite autocompletar con su servicio.
//
// Variables para las pruebas: BRAVO_GEO_URL (un Nominatim falso) y BRAVO_PHOTON_URL.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// [nombre en español, nombre en inglés, otros nombres, lat, lon, tipo]
const LIST = [
  ['Aeropuerto de Málaga (AGP)', 'Málaga Airport (AGP)', ['aeropuerto', 'aeropuerto malaga', 'airport', 'malaga airport', 'agp', 'flughafen', 'flughafen malaga', 'aeroport', 'aeroporto', 'aeropuerto de malaga'], 36.6749, -4.4991, 'airport'],
  ['Estación María Zambrano', 'María Zambrano train station', ['maria zambrano', 'estacion maria zambrano', 'estacion de tren malaga', 'train station', 'malaga train station', 'bahnhof malaga', 'ave malaga'], 36.7117, -4.4325, 'station'],
  ['Puerto de Málaga', 'Málaga Port', ['puerto', 'puerto malaga', 'puerto de malaga', 'port', 'malaga port', 'cruise port', 'terminal de cruceros', 'cruise terminal'], 36.7128, -4.4152, 'port'],
  ['Estación de autobuses de Málaga', 'Málaga bus station', ['estacion de autobuses', 'bus station', 'malaga bus station'], 36.7113, -4.4346, 'station'],
  ['Málaga centro', 'Málaga city centre', ['malaga', 'malaga centro', 'centro malaga', 'malaga city', 'malaga city centre', 'malaga city center', 'malaga ciudad'], 36.7213, -4.4214, 'town'],
  ['Muelle Uno (Málaga)', 'Muelle Uno (Málaga)', ['muelle uno'], 36.7187, -4.4153, 'place'],
  ['Pedregalejo (Málaga)', 'Pedregalejo (Málaga)', ['pedregalejo'], 36.7206, -4.3833, 'place'],
  ['El Palo (Málaga)', 'El Palo (Málaga)', ['el palo'], 36.7226, -4.3605, 'place'],
  ['Torremolinos', 'Torremolinos', [], 36.6203, -4.4998, 'town'],
  ['Benalmádena', 'Benalmádena', ['benalmadena costa', 'arroyo de la miel', 'puerto marina', 'puerto marina benalmadena'], 36.5988, -4.5167, 'town'],
  ['Fuengirola', 'Fuengirola', ['los boliches'], 36.5398, -4.6247, 'town'],
  ['Mijas', 'Mijas', ['mijas pueblo'], 36.5958, -4.6373, 'town'],
  ['La Cala de Mijas', 'La Cala de Mijas', ['la cala', 'mijas costa', 'cala de mijas'], 36.5017, -4.6844, 'town'],
  ['Marbella', 'Marbella', [], 36.5101, -4.8825, 'town'],
  ['Puerto Banús', 'Puerto Banús', ['puerto banus', 'banus'], 36.4874, -4.9524, 'town'],
  ['Nueva Andalucía (Marbella)', 'Nueva Andalucía (Marbella)', ['nueva andalucia'], 36.5040, -4.9550, 'town'],
  ['San Pedro de Alcántara', 'San Pedro de Alcántara', ['san pedro alcantara', 'san pedro'], 36.4851, -4.9917, 'town'],
  ['Benahavís', 'Benahavís', [], 36.5232, -5.0463, 'town'],
  ['Estepona', 'Estepona', [], 36.4256, -5.1466, 'town'],
  ['Casares', 'Casares', [], 36.4446, -5.2736, 'town'],
  ['Manilva', 'Manilva', ['sabinillas'], 36.3767, -5.2500, 'town'],
  ['Sotogrande', 'Sotogrande', [], 36.2869, -5.2756, 'town'],
  ['Gibraltar', 'Gibraltar', [], 36.1408, -5.3536, 'town'],
  ['La Línea de la Concepción', 'La Línea de la Concepción', ['la linea'], 36.1611, -5.3481, 'town'],
  ['Algeciras', 'Algeciras', [], 36.1408, -5.4562, 'town'],
  ['Tarifa', 'Tarifa', [], 36.0143, -5.6044, 'town'],
  ['Rincón de la Victoria', 'Rincón de la Victoria', ['rincon de la victoria', 'la cala del moral'], 36.7172, -4.2765, 'town'],
  ['Torre del Mar', 'Torre del Mar', [], 36.7406, -4.0939, 'town'],
  ['Vélez-Málaga', 'Vélez-Málaga', ['velez malaga', 'velez'], 36.7808, -4.1013, 'town'],
  ['Torrox', 'Torrox', ['torrox costa'], 36.7593, -3.9524, 'town'],
  ['Nerja', 'Nerja', [], 36.7577, -3.8752, 'town'],
  ['Frigiliana', 'Frigiliana', [], 36.7904, -3.8946, 'town'],
  ['Almuñécar', 'Almuñécar', ['almunecar'], 36.7339, -3.6907, 'town'],
  ['La Herradura', 'La Herradura', [], 36.7353, -3.7383, 'town'],
  ['Salobreña', 'Salobreña', ['salobrena'], 36.7464, -3.5870, 'town'],
  ['Motril', 'Motril', [], 36.7458, -3.5179, 'town'],
  ['Alhaurín de la Torre', 'Alhaurín de la Torre', ['alhaurin de la torre'], 36.6640, -4.5616, 'town'],
  ['Alhaurín el Grande', 'Alhaurín el Grande', ['alhaurin el grande'], 36.6418, -4.6876, 'town'],
  ['Coín', 'Coín', ['coin'], 36.6597, -4.7567, 'town'],
  ['Antequera', 'Antequera', [], 37.0194, -4.5612, 'town'],
  ['Ronda', 'Ronda', [], 36.7423, -5.1671, 'town'],
  ['Setenil de las Bodegas', 'Setenil de las Bodegas', ['setenil'], 36.8636, -5.1797, 'town'],
  ['Granada', 'Granada', [], 37.1773, -3.5986, 'town'],
  ['La Alhambra (Granada)', 'The Alhambra (Granada)', ['alhambra', 'la alhambra'], 37.1761, -3.5881, 'place'],
  ['Sierra Nevada (Pradollano)', 'Sierra Nevada (Pradollano)', ['sierra nevada', 'pradollano'], 37.0947, -3.3967, 'town'],
  ['Sevilla', 'Seville', ['sevilla', 'seville', 'sevilla centro'], 37.3891, -5.9845, 'town'],
  ['Córdoba', 'Córdoba', ['cordoba'], 37.8882, -4.7794, 'town'],
  ['Cádiz', 'Cádiz', ['cadiz'], 36.5271, -6.2886, 'town'],
  ['Jerez de la Frontera', 'Jerez de la Frontera', ['jerez'], 36.6850, -6.1261, 'town'],
  ['Almería', 'Almería', ['almeria'], 36.8340, -2.4637, 'town'],
  ['Jaén', 'Jaén', ['jaen'], 37.7796, -3.7849, 'town'],
  ['Huelva', 'Huelva', [], 37.2614, -6.9447, 'town'],
  ['Aeropuerto de Sevilla (SVQ)', 'Seville Airport (SVQ)', ['aeropuerto sevilla', 'seville airport', 'svq'], 37.4180, -5.8931, 'airport'],
  ['Aeropuerto de Granada (GRX)', 'Granada Airport (GRX)', ['aeropuerto granada', 'granada airport', 'grx'], 37.1887, -3.7774, 'airport'],
  ['Aeropuerto de Gibraltar (GIB)', 'Gibraltar Airport (GIB)', ['aeropuerto gibraltar', 'gibraltar airport', 'gib'], 36.1512, -5.3497, 'airport'],
  ['Estación de Sevilla Santa Justa', 'Seville Santa Justa station', ['santa justa', 'estacion sevilla', 'seville station'], 37.3920, -5.9757, 'station'],
  ['Estación de Granada', 'Granada train station', ['estacion granada', 'granada station'], 37.1844, -3.6087, 'station'],
  ['Estación de Córdoba', 'Córdoba train station', ['estacion cordoba', 'cordoba station'], 37.8886, -4.7893, 'station']
];

// minúsculas, sin acentos ni signos
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
}
const ENTRIES = LIST.map(([es, en, alias, lat, lon, kind]) => ({ es, en, lat, lon, kind, keys: Array.from(new Set([norm(es), norm(en)].concat(alias.map(norm)))) }));

function get(url, ms, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const rq = mod.get(url, { headers: Object.assign({ 'User-Agent': 'BravoTransfers/1.0 (+https://albertcourierexpress.com/bravo/)', Accept: 'application/json' }, headers || {}) }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; if (b.length > 500000) rq.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('http ' + res.statusCode));
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    });
    rq.setTimeout(ms, () => rq.destroy(new Error('timeout')));
    rq.on('error', reject);
  });
}

module.exports = function makeGeo(dir) {
  const CACHE = path.join(dir, 'geo-cache.json');
  const MISSES = path.join(dir, 'geo-misses.json');
  const NOMINATIM = (process.env.BRAVO_GEO_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
  const PHOTON = (process.env.BRAVO_PHOTON_URL || 'https://photon.komoot.io').replace(/\/$/, '');
  let cache = null;
  function loadCache() {
    if (!cache) { try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { cache = {}; } }
    return cache;
  }
  function saveCache() {
    const c = loadCache(), keys = Object.keys(c);
    // Como mucho 5.000: se quitan los menos usados
    if (keys.length > 5000) keys.sort((a, b) => (c[a].hits || 0) - (c[b].hits || 0)).slice(0, keys.length - 5000).forEach((k) => { delete c[k]; });
    try { fs.writeFileSync(CACHE, JSON.stringify(c)); } catch (e) { /* sin caché en disco, no pasa nada */ }
  }
  const clean = (s) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  function fromList(e, lang) { return { lat: e.lat, lon: e.lon, label: lang === 'en' ? e.en : e.es, kind: e.kind, source: 'list' }; }

  // Nominatim: una consulta por segundo, en fila
  let queue = Promise.resolve(), last = 0;
  function throttled(fn) {
    const run = queue.then(async () => {
      const gap = 1100 - (Date.now() - last);
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      last = Date.now();
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  }
  async function nominatim(q, lang) {
    const url = NOMINATIM + '/search?format=json&limit=1&countrycodes=es,gi&viewbox=-7.6,38.8,-1.6,35.9&accept-language=' + (lang === 'en' ? 'en' : 'es') + '&q=' + encodeURIComponent(q);
    const data = await throttled(() => get(url, 6000));
    if (!Array.isArray(data) || !data.length) return null;
    const label = clean(String(data[0].display_name || q).split(',').slice(0, 3).join(','));
    return { lat: Number(data[0].lat), lon: Number(data[0].lon), label, source: 'osm' };
  }
  async function photon(q, lang) {
    const url = PHOTON + '/api/?limit=1&lat=36.72&lon=-4.42' + (lang === 'en' ? '&lang=en' : '') + '&q=' + encodeURIComponent(q);
    const data = await get(url, 6000);
    const f = data && Array.isArray(data.features) && data.features.find((x) => x.geometry && x.properties && ['ES', 'GI'].includes(String(x.properties.countrycode || '').toUpperCase()));
    if (!f) return null;
    const p = f.properties;
    const label = clean([p.name, p.street && p.housenumber ? p.street + ' ' + p.housenumber : p.street, p.city || p.county].filter(Boolean).join(', '));
    return { lat: Number(f.geometry.coordinates[1]), lon: Number(f.geometry.coordinates[0]), label: label || clean(q), source: 'photon' };
  }
  const valid = (r) => r && Number.isFinite(r.lat) && Number.isFinite(r.lon) && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180;
  // Un pueblo de la lista nombrado dentro de lo escrito («Hotel X, Benalmádena»): el más largo que encaje
  function townIn(nq) {
    let best = null;
    for (const e of ENTRIES) {
      for (const k of e.keys) {
        if (k.length < 4) continue;
        if ((' ' + nq + ' ').includes(' ' + k + ' ') && (!best || k.length > best.k.length)) best = { e, k };
      }
    }
    return best && best.e;
  }
  function miss(q, lang) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(MISSES, 'utf8')); } catch (e) { /* vacío */ }
    list.push({ q: clean(q), lang, at: new Date().toISOString() });
    try { fs.writeFileSync(MISSES, JSON.stringify(list.slice(-300))); } catch (e) { /* no pasa nada */ }
  }

  // Devuelve { result } (o result: null si no hay nada) o { error: 'geo' } si no responde ningún buscador
  async function search(q, lang) {
    q = clean(q);
    const nq = norm(q);
    if (nq.length < 2) return { result: null };
    const exact = ENTRIES.find((e) => e.keys.includes(nq));
    if (exact) return { result: fromList(exact, lang) };
    const c = loadCache(), ck = (lang === 'en' ? 'en' : 'es') + '|' + nq;
    if (c[ck]) { c[ck].hits = (c[ck].hits || 0) + 1; c[ck].last = new Date().toISOString(); saveCache(); return { result: { lat: c[ck].lat, lon: c[ck].lon, label: c[ck].label, source: 'cache' } }; }
    let r = null, down = 0;
    for (const fn of [nominatim, photon]) {
      try { r = await fn(q, lang); if (valid(r)) break; r = null; } catch (e) { down++; }
    }
    if (valid(r)) {
      c[ck] = { lat: r.lat, lon: r.lon, label: r.label, q, at: new Date().toISOString(), hits: 1 };
      saveCache();
      return { result: r };
    }
    const town = townIn(nq);
    if (town) return { result: { lat: town.lat, lon: town.lon, label: q, zone: lang === 'en' ? town.en : town.es, approx: true, source: 'zone' } };
    miss(q, lang);
    return down === 2 ? { error: 'geo' } : { result: null };
  }

  // Sugerencias al escribir: solo la lista propia y lo ya buscado
  function suggest(q, lang) {
    const nq = norm(q);
    if (nq.length < 2) return [];
    const out = [];
    const starts = (k) => k.startsWith(nq) || k.split(' ').some((w) => w.startsWith(nq));
    for (const e of ENTRIES) if (e.keys.some(starts)) out.push(Object.assign(fromList(e, lang), { score: e.keys.some((k) => k.startsWith(nq)) ? 0 : 1 }));
    const c = loadCache();
    for (const k of Object.keys(c)) {
      const v = c[k];
      if (!k.startsWith((lang === 'en' ? 'en' : 'es') + '|')) continue;
      if (norm(v.label).includes(nq) || norm(v.q).includes(nq)) out.push({ lat: v.lat, lon: v.lon, label: v.label, source: 'cache', score: 2 - Math.min(1, (v.hits || 0) / 20) });
    }
    const seen = new Set();
    return out.sort((a, b) => a.score - b.score).filter((x) => { const k = x.label; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 6).map(({ lat, lon, label, kind }) => ({ lat, lon, label, airport: kind === 'airport' }));
  }
  function misses() { try { return JSON.parse(fs.readFileSync(MISSES, 'utf8')); } catch (e) { return []; } }
  return { search, suggest, misses, _norm: norm };
};
