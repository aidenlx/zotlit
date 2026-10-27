/**
 * CJK FTS recall eval for ZotLit.
 * Ground-truth queries are sampled from SOURCE texts (asciidoc/wiki),
 * NEVER from PDF extraction / SDT / any layout method.
 * Index is built from PDF-extracted page text (method-independent check:
 * can the PDF index retrieve source-truth phrases?).
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = 'BENCH_ROOT/cjk-recall';
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

const EXT = {
  'baseline-icu': path.join(ROOT, 'dist/baseline/zotlit_cjk_icu.so'),
  'baseline-jieba': path.join(ROOT, 'dist/baseline/zotlit_cjk_icu_jieba.so'),
  'fixed-icu': path.join(ROOT, 'dist/fixed/zotlit_cjk_icu.so'),
  'fixed-jieba': path.join(ROOT, 'dist/fixed/zotlit_cjk_icu_jieba.so'),
};

// ---------- corpus ----------
function loadLines(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\n/).map((s) => s.trim()).filter(Boolean);
}

const zhSourceParas = [
  ...loadLines(path.join(ROOT, 'corpus/progit-zh-source-paras.txt')),
  ...loadLines(path.join(ROOT, 'corpus/extra/zhwiki-paras.txt')),
];
const jaSourceParas = [
  ...loadLines(path.join(ROOT, 'corpus/progit-ja-source-paras.txt')),
  ...loadLines(path.join(ROOT, 'corpus/extra/jawiki-paras.txt')),
];

const zhPdfPages = JSON.parse(fs.readFileSync('BENCH_ROOT/progit-zh.clean.json', 'utf8'));
const jaPdfPages = JSON.parse(fs.readFileSync('BENCH_ROOT/jk-corpus/progit-ja.pages.json', 'utf8'));

// Also index wiki source as additional "docs" for expanded recall (no PDF);
// mark them so we can report PDF-only vs all.
const zhWikiParas = loadLines(path.join(ROOT, 'corpus/extra/zhwiki-paras.txt'));
const jaWikiParas = loadLines(path.join(ROOT, 'corpus/extra/jawiki-paras.txt'));

// Hand-written realistic user terms
const ZH_HAND = [
  '版本', '控制', '系统', '版本控制', '版本控制系统',
  '分布式', '暂存区', '仓库', '远程仓库', '分支',
  '提交', '合并', '变基', '快进', '子模块',
  '机器学习', '神经网络', '卷积', '自然语言处理', '分词',
  '全文检索', '索引', 'Git',
];
const JA_HAND = [
  'ブランチ', 'リポジトリ', 'コミット', '変更', '管理',
  'バージョン管理', 'バージョン管理システム', '分散型',
  'ステージングエリア', 'マージ', 'プルリクエスト',
  '形態素解析', '全文検索', '自然言語処理',
];

// ---------- query sampling from SOURCE (not PDF) ----------
function sampleHanSubstrings(paras, { n = 200, minLen = 4, maxLen = 7, seed = 42 } = {}) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const out = [];
  const seen = new Set();
  const runs = [];
  for (const p of paras) {
    for (const m of p.matchAll(/[\u3400-\u9fff]{6,40}/g)) runs.push(m[0]);
  }
  if (!runs.length) return out;
  let guard = 0;
  while (out.length < n && guard++ < n * 50) {
    const run = runs[Math.floor(rand() * runs.length)];
    const len = minLen + Math.floor(rand() * (maxLen - minLen + 1));
    if (run.length < len) continue;
    const i = Math.floor(rand() * (run.length - len + 1));
    const q = run.slice(i, i + len);
    if (seen.has(q)) continue;
    seen.add(q);
    out.push({ q, kind: 'cjk-substr', lang: 'zh' });
  }
  return out;
}

function sampleJaSubstrings(paras, { n = 100, minLen = 4, maxLen = 8, seed = 7 } = {}) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const out = [];
  const seen = new Set();
  const runs = [];
  for (const p of paras) {
    for (const m of p.matchAll(/[\u3040-\u30ff\u3400-\u9fff]{6,40}/g)) runs.push(m[0]);
  }
  let guard = 0;
  while (out.length < n && guard++ < n * 50) {
    const run = runs[Math.floor(rand() * runs.length)];
    const len = minLen + Math.floor(rand() * (maxLen - minLen + 1));
    if (run.length < len) continue;
    const i = Math.floor(rand() * (run.length - len + 1));
    const q = run.slice(i, i + len);
    if (seen.has(q)) continue;
    seen.add(q);
    out.push({ q, kind: 'ja-substr', lang: 'ja' });
  }
  return out;
}

/** Realistic terms: dictionary-like 2–4 char words appearing in source */
function sampleZhTerms(paras, { n = 80, seed = 99 } = {}) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const freq = new Map();
  for (const p of paras) {
    for (const m of p.matchAll(/[\u3400-\u9fff]{2,4}/g)) {
      const w = m[0];
      // prefer word-aligned-ish by stepping 2
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  // Also collect overlapping 2/3/4 from runs but keep those with freq>=3
  const cands = [...freq.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
  const out = [];
  const seen = new Set();
  for (const [w] of cands) {
    if (seen.has(w)) continue;
    // light filter: skip pure function-ish singles already excluded by len>=2
    seen.add(w);
    out.push({ q: w, kind: 'zh-term', lang: 'zh' });
    if (out.length >= n) break;
  }
  // shuffle lightly
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

function sampleJaTerms(paras, { n = 40, seed = 11 } = {}) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const freq = new Map();
  for (const p of paras) {
    for (const m of p.matchAll(/[\u30a0-\u30ff]{3,10}/g)) freq.set(m[0], (freq.get(m[0]) || 0) + 1);
    for (const m of p.matchAll(/[\u3400-\u9fff]{2,4}/g)) freq.set(m[0], (freq.get(m[0]) || 0) + 1);
  }
  const cands = [...freq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [w] of cands) {
    out.push({ q: w, kind: 'ja-term', lang: 'ja' });
    if (out.length >= n) break;
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

// ---------- GT against a page list (substring containment) ----------
function gtPages(pages, q) {
  const hits = new Set();
  for (let i = 0; i < pages.length; i++) {
    if (pages[i] && pages[i].includes(q)) hits.add(i);
  }
  return hits;
}

// ---------- index + query ----------
function openExt(extPath, tokenize = "zotlit_cjk") {
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  if (extPath) db.loadExtension(extPath);
  db.exec(`CREATE VIRTUAL TABLE fts USING fts5(page UNINDEXED, text, tokenize='${tokenize}');`);
  return db;
}

function insertPages(db, pages) {
  const ins = db.prepare('INSERT INTO fts(page, text) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]) ins.run(i, pages[i]);
  }
  db.exec('COMMIT');
}

function indexSizeKiB(db) {
  // Approximate via vocab + page count; also sqlite memory not available.
  // Use fts5vocab term count as proxy + serialize via VACUUM INTO tmp if needed.
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS _v USING fts5vocab(fts, 'row');`);
    const n = db.prepare('SELECT count(*) AS c FROM _v').get().c;
    const sum = db.prepare('SELECT sum(length(term)) AS s FROM _v').get().s || 0;
    return { terms: n, termChars: sum };
  } catch {
    return { terms: null, termChars: null };
  }
}

/** Harness AND of overlapping bigrams (as used in layout-compare) */
function andBiQuery(q) {
  const toks = [];
  const chars = [...q];
  for (let i = 0; i + 1 < chars.length; i++) toks.push(`"${chars[i]}${chars[i + 1]}"`);
  return toks.slice(0, 3).join(' AND ');
}

function phraseQuery(q) {
  return `"${q.replace(/"/g, '')}"`;
}

function runQuery(db, match) {
  try {
    const rows = db.prepare('SELECT page FROM fts WHERE fts MATCH ?').all(match);
    return { pages: new Set(rows.map((r) => r.page)), err: null, match };
  } catch (e) {
    return { pages: new Set(), err: e.message, match };
  }
}

function metrics(gt, hits) {
  if (!gt.size) return { recall: null, prec: null, found: 0, gt: 0, hitN: hits.size };
  let found = 0;
  for (const p of gt) if (hits.has(p)) found++;
  return {
    recall: found / gt.size,
    prec: hits.size ? found / hits.size : 0,
    found,
    gt: gt.size,
    hitN: hits.size,
  };
}

function avg(arr) {
  const a = arr.filter((x) => x != null && !Number.isNaN(x));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

// ---------- diagnose failures ----------
function diagnoseTokenDiff(extPath, docSnippet, q) {
  // Index the snippet alone; dump vocab; try queries
  const db = openExt(extPath);
  db.prepare('INSERT INTO fts(page, text) VALUES (0, ?)').run(docSnippet);
  db.exec(`CREATE VIRTUAL TABLE v USING fts5vocab(fts, 'row');`);
  const vocab = db.prepare('SELECT term FROM v ORDER BY term').all().map((r) => r.term);
  // Tokenize query by indexing query string alone in a fresh db
  const dq = openExt(extPath);
  dq.prepare('INSERT INTO fts(page, text) VALUES (0, ?)').run(q);
  dq.exec(`CREATE VIRTUAL TABLE v USING fts5vocab(fts, 'row');`);
  const qDocTok = dq.prepare('SELECT term FROM v ORDER BY term').all().map((r) => r.term);
  // Note: query-path may differ from doc-path; we approximate query tokens via
  // MATCH behavior + comparing.
  const phrase = runQuery(db, phraseQuery(q));
  const bare = runQuery(db, q);
  const andBi = runQuery(db, andBiQuery(q));
  // Classify
  const causes = [];
  if (!docSnippet.includes(q)) causes.push('not_in_snippet');
  if (phrase.pages.size === 0 && bare.pages.size === 0) {
    // Which query tokens missing from vocab?
    const chars = [...q];
    const bigrams = [];
    for (let i = 0; i + 1 < chars.length; i++) bigrams.push(chars[i] + chars[i + 1]);
    const missingBi = bigrams.filter((b) => !vocab.includes(b));
    if (missingBi.length) causes.push('missing_bigrams_in_index:' + missingBi.join('|'));
    // If bigrams present but phrase fails → likely query tokenization split
    if (!missingBi.length) causes.push('query_tokenize_mismatch_or_position');
    // Mid-word: check if q is not a prefix of an ICU-ish boundary
    causes.push('substring_mid_word_likely');
  }
  if (andBi.pages.size === 0 && bigramsPresent(vocab, q)) {
    causes.push('and_bigram_harness_query_split');
  }
  return {
    q,
    docSnippet: docSnippet.slice(0, 80),
    vocabSample: vocab.slice(0, 40),
    qAsDocTokens: qDocTok,
    phraseHit: phrase.pages.size > 0,
    bareHit: bare.pages.size > 0,
    andBiHit: andBi.pages.size > 0,
    andBiMatch: andBiQuery(q),
    phraseErr: phrase.err,
    andBiErr: andBi.err,
    causes,
  };
}
function bigramsPresent(vocab, q) {
  const chars = [...q];
  for (let i = 0; i + 1 < Math.min(chars.length, 4); i++) {
    if (!vocab.includes(chars[i] + chars[i + 1])) return false;
  }
  return chars.length >= 2;
}

// ---------- false-hit proxy: random source strings NOT in the PDF index corpus ----------
function sampleFalseQueries(sourceParas, indexPages, { n = 50, len = 5, seed = 123 } = {}) {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const joined = indexPages.join('\n');
  const out = [];
  const seen = new Set();
  let guard = 0;
  while (out.length < n && guard++ < n * 80) {
    const p = sourceParas[Math.floor(rand() * sourceParas.length)];
    const runs = p.match(/[\u3400-\u9fff\u3040-\u30ff]{6,30}/g) || [];
    if (!runs.length) continue;
    const run = runs[Math.floor(rand() * runs.length)];
    if (run.length < len) continue;
    const i = Math.floor(rand() * (run.length - len + 1));
    const q = run.slice(i, i + len);
    if (seen.has(q) || joined.includes(q)) continue; // must NOT be in index corpus
    seen.add(q);
    out.push(q);
  }
  return out;
}

// ---------- main eval for one config ----------
function evalConfig(name, extPath, tokenize, pages, queries, { falseQueries = [] } = {}) {
  const t0 = performance.now();
  const db = extPath === null && tokenize === 'trigram'
    ? (() => { const d = new DatabaseSync(':memory:'); d.exec(`CREATE VIRTUAL TABLE fts USING fts5(page UNINDEXED, text, tokenize='trigram');`); return d; })()
    : openExt(extPath, tokenize);
  const tOpen = performance.now();
  insertPages(db, pages);
  const tIdx = performance.now();
  const size = indexSizeKiB(db);

  // tokenize speed: re-tokenize by building tiny dbs
  let tokMs = null;
  if (extPath) {
    const sample = pages.filter(Boolean).slice(0, 30).join('\n');
    const t1 = performance.now();
    for (let i = 0; i < 5; i++) {
      const d = openExt(extPath, tokenize);
      d.prepare('INSERT INTO fts(page,text) VALUES (0,?)').run(sample);
      d.close();
    }
    tokMs = (performance.now() - t1) / 5;
  }

  const byKind = {};
  const failures = [];
  for (const item of queries) {
    const gt = gtPages(pages, item.q);
    if (!gt.size) {
      // source-only query with no PDF occurrence — skip for recall (report separately)
      byKind[item.kind] = byKind[item.kind] || { phrase: [], and: [], bare: [], skippedNoGt: 0, n: 0 };
      byKind[item.kind].skippedNoGt++;
      continue;
    }
    byKind[item.kind] = byKind[item.kind] || { phrase: [], and: [], bare: [], skippedNoGt: 0, n: 0 };
    byKind[item.kind].n++;

    const ph = runQuery(db, phraseQuery(item.q));
    const br = runQuery(db, item.q);
    const an = runQuery(db, andBiQuery(item.q));
    const mph = metrics(gt, ph.pages);
    const mbr = metrics(gt, br.pages);
    const man = metrics(gt, an.pages);
    byKind[item.kind].phrase.push(mph.recall);
    byKind[item.kind].bare.push(mbr.recall);
    byKind[item.kind].and.push(man.recall);
    byKind[item.kind].phraseP = byKind[item.kind].phraseP || [];
    byKind[item.kind].bareP = byKind[item.kind].bareP || [];
    byKind[item.kind].phraseP.push(mph.prec);
    byKind[item.kind].bareP.push(mbr.prec);

    if (mph.recall < 1 && failures.length < 25) {
      failures.push({
        q: item.q,
        kind: item.kind,
        phraseR: +mph.recall.toFixed(3),
        bareR: +mbr.recall.toFixed(3),
        andR: +man.recall.toFixed(3),
        gt: mph.gt,
        phraseErr: ph.err,
        andErr: an.err,
      });
    }
  }

  // false-hit rate: queries known absent from corpus should not match
  let falseHits = 0;
  for (const q of falseQueries) {
    const ph = runQuery(db, phraseQuery(q));
    const br = runQuery(db, q);
    if (ph.pages.size || br.pages.size) falseHits++;
  }

  const summary = {};
  for (const [k, v] of Object.entries(byKind)) {
    summary[k] = {
      n: v.n,
      skippedNoGt: v.skippedNoGt,
      phraseRecall: avg(v.phrase),
      bareRecall: avg(v.bare),
      andBiRecall: avg(v.and),
      phrasePrec: avg(v.phraseP),
      barePrec: avg(v.bareP),
    };
  }

  db.close();
  return {
    name,
    extPath,
    tokenize,
    pages: pages.length,
    indexMs: +(tIdx - tOpen).toFixed(1),
    openMs: +(tOpen - t0).toFixed(1),
    tokSampleMs: tokMs != null ? +tokMs.toFixed(1) : null,
    size,
    falseQueries: falseQueries.length,
    falseHitRate: falseQueries.length ? falseHits / falseQueries.length : null,
    falseHits,
    byKind: summary,
    failures,
  };
}

// ---------- build query sets ----------
const zhSub = sampleHanSubstrings(zhSourceParas, { n: 200 });
const zhTerms = sampleZhTerms(zhSourceParas, { n: 80 });
const zhHand = ZH_HAND.map((q) => ({ q, kind: 'zh-hand', lang: 'zh' }));
const jaSub = sampleJaSubstrings(jaSourceParas, { n: 80 });
const jaTerms = sampleJaTerms(jaSourceParas, { n: 40 });
const jaHand = JA_HAND.map((q) => ({ q, kind: 'ja-hand', lang: 'ja' }));

const zhQueries = [...zhHand, ...zhTerms, ...zhSub];
const jaQueries = [...jaHand, ...jaTerms, ...jaSub];

const zhFalse = sampleFalseQueries(zhWikiParas.length ? zhWikiParas : zhSourceParas, zhPdfPages, { n: 40, len: 5 });
const jaFalse = sampleFalseQueries(jaWikiParas.length ? jaWikiParas : jaSourceParas, jaPdfPages, { n: 30, len: 5 });

fs.writeFileSync(path.join(OUT, 'queries.json'), JSON.stringify({
  zh: { hand: zhHand.length, terms: zhTerms.length, substr: zhSub.length, falseN: zhFalse.length, sampleSub: zhSub.slice(0, 15), sampleTerms: zhTerms.slice(0, 15) },
  ja: { hand: jaHand.length, terms: jaTerms.length, substr: jaSub.length, falseN: jaFalse.length, sampleSub: jaSub.slice(0, 10) },
  note: 'Queries sampled from asciidoc/wiki SOURCE, not PDF/SDT extraction',
}, null, 2));

// ---------- helpers: isolate each .so in its own process (SQLite registers
// tokenizer by symbol name `zotlit_cjk`; a second loadExtension in-process is a no-op) ----------
function runIsolated(job) {
  const jobPath = path.join(OUT, `_job_${job.id}.json`);
  const outPath = path.join(OUT, `_out_${job.id}.json`);
  fs.writeFileSync(jobPath, JSON.stringify(job));
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', jobPath, outPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`worker ${job.id} failed status=${r.status}`);
  }
  if (r.stderr) process.stderr.write(r.stderr);
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}


if (process.argv[2] === '--worker') {
  const job = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const outPath = process.argv[4];
  let result;
  if (job.type === 'diagnose') {
    result = job.qs.map((q) => diagnoseTokenDiff(job.extPath, job.doc, q));
  } else if (job.type === 'eval') {
    const pages = job.pagesFile ? JSON.parse(fs.readFileSync(job.pagesFile, 'utf8')) : job.pages;
    const queries = job.queriesFile ? JSON.parse(fs.readFileSync(job.queriesFile, 'utf8')) : job.queries;
    const falseQueries = job.falseFile ? JSON.parse(fs.readFileSync(job.falseFile, 'utf8')) : (job.falseQueries || []);
    result = evalConfig(job.name, job.extPath, job.tokenize, pages, queries, { falseQueries });
  } else {
    throw new Error('unknown job type ' + job.type);
  }
  fs.writeFileSync(outPath, JSON.stringify(result));
  process.exit(0);
}

// Persist query sets for workers
fs.writeFileSync(path.join(OUT, 'zh-queries.json'), JSON.stringify(zhQueries));
fs.writeFileSync(path.join(OUT, 'ja-queries.json'), JSON.stringify(jaQueries));
fs.writeFileSync(path.join(OUT, 'zh-false.json'), JSON.stringify(zhFalse));
fs.writeFileSync(path.join(OUT, 'ja-false.json'), JSON.stringify(jaFalse));

// ---------- diagnose (isolated) ----------
const diagDoc = '版本控制系统是软件工程的基础工具，广泛用于分布式协作。';
const diagQs = ['版本控制', '本控制系统', '制系统是', '软件工程', '件工程的', '分布式'];
const diagnostics = {
  baseline: runIsolated({ id: 'diag-base', type: 'diagnose', extPath: EXT['baseline-icu'], doc: diagDoc, qs: diagQs }),
  fixed: runIsolated({ id: 'diag-fixed', type: 'diagnose', extPath: EXT['fixed-icu'], doc: diagDoc, qs: diagQs }),
};
fs.writeFileSync(path.join(OUT, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
console.log('diagnostics: baseline 本控制系统 phrase=', diagnostics.baseline.find(x=>x.q==='本控制系统')?.phraseHit,
  'fixed=', diagnostics.fixed.find(x=>x.q==='本控制系统')?.phraseHit);

// ---------- run all configs on ZH PDF pages ----------
const zhConfigs = [
  ['baseline-icu', EXT['baseline-icu'], 'zotlit_cjk'],
  ['baseline-jieba', EXT['baseline-jieba'], 'zotlit_cjk'],
  ['fixed-icu', EXT['fixed-icu'], 'zotlit_cjk'],
  ['fixed-jieba', EXT['fixed-jieba'], 'zotlit_cjk'],
  ['trigram', null, 'trigram'],
];

const zhResults = [];
for (const [name, ext, tok] of zhConfigs) {
  console.log('ZH', name, '...');
  const r = runIsolated({
    id: 'zh-' + name,
    type: 'eval',
    name,
    extPath: ext,
    tokenize: tok,
    pagesFile: 'BENCH_ROOT/progit-zh.clean.json',
    queriesFile: path.join(OUT, 'zh-queries.json'),
    falseFile: path.join(OUT, 'zh-false.json'),
  });
  zhResults.push(r);
  console.log(JSON.stringify(r.byKind, null, 0));
  console.log('  falseHit', r.falseHitRate, 'idxMs', r.indexMs, 'terms', r.size.terms);
}

const jaConfigs = [
  ['baseline-icu', EXT['baseline-icu'], 'zotlit_cjk'],
  ['fixed-icu', EXT['fixed-icu'], 'zotlit_cjk'],
  ['trigram', null, 'trigram'],
];
const jaResults = [];
for (const [name, ext, tok] of jaConfigs) {
  console.log('JA', name, '...');
  const r = runIsolated({
    id: 'ja-' + name,
    type: 'eval',
    name,
    extPath: ext,
    tokenize: tok,
    pagesFile: 'BENCH_ROOT/jk-corpus/progit-ja.pages.json',
    queriesFile: path.join(OUT, 'ja-queries.json'),
    falseFile: path.join(OUT, 'ja-false.json'),
  });
  jaResults.push(r);
  console.log(JSON.stringify(r.byKind, null, 0));
}

// wiki self-index sanity (fixed only)
console.log('ZH wiki self-index sanity...');
const wikiPages = zhWikiParas;
const wikiQs = [
  ...sampleHanSubstrings(zhWikiParas, { n: 60, seed: 5 }),
  ...ZH_HAND.filter((q) => /[\u4e00-\u9fff]/.test(q)).map((q) => ({ q, kind: 'zh-hand', lang: 'zh' })),
];
fs.writeFileSync(path.join(OUT, 'wiki-pages.json'), JSON.stringify(wikiPages));
fs.writeFileSync(path.join(OUT, 'wiki-queries.json'), JSON.stringify(wikiQs));
const wikiFalse = sampleFalseQueries(zhSourceParas, wikiPages, { n: 30, len: 5, seed: 9 });
fs.writeFileSync(path.join(OUT, 'wiki-false.json'), JSON.stringify(wikiFalse));
const wikiSelf = runIsolated({
  id: 'wiki-self',
  type: 'eval',
  name: 'fixed-icu-wiki-self',
  extPath: EXT['fixed-icu'],
  tokenize: 'zotlit_cjk',
  pagesFile: path.join(OUT, 'wiki-pages.json'),
  queriesFile: path.join(OUT, 'wiki-queries.json'),
  falseFile: path.join(OUT, 'wiki-false.json'),
});

const report = {
  date: new Date().toISOString(),
  methodology: {
    queries: 'sampled from progit2-zh/ja asciidoc + zh/ja Wikipedia extracts (CC BY-SA); NOT from SDT/PDF extraction',
    index: 'progit-zh.clean.json / progit-ja.pages.json (PDF-extracted page text)',
    fix: 'CJK overlapping bigrams as PRIMARY (sequential) + ICU/jieba words COLOCATED; query emits bigram primaries',
    isolation: 'each .so loaded in a fresh Node process (SQLite tokenizer symbol collision)',
  },
  diagnostics,
  zh: zhResults,
  ja: jaResults,
  wikiSelf,
};
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2));
console.log('\nWrote', path.join(OUT, 'results.json'));

function row(r, kind) {
  const k = r.byKind[kind] || {};
  const f = (x) => (x == null ? '—' : x.toFixed(3));
  return `${r.name.padEnd(16)} ${kind.padEnd(12)} n=${String(k.n||0).padStart(3)}  phr=${f(k.phraseRecall)}  bare=${f(k.bareRecall)}  andBi=${f(k.andBiRecall)}  pP=${f(k.phrasePrec)}`;
}
console.log('\n=== ZH ===');
for (const r of zhResults) {
  for (const kind of ['zh-hand', 'zh-term', 'cjk-substr']) console.log(row(r, kind));
  console.log(`  falseHitRate=${r.falseHitRate}  terms=${r.size.terms}  idxMs=${r.indexMs}`);
}
console.log('\n=== JA ===');
for (const r of jaResults) {
  for (const kind of ['ja-hand', 'ja-term', 'ja-substr']) console.log(row(r, kind));
}
