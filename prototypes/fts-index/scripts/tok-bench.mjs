import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import initJiebaWasm, {
  cut as wasmCut,
  cut_for_search as wasmCutForSearch,
  cut_all as wasmCutAll,
  initSync as wasmInitSync,
} from 'jieba-wasm/web';

const require = createRequire(import.meta.url);
const { Jieba } = require('@node-rs/jieba');
const { dict } = require('@node-rs/jieba/dict');

const pages = JSON.parse(fs.readFileSync('/workspace/bench/progit-zh.clean.json', 'utf8'));
const FULL = pages.join('\n');
const BYTES = Buffer.byteLength(FULL, 'utf8');
const CJK_RUN = /([\u4e00-\u9fff]+)/u;

function stripNonCjkJoin(text, cutFn) {
  // ZotLit style: only feed CJK runs to jieba
  return text.split(CJK_RUN).flatMap((part, i) =>
    i % 2 === 1 ? cutFn(part) : part.match(/[A-Za-z0-9_]+/g) ?? [],
  );
}

function rssMB() {
  return Math.round(process.memoryUsage().rss / 1e6);
}

function bench(name, fn, { warmup = 1, runs = 3 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const ms = times[Math.floor(times.length / 2)];
  return {
    name,
    ms: +ms.toFixed(1),
    msPerPage: +(ms / pages.length).toFixed(3),
    MBps: +((BYTES / 1e6) / (ms / 1000)).toFixed(2),
  };
}

// --- init ---
const wasmBytes = fs.readFileSync(
  '/workspace/bench/node_modules/jieba-wasm/pkg/web/jieba_rs_wasm_bg.wasm',
);
let t0 = performance.now();
const module = new WebAssembly.Module(wasmBytes);
wasmInitSync({ module });
const wasmInitMs = performance.now() - t0;
console.log('jieba-wasm initSync ms', wasmInitMs.toFixed(1), 'rss', rssMB());

t0 = performance.now();
const nodeJieba = Jieba.withDict(dict);
const nodeInitMs = performance.now() - t0;
console.log('@node-rs/jieba withDict ms', nodeInitMs.toFixed(1), 'rss', rssMB());

t0 = performance.now();
const intl = new Intl.Segmenter('zh', { granularity: 'word' });
[...intl.segment('初始化')];
const intlInitMs = performance.now() - t0;
console.log('Intl.Segmenter init ms', intlInitMs.toFixed(1), 'rss', rssMB());

const cutIntl = (text) =>
  [...intl.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);

const modes = [
  ['intl', (t) => cutIntl(t)],
  ['wasm-cut-hmm', (t) => wasmCut(t, true)],
  ['wasm-cut-nohmm', (t) => wasmCut(t, false)],
  ['wasm-cut_for_search-hmm', (t) => wasmCutForSearch(t, true)],
  ['wasm-cut_for_search-nohmm', (t) => wasmCutForSearch(t, false)],
  ['wasm-cut_all', (t) => wasmCutAll(t)],
  ['node-rs-cut-hmm', (t) => nodeJieba.cut(t, true)],
  ['node-rs-cutForSearch-hmm', (t) => nodeJieba.cutForSearch(t, true)],
];

// Throughput on full book (one concat string) AND per-page
console.log('\n== throughput (full book one string) ==');
const thr = [];
for (const [name, fn] of modes) {
  thr.push(bench(name, () => fn(FULL), { warmup: 1, runs: 3 }));
}
console.table(thr);

console.log('\n== throughput (per-page loop) ==');
const thrP = [];
for (const [name, fn] of modes) {
  thrP.push(
    bench(name + '/page', () => {
      for (const p of pages) fn(p);
    }, { warmup: 1, runs: 3 }),
  );
}
console.table(thrP);

// Quality samples
const samples = [
  '版本控制系统',
  '分布式版本控制',
  '暂存区',
  '远程仓库',
  '机器学习',
  '卷积神经网络',
  '文献综述',
  '臺灣繁體字測試',
  '日本語の文章です',
  '한국어입니다',
  '中华人民共和国武汉市长江大桥',
];
console.log('\n== quality ==');
const quality = {};
for (const [name, fn] of modes) {
  quality[name] = Object.fromEntries(samples.map((s) => [s, fn(s).join('/')]));
}
fs.writeFileSync('/workspace/bench/tok-quality.json', JSON.stringify(quality, null, 2));
for (const s of samples) {
  console.log(s);
  for (const [name] of modes) console.log(' ', name.padEnd(28), quality[name][s]);
}

// FTS5 recall test
console.log('\n== FTS5 recall ==');
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
  '机器',
  '学习',
  '机器学习',
  '神经',
  '网络',
  '神经网络',
  '卷积',
  '卷积神经网络',
  '文献',
  '综述',
  '文献综述',
  'Git',
  '提交',
  '分支',
  '变基',
  '快进',
];

