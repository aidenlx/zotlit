/**
 * Option C: loadable extension into node:sqlite
 * Tests allowExtension + loadExtension + zotlit_cjk tokenizer.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extPath = path.join(root, 'dist', 'zotlit_cjk.so');

if (!fs.existsSync(extPath)) {
  console.error('MISSING', extPath);
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

step('open_allowExtension', () => {
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  results._db = db;
  return { sqlite: db.prepare('select sqlite_version() as v').get().v };
});

const db = results._db;

step('loadExtension_default_entrypoint', () => {
  // For file zotlit_cjk.so → sqlite3_zotlitcjk_init
  db.loadExtension(extPath);
  return 'loaded';
});

step('create_fts_with_tokenizer', () => {
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  return 'created';
});

step('insert_and_phrase_query', () => {
  db.prepare('INSERT INTO docs(content) VALUES (?)').run('版本控制系统是软件工程的基础');
  db.prepare('INSERT INTO docs(content) VALUES (?)').run('今天天气很好');
  // phrase query: cut tokens in order — "版本" then "控制系统" as phrase
  const phrase = db.prepare(`SELECT content FROM docs WHERE docs MATCH '"版本 控制系统"'`).all();
  // AND query via space
  const andq = db.prepare(`SELECT content FROM docs WHERE docs MATCH '版本 AND 控制系统'`).all();
  // subword via colocated: 控制 should hit
  const sub = db.prepare(`SELECT content FROM docs WHERE docs MATCH '控制'`).all();
  // negative
  const miss = db.prepare(`SELECT content FROM docs WHERE docs MATCH '不存在的词xyz'`).all();
  return {
    phrase: phrase.map((r) => r.content),
    andq: andq.map((r) => r.content),
    subword_控制: sub.map((r) => r.content),
    miss_count: miss.length,
  };
});

step('query_cut_only_no_false_bigram', () => {
  // Ensure query tokenization is cut-only; "控制系统" as whole query token should match
  const rows = db.prepare(`SELECT content FROM docs WHERE docs MATCH '控制系统'`).all();
  return rows.map((r) => r.content);
});

fs.writeFileSync(
  path.join(root, 'dist', 'test-ext-node.json'),
  JSON.stringify(results, null, 2),
);
console.log('\nSUMMARY', results.ok ? 'PASS' : 'FAIL');
process.exit(results.ok ? 0 : 1);
