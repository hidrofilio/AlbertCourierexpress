// Comprueba que la web sirve lo que tiene que servir, y nada más (sin dependencias).
// Uso, desde la carpeta principal:  node web/pruebas/direcciones.js
// Arranca web/server.js en un puerto libre, con una carpeta de datos temporal, y pide cada dirección.
// Se hizo al ordenar las carpetas (16/11/2026): las direcciones de la web no deben cambiar nunca.
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const REPO = path.join(__dirname, '..', '..');
const PORT = 4300 + Math.floor(Math.random() * 500), KEY = 'prueba-' + Date.now();
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'web-pruebas-'));
// [dirección, estado esperado, tipo esperado (opcional)]
const CASOS = [
  ['/', 200, 'text/html'], ['/index.html', 200, 'text/html'], ['/robots.txt', 200], ['/sitemap.xml', 200],
  ['/favicon.png', 200, 'image/png'], ['/og-image.jpg', 200, 'image/jpeg'], ['/signature-v5.gif', 200, 'image/gif'],
  ['/fondoalbertcourier.jpg', 200, 'image/jpeg'], ['/whatsapp-qr.png', 200, 'image/png'], ['/email-signature.html', 200],
  ['/stats/', 200, 'text/html'], ['/notas/', 200, 'text/html'],
  ['/cpc/', 200, 'text/html'], ['/cpc/data.js', 200], ['/cpc/data-en.js', 200], ['/cpc/buscar.js', 200], ['/cpc-study/', 200, 'text/html'],
  ['/bravo/', 401], ['/bravo/panel/', 401], ['/%62ravo/panel/', 401], ['//bravo/panel/', 401], ['/x/../bravo/panel/', 401],
  // Lo que no se puede ver nunca
  ['/server.js', 404], ['/web/server.js', 404], ['/bravo/bravo-api.js', 401], ['/bravo-api.js', 404], ['/package.json', 404],
  ['/CLAUDE.md', 404], ['/CAMBIOS/README.md', 404], ['/data/events.jsonl', 404], ['/cpc-study/x.js', 404],
  ['/cpc/../server.js', 404], ['/web/cpc/herramientas/lib.js', 404], ['/.git/config', 404], ['/no-existe.jpg', 404]
];
function get(url) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: url, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '' })); })
      .on('error', (e) => resolve({ status: 'ERROR ' + e.code, type: '' }));
  });
}
(async () => {
  const srv = spawn('node', [path.join(REPO, 'web', 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA, STATS_KEY: KEY, EMAIL_KEY: '' }), stdio: ['ignore', 'ignore', 'inherit'] });
  await new Promise((r) => setTimeout(r, 1200));
  let fallos = 0;
  for (const [url, status, type] of CASOS) {
    const r = await get(url);
    const ok = r.status === status && (!type || r.type.startsWith(type));
    if (!ok) { fallos++; console.log('❌', url, '→', r.status, r.type, '(se esperaba', status + (type ? ' ' + type : '') + ')'); }
  }
  console.log(fallos ? fallos + ' de ' + CASOS.length + ' direcciones fallan' : '✅ Las ' + CASOS.length + ' direcciones responden bien');
  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
})();