function buildIndex(name, tokenize) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE VIRTUAL TABLE fts USING fts5(page UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');`);
  const ins = db.prepare('INSERT INTO fts(page, text) VALUES (?, ?)');
  const t0 = performance.now();
  db.exec('BEGIN');
  for (let i = 0; i < pages.length; i++) {
    const toks = tokenize(pages[i]).filter((t) => t && t.trim());
    ins.run(i, toks.join(' '));
  }
  db.exec('COMMIT');
  const buildMs = performance.now() - t0;
  // disk-ish size via page_count
  const pages_db = db.prepare(`SELECT COUNT(*) c FROM fts`).get().c;
  // Estimate: dump tokens size
  let tokBytes = 0;
  for (let i = 0; i < pages.length; i++) {
    const toks = tokenize(pages[i]);
    tokBytes += Buffer.byteLength(toks.join(' '), 'utf8');
  }
  return { db, buildMs, tokBytes, pages_db, tokenize };
}

const indexers = [
  ['intl', (t) => cutIntl(t)],
  ['wasm-cut-hmm', (t) => wasmCut(t, true)],
  ['wasm-cut_for_search-hmm', (t) => wasmCutForSearch(t, true)],
  ['wasm-cut_all', (t) => wasmCutAll(t)],
  ['node-rs-cutForSearch', (t) => nodeJieba.cutForSearch(t, true)],
];

const indexes = {};
for (const [name, fn] of indexers) {
  indexes[name] = buildIndex(name, fn);
  console.log(
    'built',
    name,
    'ms',
    indexes[name].buildMs.toFixed(0),
    'tokMB',
    (indexes[name].tokBytes / 1e6).toFixed(2),
  );
}

function phraseQuery(toks) {
  // FTS5 phrase: "t1 t2 t3"
  if (!toks.length) return null;
  return `"${toks.map((t) => t.replace(/"/g, '""')).join(' ')}"`;
}

function groundTruthPages(q) {
  const hits = new Set();
  for (let i = 0; i < pages.length; i++) if (pages[i].includes(q)) hits.add(i);
  return hits;
}

const recallRows = [];
for (const [name, idx] of Object.entries(indexes)) {
  let hit = 0,
    miss = 0,
    emptyQ = 0,
    falsePos = 0;
  const misses = [];
  for (const q of queries) {
    const gt = groundTruthPages(q);
    if (gt.size === 0) {
      // still check FTS doesn't explode
    }
    const qToks = idx.tokenize(q).filter((t) => t && t.trim());
    if (!qToks.length) {
      emptyQ++;
      continue;
    }
    const pq = phraseQuery(qToks);
    let ftsHits;
    try {
      ftsHits = new Set(
        idx.db.prepare(`SELECT page FROM fts WHERE text MATCH ?`).all(pq).map((r) => r.page),
      );
    } catch (e) {
      misses.push({ q, err: e.message, qToks });
      miss++;
      continue;
    }
    // Recall: every GT page should be in FTS hits
    let allFound = true;
    for (const p of gt) {
      if (!ftsHits.has(p)) {
        allFound = false;
        break;
      }
    }
    // Also count false positives relative to substring (optional)
    for (const p of ftsHits) if (!gt.has(p)) falsePos++;
    if (allFound && gt.size > 0) hit++;
    else if (gt.size > 0) {
      miss++;
      misses.push({
        q,
        qToks,
        gt: gt.size,
        fts: ftsHits.size,
        missing: [...gt].filter((p) => !ftsHits.has(p)).slice(0, 5),
      });
    }
  }
  recallRows.push({
    name,
    hit,
    miss,
    emptyQ,
    falsePos,
    missExamples: misses.slice(0, 6),
  });
}
fs.writeFileSync('/workspace/bench/tok-recall.json', JSON.stringify(recallRows, null, 2));
for (const r of recallRows) {
  console.log(
    r.name,
    'hit',
    r.hit,
    'miss',
    r.miss,
    'emptyQ',
    r.emptyQ,
    'falsePosSum',
    r.falsePos,
  );
  for (const m of r.missExamples) console.log('  MISS', JSON.stringify(m));
}

// Agreement on random CJK runs from book
console.log('\n== agreement (sample CJK runs) ==');
const runs = [];
for (const p of pages) {
  for (const m of p.matchAll(/[\u4e00-\u9fff]{4,12}/g)) {
    runs.push(m[0]);
    if (runs.length >= 500) break;
  }
  if (runs.length >= 500) break;
}
let agreeCutIntl = 0,
  agreeSearchIntl = 0,
  agreeCutSearch = 0;
for (const r of runs) {
  const a = wasmCut(r, true).join('|');
  const b = wasmCutForSearch(r, true).join('|');
  const c = cutIntl(r).join('|');
  if (a === c) agreeCutIntl++;
  if (b === c) agreeSearchIntl++;
  if (a === b) agreeCutSearch++;
}
console.log('n', runs.length, 'cut==intl', agreeCutIntl, 'search==intl', agreeSearchIntl, 'cut==search', agreeCutSearch);

fs.writeFileSync(
  '/workspace/bench/tok-bench.json',
  JSON.stringify(
    {
      bytes: BYTES,
      pages: pages.length,
      wasmInitMs,
      nodeInitMs,
      intlInitMs,
      thr,
      thrP,
      wasmSize: wasmBytes.length,
      wasmGzip: 2805489,
      rssEnd: rssMB(),
    },
    null,
    2,
  ),
);
console.log('\ndone rss', rssMB());
