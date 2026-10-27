/**
 * Recall/precision-ish microbench on progit-zh:
 * - A/C: native zotlit_cjk FTS5 tokenizer (colocated)
 * - cut_for_index: JS pretokenize → unicode61 FTS (space-joined)
 * - intl+bigram: Intl.Segmenter word + Han bigrams → unicode61
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = JSON.parse(fs.readFileSync('/workspace/bench/progit-zh.clean.json', 'utf8')).filter(
  (p) => p && String(p).trim(),
);

// Limit for speed
const DOCS = pages.slice(0, 200);

const { Jieba } = require('/workspace/bench/node_modules/@node-rs/jieba');
const { dict } = require('/workspace/bench/node_modules/@node-rs/jieba/dict');
const jieba = Jieba.withDict(dict);

const intl = new Intl.Segmenter('zh', { granularity: 'word' });
const hanLen = (s) => [...s].length;
const isHan = (s) => /^[\u4e00-\u9fff]+$/.test(s);

function cutForIndex(text) {
  const out = new Set();
  const all = jieba.cutAll(text);
  const allSet = new Set(all);
  for (const t of all) if (hanLen(t) >= 2) out.add(t);
  for (const t of jieba.cut(text, true)) {
    if (!t || /^\s+$/.test(t)) continue;
    out.add(t);
    if (!allSet.has(t) && /[\u4e00-\u9fff]/.test(t) && hanLen(t) >= 2) {
      const chars = [...t];
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
    }
  }
  return [...out];
}

function intlBigram(text) {
  const out = new Set();
  for (const s of intl.segment(text)) {
    if (s.isWordLike) out.add(s.segment);
  }
  for (const run of text.match(/[\u4e00-\u9fff]+/gu) || []) {
    const chars = [...run];
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
  }
  return [...out];
}

function escapeTok(t) {
  return '"' + String(t).replace(/"/g, '') + '"';
}

function buildPretokenized(name, tokenize) {
  const t0 = performance.now();
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='unicode61');`);
  const ins = db.prepare('INSERT INTO docs(rowid, content) VALUES (?, ?)');
  for (let i = 0; i < DOCS.length; i++) {
    const toks = tokenize(DOCS[i]).filter((t) => t && !/^\s+$/.test(t));
    ins.run(i + 1, toks.join(' '));
  }
  return { name, db, index_ms: performance.now() - t0 };
}

function buildNativeExt() {
  const t0 = performance.now();
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  db.loadExtension(path.join(root, 'dist', 'zotlit_cjk.so'));
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  const ins = db.prepare('INSERT INTO docs(rowid, content) VALUES (?, ?)');
  for (let i = 0; i < DOCS.length; i++) ins.run(i + 1, DOCS[i]);
  return { name: 'native_ext_zotlit_cjk', db, index_ms: performance.now() - t0 };
}

function buildNativeNapi() {
  const t0 = performance.now();
  const addon = require(path.join(root, 'dist', 'zotlit_fts.node'));
  const db = addon.FtsDb.open(':memory:');
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  for (let i = 0; i < DOCS.length; i++) {
    db.run('INSERT INTO docs(rowid, content) VALUES (?, ?)', [String(i + 1), DOCS[i]]);
  }
  return {
    name: 'native_napi_zotlit_cjk',
    db,
    index_ms: performance.now() - t0,
    isNapi: true,
  };
}

const queries = [
  '版本',
  '控制',
  '系统',
  '版本控制',
  '版本控制系统',
  '分布式',
  '暂存区',
  '仓库',
  '远程仓库',
  '提交',
  '分支',
  '变基',
  '快进',
  '子模块',
  '合并',
];

// Ground truth: page contains the query string as substring (char-level)
function relevantIds(q) {
  const ids = new Set();
  for (let i = 0; i < DOCS.length; i++) if (DOCS[i].includes(q)) ids.add(i + 1);
  return ids;
}

function search(engine, q) {
  if (engine.isNapi) {
    // For multi-char Chinese queries against colocated index: use AND of cut tokens if spaced
    // Simple: MATCH the query as FTS string; for multi-token use phrase when len>1 words
    const rows = engine.db.all(`SELECT rowid FROM docs WHERE docs MATCH ?`, [q]);
    return new Set(rows.map((r) => Number(r[0])));
  }
  try {
    const rows = engine.db.prepare(`SELECT rowid FROM docs WHERE docs MATCH ?`).all(q);
    return new Set(rows.map((r) => Number(r.rowid)));
  } catch (e) {
    return new Set();
  }
}

function metrics(hit, rel) {
  let tp = 0;
  for (const id of hit) if (rel.has(id)) tp++;
  const prec = hit.size ? tp / hit.size : 1;
  const rec = rel.size ? tp / rel.size : 1;
  const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
  return {
    hit: hit.size,
    rel: rel.size,
    tp,
    precision: +prec.toFixed(4),
    recall: +rec.toFixed(4),
    f1: +f1.toFixed(4),
  };
}

const engines = [
  buildNativeExt(),
  buildNativeNapi(),
  buildPretokenized('js_cut_for_index', cutForIndex),
  buildPretokenized('js_intl_bigram', intlBigram),
];

const report = { docs: DOCS.length, engines: {}, queries: {} };

for (const e of engines) {
  report.engines[e.name] = { index_ms: +e.index_ms.toFixed(2) };
}

for (const q of queries) {
  const rel = relevantIds(q);
  // Query forms:
  // native: pass Chinese query directly (tokenizer cuts)
  // pretokenized: join cut tokens with spaces for AND; also try as single token if present
  const cutQ = jieba.cut(q, true).filter((t) => t && !/^\s+$/.test(t));
  const andQ = cutQ.map(escapeTok).join(' AND ');
  const phraseQ = cutQ.length > 1 ? '"' + cutQ.join(' ') + '"' : escapeTok(q);

  report.queries[q] = { relevant: rel.size, results: {} };
  for (const e of engines) {
    let queryStr;
    if (e.name.startsWith('native')) {
      // use AND of cut for fair multi-token; also single-token queries as-is
      queryStr = cutQ.length > 1 ? cutQ.join(' AND ') : q;
      // For phrase test separately stored
    } else {
      queryStr = andQ;
    }
    const hit = search(e, queryStr);
    const m = metrics(hit, rel);
    // Also phrase for natives
    let phrase = null;
    if (e.name.startsWith('native') && cutQ.length > 1) {
      const ph = search(e, '"' + cutQ.join(' ') + '"');
      phrase = metrics(ph, rel);
    }
    report.queries[q].results[e.name] = { query: queryStr, ...m, phrase };
  }
}

// Aggregate macro-avg F1/recall
const aggs = {};
for (const e of engines) {
  let r = 0,
    p = 0,
    f = 0,
    n = 0;
  for (const q of queries) {
    const m = report.queries[q].results[e.name];
    if (report.queries[q].relevant === 0) continue;
    r += m.recall;
    p += m.precision;
    f += m.f1;
    n++;
  }
  aggs[e.name] = {
    macro_recall: +(r / n).toFixed(4),
    macro_precision: +(p / n).toFixed(4),
    macro_f1: +(f / n).toFixed(4),
    n_queries: n,
  };
}
report.aggregate = aggs;

fs.writeFileSync(path.join(root, 'dist', 'bench-recall.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ docs: report.docs, engines: report.engines, aggregate: aggs }, null, 2));
