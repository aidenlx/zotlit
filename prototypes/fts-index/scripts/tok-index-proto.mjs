/**
 * Prototype: cut_for_index for ZotLit PDF FTS (desktop).
 * Index: dict DAG words (len>=2) + max-prob cut tokens + optional Han bigrams on OOV/HMM.
 * Query: plain cut (max-prob) with AND (and phrase for comparison).
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { initSync, add_word } from 'jieba-wasm/web';

const require = createRequire(import.meta.url);
const { Jieba } = require('@node-rs/jieba');
const { dict } = require('@node-rs/jieba/dict');

const pages = JSON.parse(fs.readFileSync('/workspace/bench/progit-zh.clean.json'));
initSync({
  module: new WebAssembly.Module(
    fs.readFileSync('node_modules/jieba-wasm/pkg/web/jieba_rs_wasm_bg.wasm'),
  ),
});

const nodeJ = Jieba.withDict(dict);
const domain = Buffer.from('变基 2000 n\n快进 2000 n\n非快进 1000 n\n暂存区 2000 n\n');
const nodeJD = Jieba.withDict(Buffer.concat([dict, domain]));

const intl = new Intl.Segmenter('zh', { granularity: 'word' });
const cutI = (t) =>
  [...intl.segment(t)].filter((s) => s.isWordLike).map((s) => s.segment);

const hanLen = (s) => [...s].length;
function hanRuns(text) {
  return text.match(/[\u4e00-\u9fff]+/gu) || [];
}
function addBigrams(out, text) {
  for (const run of hanRuns(text)) {
    const chars = [...run];
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  }
}

function cutForIndex(text, { hmm = true, oovBigram = true, jieba = nodeJ } = {}) {
  const out = new Set();
  const all = jieba.cutAll(text);
  for (const t of all) if (hanLen(t) >= 2) out.add(t);
  const maxProb = jieba.cut(text, hmm);
  const allSet = new Set(all);
  for (const t of maxProb) {
    if (!t || /^\s+$/.test(t)) continue;
    out.add(t);
    if (oovBigram && !allSet.has(t) && /[\u4e00-\u9fff]/.test(t) && hanLen(t) >= 2) {
      const chars = [...t];
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
    }
  }
  return [...out];
}

function cutForIndexPlusBigram(text, opts = {}) {
  const out = cutForIndex(text, { ...opts, oovBigram: false });
  addBigrams(out, text);
  return out;
}

for (const w of ['变基', '快进', '非快进', '暂存区']) add_word(w, 2000, 'n');

const handQueries = [
  '版本', '控制', '系统', '版本控制', '版本控制系统',
  '分布式', '暂存区', '仓库', '远程仓库',
  '机器', '学习', '机器学习',
  '神经', '网络', '神经网络', '卷积', '卷积神经网络',
  '文献', '综述', '文献综述',
  '提交', '分支', '变基', '快进', '子模块', '旧版本',
];

function seededSample(n = 300) {
  const pool = new Set();
  for (let i = 0; i < pages.length; i += 2) {
    for (const t of nodeJ.cutAll(pages[i])) {
      const L = hanLen(t);
      if (L >= 2 && L <= 4 && /^[\u4e00-\u9fff]+$/.test(t)) pool.add(t);
    }
  }
  const arr = [...pool].sort();
  const step = Math.max(1, Math.floor(arr.length / n));
  const out = [];
  for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]);
  return out;
}

const autoQueries = seededSample(300);
const allQueries = [...new Set([...handQueries, ...autoQueries])];
console.error('queries', allQueries.length);

function gt(q) {
  const s = new Set();
  for (let i = 0; i < pages.length; i++) if (pages[i].includes(q)) s.add(i);
  return s;
}

function build(name, tok) {
  const path = `/tmp/fts-proto-${name.replace(/[^a-z0-9+_-]/gi, '_')}.db`;
  try { fs.unlinkSync(path); } catch {}
  const t0 = performance.now();
  const db = new DatabaseSync(path);
  db.exec(`CREATE VIRTUAL TABLE fts USING fts5(page UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')`);
  const ins = db.prepare('INSERT INTO fts(page,text) VALUES (?,?)');
  db.exec('BEGIN');
  let tokBytes = 0;
  let tokCount = 0;
  for (let i = 0; i < pages.length; i++) {
    const toks = tok(pages[i]).filter(Boolean);
    tokCount += toks.length;
    const s = toks.join(' ');
    tokBytes += Buffer.byteLength(s);
    ins.run(i, s);
  }
  db.exec('COMMIT');
  // fts_data page count
  let ftsPages = null;
  try {
    ftsPages = db.prepare(`SELECT * FROM fts WHERE fts MATCH '系统' LIMIT 1`).get();
    const info = db.prepare(`SELECT name FROM pragma_database_list`).all();
    void info;
  } catch {}
  db.prepare(`SELECT count(*) AS c FROM fts`).get();
  const ms = performance.now() - t0;
  // Measure fts index via dbstat if available
  let ftsDataBytes = null;
  try {
    const row = db.prepare(
      `SELECT sum(pgsize) AS b FROM dbstat WHERE name LIKE 'fts_%' OR name = 'fts'`,
    ).get();
    ftsDataBytes = row?.b ?? null;
  } catch {
    try {
      db.exec(`SELECT count(*) FROM dbstat`);
    } catch {}
  }
  db.close();
  const disk = fs.statSync(path).size;
  const db2 = new DatabaseSync(path, { readOnly: true });
  return { name, db: db2, tok, tokBytes, tokCount, ms, disk, ftsDataBytes, path };
}

const indexes = [
  build('intl', cutI),
  build('intl+bigram', (t) => {
    const out = [...cutI(t)];
    addBigrams(out, t);
    return out;
  }),
  build('cut_for_search', (t) => nodeJ.cutForSearch(t, true)),
  build('cut_all', (t) => nodeJ.cutAll(t)),
  build('cut_for_index', (t) => cutForIndex(t, { hmm: true, oovBigram: true, jieba: nodeJ })),
  build('cut_for_index_nohmm', (t) => cutForIndex(t, { hmm: false, oovBigram: true, jieba: nodeJ })),
  build('cut_for_index_domain', (t) => cutForIndex(t, { hmm: true, oovBigram: true, jieba: nodeJD })),
  build('cut_for_index+bigram', (t) => cutForIndexPlusBigram(t, { hmm: true, jieba: nodeJ })),
  build('cut_for_index_domain+bigram', (t) => cutForIndexPlusBigram(t, { hmm: true, jieba: nodeJD })),
];

function runMode(idx, q, mode, queryTok) {
  const qToks = queryTok(q).filter((t) => t && !/^\s+$/.test(t));
  if (!qToks.length) return { err: 'empty', hits: new Set() };
  const seen = new Set();
  const toks = qToks.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  let match;
  if (mode === 'phrase') match = `"${toks.join(' ')}"`;
  else if (mode === 'and') match = toks.map((t) => `"${t}"`).join(' AND ');
  else match = toks.map((t) => `"${t}"`).join(' OR ');
  try {
    const rows = idx.db.prepare('SELECT page FROM fts WHERE fts MATCH ?').all(match);
    return { hits: new Set(rows.map((r) => r.page)), qToks: toks, match };
  } catch (e) {
    return { err: e.message, hits: new Set(), qToks: toks, match };
  }
}

function queryTokFor(name) {
  if (name.startsWith('intl')) return cutI;
  if (name === 'cut_for_search') return (t) => nodeJ.cutForSearch(t, true);
  if (name === 'cut_all') return (t) => nodeJ.cut(t, true);
  if (name.includes('domain')) return (t) => nodeJD.cut(t, true);
  if (name.includes('nohmm')) return (t) => nodeJ.cut(t, false);
  return (t) => nodeJ.cut(t, true);
}

const summary = [];
const handDetail = {};

for (const idx of indexes) {
  const qTok = queryTokFor(idx.name);
  for (const mode of ['phrase', 'and']) {
    let sumR = 0, sumP = 0, n = 0, sumRhand = 0, nHand = 0;
    const misses = [];
    for (const q of allQueries) {
      const truth = gt(q);
      if (truth.size === 0) continue;
      const { hits, err } = runMode(idx, q, mode, qTok);
      if (err) continue;
      const tp = [...hits].filter((p) => truth.has(p)).length;
      const recall = tp / truth.size;
      const prec = hits.size ? tp / hits.size : 1;
      sumR += recall; sumP += prec; n++;
      if (handQueries.includes(q)) {
        sumRhand += recall; nHand++;
        if (mode === 'and' && recall < 0.999)
          misses.push({ q, recall: +recall.toFixed(3), truth: truth.size, hits: hits.size, tp });
      }
    }
    const row = {
      index: idx.name,
      mode,
      n,
      avgRecall: +(sumR / n).toFixed(4),
      avgPrecision: +(sumP / n).toFixed(4),
      handAvgRecall: nHand ? +(sumRhand / nHand).toFixed(4) : null,
      diskMB: +(idx.disk / 1e6).toFixed(2),
      ftsDataMB: idx.ftsDataBytes != null ? +(idx.ftsDataBytes / 1e6).toFixed(2) : null,
      tokMB: +(idx.tokBytes / 1e6).toFixed(2),
      tokCount: idx.tokCount,
      buildMs: +idx.ms.toFixed(1),
    };
    summary.push(row);
    if (mode === 'and') handDetail[idx.name] = misses;
    console.error(JSON.stringify(row));
  }
}

const hard = ['控制', '版本控制', '变基', '快进', '旧版本', '暂存区', '版本控制系统'];
const spots = {};
for (const idx of indexes) {
  const qTok = queryTokFor(idx.name);
  spots[idx.name] = {};
  for (const q of hard) {
    const truth = gt(q);
    const and = runMode(idx, q, 'and', qTok);
    const tp = [...and.hits].filter((p) => truth.has(p)).length;
    spots[idx.name][q] = {
      truth: truth.size,
      andRecall: truth.size ? +(tp / truth.size).toFixed(3) : null,
      qToks: qTok(q),
      indexSample: idx.tok(q).slice(0, 16),
    };
  }
}

// Sanity: token count for page 0
const p0 = pages[0];
console.error('p0 lens', {
  intl: cutI(p0).length,
  'intl+bi': (() => { const o=[...cutI(p0)]; addBigrams(o,p0); return o.length; })(),
  search: nodeJ.cutForSearch(p0,true).length,
  all: nodeJ.cutAll(p0).length,
  index: cutForIndex(p0).length,
  'index+bi': cutForIndexPlusBigram(p0).length,
});

const out = {
  summary,
  handMissesAnd: handDetail,
  spots,
  queries: { hand: handQueries.length, auto: autoQueries.length, total: allQueries.length },
};
fs.writeFileSync('/workspace/bench/tok-index-proto.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(summary.filter((r) => r.mode === 'and'), null, 2));
