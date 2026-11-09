// Shared helpers: load the Spanish bank and the translations
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const TR_DIR = path.join(__dirname, 'tr');

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function loadBank() {
  const sandbox = { window: {} };
  const src = fs.readFileSync(path.join(ROOT, 'cpc', 'data.js'), 'utf8');
  new Function('window', src)(sandbox.window);
  return sandbox.window.CPC_TEMAS;
}

function loadTranslations() {
  const all = {};
  for (const f of fs.readdirSync(TR_DIR).filter((f) => f.endsWith('.json')).sort()) {
    Object.assign(all, JSON.parse(fs.readFileSync(path.join(TR_DIR, f), 'utf8')));
  }
  return all;
}

// Topic order as the app shows it: numbered topics, then mock exams
const topicOrder = (bank) => Object.keys(bank).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));

module.exports = { ROOT, hash, loadBank, loadTranslations, topicOrder };
