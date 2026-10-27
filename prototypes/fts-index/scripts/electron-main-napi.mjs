/**
 * Electron 37 main-process test: Option A napi addon load + tokenizer
 */
import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outPath = path.join(root, 'dist', 'test-napi-electron.json');

const results = {
  ok: true,
  electron: process.versions.electron,
  node: process.versions.node,
  steps: [],
};

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

app.whenReady().then(() => {
  let addon;
  step('load_napi', () => {
    const p = path.join(root, 'dist', 'zotlit_fts.node');
    addon = require(p);
    return { path: p, keys: Object.keys(addon) };
  });

  let db;
  step('open_and_query', () => {
    db = addon.FtsDb.open(':memory:');
    db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
    db.run('INSERT INTO docs(content) VALUES (?)', ['版本控制系统是软件工程的基础']);
    const phrase = db.all(`SELECT content FROM docs WHERE docs MATCH '"版本 控制系统"'`);
    const sub = db.all(`SELECT content FROM docs WHERE docs MATCH '控制'`);
    return {
      sqlite: db.sqliteVersion(),
      fts5: db.compileOptionsHasFts5(),
      phrase,
      subword_控制: sub,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log('\nSUMMARY', results.ok ? 'PASS' : 'FAIL');
  app.exit(results.ok ? 0 : 1);
}).catch((e) => {
  console.error(e);
  app.exit(2);
});
