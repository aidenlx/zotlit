/**
 * Option A: napi + bundled SQLite + jieba FTS5 tokenizer
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const candidates = [
  path.join(root, 'dist', 'zotlit_fts.node'),
  path.join(root, 'zotlit_fts.node'),
  path.join(root, 'zotlit_fts.linux-x64-gnu.node'),
];
let addon;
for (const c of candidates) {
  if (fs.existsSync(c)) {
    try {
      addon = require(c);
      console.log('loaded', c);
      break;
    } catch (e) {
      console.error('require failed', c, e.message);
    }
  }
}
if (!addon) {
  console.error('addon not found');
  process.exit(2);
}

const results = { ok: true, steps: [] };
function step(name, fn) {
  try {
    const v = fn();
    results.steps.push({ name, ok: true, detail: v ?? null });
    console.log('OK ', name, v == null ? '' : JSON.stringify(v));
  } catch (e) {
    results.ok = false;
    results.steps.push({ name, ok: false, error: String(e?.message || e) });
    console.error('FAIL', name, e?.message || e);
  }
}

let db;
step('open', () => {
  db = addon.FtsDb.open(':memory:');
  return {
    sqlite: db.sqliteVersion(),
    fts5: db.compileOptionsHasFts5(),
  };
});

step('tokenize_debug', () => {
  return {
    index: addon.tokenizeDebug('版本控制系统', false),
    query: addon.tokenizeDebug('版本控制系统', true),
  };
});

step('create_and_query', () => {
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  db.run('INSERT INTO docs(content) VALUES (?)', ['版本控制系统是软件工程的基础']);
  db.run('INSERT INTO docs(content) VALUES (?)', ['今天天气很好']);
  const phrase = db.all(`SELECT content FROM docs WHERE docs MATCH '"版本 控制系统"'`);
  const andq = db.all(`SELECT content FROM docs WHERE docs MATCH '版本 AND 控制系统'`);
  const sub = db.all(`SELECT content FROM docs WHERE docs MATCH '控制'`);
  return { phrase, andq, subword_控制: sub };
});

fs.writeFileSync(
  path.join(root, 'dist', 'test-napi-node.json'),
  JSON.stringify(results, null, 2),
);
console.log('\nSUMMARY', results.ok ? 'PASS' : 'FAIL');
process.exit(results.ok ? 0 : 1);
