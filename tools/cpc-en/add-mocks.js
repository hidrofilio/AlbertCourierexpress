// Adds the mock exams in tools/cpc-en/mocks/*.json to cpc/data.js (Spanish explanations, for the
// owner's app) and their English explanations to tools/cpc-en/tr/mocks.json (for the classmates' site).
// Each question: {q, options, correct, es, en}. A mock already in data.js is left as it is.
// Then run build.js to regenerate cpc/data-en.js.
const fs = require('fs');
const path = require('path');
const { ROOT, hash } = require('./lib');

const DATA = path.join(ROOT, 'cpc', 'data.js');
const TR = path.join(__dirname, 'tr', 'mocks.json');
let src = fs.readFileSync(DATA, 'utf8');
const tr = fs.existsSync(TR) ? JSON.parse(fs.readFileSync(TR, 'utf8')) : {};
let problems = 0;
const fail = (m) => { console.error('PROBLEM:', m); problems++; };

const dir = path.join(__dirname, 'mocks');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  m.questions.forEach((q, i) => {
    const w = `${m.key} #${i + 1}`;
    if (q.options.length !== 4 || new Set(q.options).size !== 4) fail(w + ': needs 4 different options');
    if (!(q.correct >= 0 && q.correct < 4)) fail(w + ': bad correct index');
    if (!q.es.includes('📍') || !q.en.includes('📍')) fail(w + ': both explanations need a 📍 line');
    // options are shuffled in the apps, so explanations must not name them by letter
    if (/(^|[^A-Za-z])\([A-D](\)|,| y | and )/.test(q.es + q.en)) fail(w + ': explanation names an option by letter');
    tr[hash(q.es)] = q.en;
  });
  tr[hash(m.title_es)] = m.title_en;
  if (src.includes(`\n"${m.key}": { title:`)) { console.log(m.key, 'already in data.js'); continue; }
  const block = `"${m.key}": { title: ${JSON.stringify(m.title_es)}, questions: [\n` +
    m.questions.map(({ q, options, correct, es }) => JSON.stringify({ q, options, correct, exp: es })).join(',\n') + '\n]}';
  const end = src.lastIndexOf('\n};');
  src = src.slice(0, end) + ',\n' + block + src.slice(end);
  console.log(m.key, 'added:', m.questions.length, 'questions');
}
if (problems) process.exit(1);
fs.writeFileSync(DATA, src);
fs.writeFileSync(TR, JSON.stringify(tr, null, 0).replace(/","/g, '",\n"'));
