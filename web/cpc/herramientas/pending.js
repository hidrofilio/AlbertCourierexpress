// Prints untranslated texts as "hash<TAB>topic<TAB>Spanish", in app order
const { hash, loadBank, loadTranslations, topicOrder } = require('./lib');
const bank = loadBank();
const tr = loadTranslations();
const from = parseInt(process.argv[2] || '0', 10);
const count = parseInt(process.argv[3] || '100000', 10);

const seen = new Set();
const pending = [];
for (const key of topicOrder(bank)) {
  const t = bank[key];
  for (const text of [t.title, ...t.questions.map((q) => q.exp)]) {
    const h = hash(text);
    if (tr[h] || seen.has(h)) continue;
    seen.add(h);
    pending.push(`${h}\t${key}\t${text.replace(/\n/g, '\\n')}`);
  }
}
console.error(`pending: ${pending.length}`);
console.log(pending.slice(from, from + count).join('\n'));
