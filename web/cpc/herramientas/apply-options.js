// Replaces the options of goods questions from a JSON map {"g10#3": [four options], ...}.
// The correct answer keeps its position, so the new list must keep its meaning there.
const fs = require('fs'), path = require('path');
const fix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dir = path.join(__dirname, 'goods');
let n = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
  const p = path.join(dir, f);
  const t = JSON.parse(fs.readFileSync(p, 'utf8'));
  t.questions.forEach((q, i) => { const o = fix[t.key + '#' + (i + 1)]; if (o) { q.options = o; n++; } });
  const head = JSON.stringify({ key: t.key, title: t.title, source: t.source }).slice(0, -1);
  fs.writeFileSync(p, head + ',\n"questions": [\n' + t.questions.map(q => JSON.stringify(q)).join(',\n') + '\n]\n}\n');
}
console.log('options replaced:', n);
