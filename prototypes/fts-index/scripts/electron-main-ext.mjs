/**
 * Electron 37 main-process test: node:sqlite allowExtension + loadExtension + zotlit_cjk
 */
import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extPath = path.join(root, 'dist', 'zotlit_cjk.so');
const outPath = path.join(root, 'dist', 'test-ext-electron.json');

const results = {
  ok: true,
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  steps: [],
};

function step(name, fn) {
  try {
    const v = fn();
    results.steps.push({ name, ok: true, detail: v ?? null });
    console.log('OK ', name, v == null ? '' : JSON.stringify(v));
  } catch (e) {
    results.ok = false;
    results.steps.push({ name, ok: false, error: String(e?.message || e), stack: String(e?.stack || '') });
    console.error('FAIL', name, e?.message || e);
  }
}

app.whenReady().then(() => {
  step('node_sqlite_available', () => {
    return { keys: Object.keys(DatabaseSync ? { DatabaseSync } : {}) };
  });

  let db;
  step('open_allowExtension', () => {
    db = new DatabaseSync(':memory:', { allowExtension: true });
    const v = db.prepare('select sqlite_version() as v').get().v;
    // FTS5 presence — one-line confirm only (user confirmed Obsidian has it)
    let fts5 = false;
    try {
      db.exec(`CREATE VIRTUAL TABLE _fts5_probe USING fts5(x); DROP TABLE _fts5_probe;`);
      fts5 = true;
    } catch (_) {}
    return { sqlite: v, fts5_vtab: fts5 };
  });

  step('loadExtension', () => {
    db.loadExtension(extPath);
    return { path: extPath };
  });

  step('tokenizer_works', () => {
    db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
    db.prepare('INSERT INTO docs(content) VALUES (?)').run('版本控制系统是软件工程的基础');
    db.prepare('INSERT INTO docs(content) VALUES (?)').run('无关内容');
    const phrase = db.prepare(`SELECT content FROM docs WHERE docs MATCH '"版本 控制系统"'`).all();
    const andq = db.prepare(`SELECT content FROM docs WHERE docs MATCH '版本 AND 控制系统'`).all();
    const sub = db.prepare(`SELECT content FROM docs WHERE docs MATCH '控制'`).all();
    return {
      phrase: phrase.map((r) => r.content),
      andq: andq.map((r) => r.content),
      subword_控制: sub.map((r) => r.content),
    };
  });

  step('allowExtension_false_rejected', () => {
    const db2 = new DatabaseSync(':memory:'); // default allowExtension false
    let rejected = false;
    try {
      db2.loadExtension(extPath);
    } catch (e) {
      rejected = true;
      return { rejected, message: String(e.message || e).slice(0, 200) };
    }
    return { rejected, message: 'UNEXPECTED: load succeeded without allowExtension' };
  });

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log('\nSUMMARY', results.ok ? 'PASS' : 'FAIL');
  app.exit(results.ok ? 0 : 1);
}).catch((e) => {
  console.error('whenReady failed', e);
  fs.writeFileSync(outPath, JSON.stringify({ ok: false, error: String(e) }, null, 2));
  app.exit(2);
});
