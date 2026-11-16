# CPC tests in English (for classmates)

Builds `cpc/data-en.js` from the Spanish bank `cpc/data.js` without touching it.
Only the explanations (`exp`) and the titles are in Spanish; questions and options are already English.

- `tr/*.json` — translations, `{ "<hash of the Spanish text>": "English text" }`. Several files, merged in order.
- `node tools/cpc-en/build.js` — writes `cpc/data-en.js` and lists what is still untranslated.
- `node tools/cpc-en/pending.js [from] [count]` — prints untranslated explanations with their hash, to translate next.

When a Spanish explanation is edited, its hash changes and it shows up again as pending.
`tools/` is not served by the website (only `.js` under `cpc/` is public).
