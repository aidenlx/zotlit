/**
 * Electron 37: loadExtension for ICU-only or ICU+jieba (pass SO path as argv[2]).
 */
import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const so = process.argv[2];
const out = process.argv[3] || '/tmp/electron-variant.json';
const results = {
  ok: true,
  electron: process.versions.electron,
  node: process.versions.node,
  so,
  steps: [],
};

function step(name, fn) {
  try {
    const v = fn();
    results.steps.push({ name, ok: true, detail: v ?? null });
    console.log('OK', name, v == null ? '' : JSON.stringify(v));
  } catch (e) {
    results.ok = false;
    results.steps.push({ name, ok: false, error: String(e?.message || e) });
    console.error('FAIL', name, e?.message || e);
  }
}

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  let db;
  step('open_allowExtension', () => {
    db = new DatabaseSync(':memory:', { allowExtension: true });
    return { sqlite: db.prepare('select sqlite_version() as v').get().v };
  });
  step('loadExtension', () => {
    db.loadExtension(so);
    return { path: so, bytes: fs.statSync(so).size };
  });
  step('tokenize_default', () => {
    db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
    db.prepare('INSERT INTO docs(content) VALUES (?)').run('版本控制系统是软件工程的基础');
    const n = db.prepare(`SELECT count(*) n FROM docs WHERE docs MATCH '控制'`).get().n;
    return { hit_控制: n };
  });
  step('arg_icu', () => {
    db.exec(`CREATE VIRTUAL TABLE t_icu USING fts5(c, tokenize='zotlit_cjk icu');`);
    return { ok: true };
  });
  step('arg_jieba', () => {
    try {
      db.exec(`CREATE VIRTUAL TABLE t_jb USING fts5(c, tokenize='zotlit_cjk jieba');`);
      db.prepare('INSERT INTO t_jb(c) VALUES (?)').run('版本控制系统');
      const n = db.prepare(`SELECT count(*) n FROM t_jb WHERE t_jb MATCH '控制'`).get().n;
      return { created: true, hit: n };
    } catch (e) {
      return { created: false, error: String(e.message || e).slice(0, 200) };
    }
  });
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('SUMMARY', results.ok ? 'PASS' : 'FAIL');
  app.exit(results.ok ? 0 : 1);
}).catch((e) => {
  fs.writeFileSync(out, JSON.stringify({ ok: false, error: String(e) }, null, 2));
  app.exit(2);
});
