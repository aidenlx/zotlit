import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'dist', 'zotlit_cjk.so');
const napi = path.join(root, 'dist', 'zotlit_fts.node');

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function bench(name, n, fn) {
  const times = [];
  // warmup
  fn();
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return { name, n, median_ms: +median(times).toFixed(3), min_ms: +Math.min(...times).toFixed(3), max_ms: +Math.max(...times).toFixed(3) };
}

const out = {};

out.ext_cold_open = bench('ext_load+register+create', 20, () => {
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  db.loadExtension(ext);
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  db.close();
});

out.napi_cold_open = bench('napi_open+create', 20, () => {
  // require is cached; measure open which includes jieba init on first call only
  const addon = require(napi);
  const db = addon.FtsDb.open(':memory:');
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
});

// First-require / first-open separately (process restart would be truer; approximate with isolated measure)
{
  // jieba already warm from above; measure tokenizer-bound insert/query
  const addon = require(napi);
  const db = addon.FtsDb.open(':memory:');
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  const sample = '版本控制系统是软件工程的基础，子模块与变基操作需要仔细处理。';
  out.napi_insert = bench('napi_insert_1doc', 50, () => {
    db.run('INSERT INTO docs(content) VALUES (?)', [sample]);
  });
  db.run('INSERT INTO docs(content) VALUES (?)', [sample]);
  out.napi_query_phrase = bench('napi_query_phrase', 50, () => {
    db.all(`SELECT content FROM docs WHERE docs MATCH '"版本 控制系统"'`);
  });
}

{
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  db.loadExtension(ext);
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  const sample = '版本控制系统是软件工程的基础，子模块与变基操作需要仔细处理。';
  const ins = db.prepare('INSERT INTO docs(content) VALUES (?)');
  out.ext_insert = bench('ext_insert_1doc', 50, () => {
    ins.run(sample);
  });
  ins.run(sample);
  const q = db.prepare(`SELECT content FROM docs WHERE docs MATCH '"版本 控制系统"'`);
  out.ext_query_phrase = bench('ext_query_phrase', 50, () => q.all());
}

fs.writeFileSync(path.join(root, 'dist', 'bench-cold.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
