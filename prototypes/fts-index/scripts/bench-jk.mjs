/**
 * JA/KO recall bench + ZH regression for zotlit_cjk (ICU routing).
 * Variants: ext-icu (native), intl, intl+bigram, bigram-only, unicode61.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const so = path.join(root, 'dist', 'zotlit_cjk.so');
const outDir = path.join(root, 'dist');

const jaPages = JSON.parse(fs.readFileSync('/workspace/bench/jk-corpus/progit-ja.pages.json', 'utf8'));
const koPages = JSON.parse(fs.readFileSync('/workspace/bench/jk-corpus/progit-ko.pages.json', 'utf8'));
const zhPages = JSON.parse(fs.readFileSync('/workspace/bench/progit-zh.clean.json', 'utf8')).filter(
  (p) => p && String(p).trim(),
);
const qsets = JSON.parse(fs.readFileSync('/workspace/bench/jk-corpus/queries.json', 'utf8'));

function sampleSubstrings(pages, n, minLen, locale) {
  const out = [];
  const re =
    locale === 'ko'
      ? /[\uac00-\ud7af]{2,8}/g
      : locale === 'ja'
        ? /(?:[\u3040-\u30ff]|[\u4e00-\u9fff]){2,10}/g
        : /[\u4e00-\u9fff]{2,6}/g;
  let guard = 0;
  while (out.length < n && guard < n * 50) {
    guard++;
    const p = pages[Math.floor(Math.random() * pages.length)];
    const matches = p.match(re) || [];
    if (!matches.length) continue;
    const m = matches[Math.floor(Math.random() * matches.length)];
    if ([...m].length >= minLen) out.push(m);
  }
  return out;
}

function groundTruth(pages, q) {
  const hits = [];
  for (let i = 0; i < pages.length; i++) if (pages[i].includes(q)) hits.push(i + 1);
  return hits;
}

function escapeTok(t) {
  return '"' + String(t).replace(/"/g, '') + '"';
}

function segIntl(text, locale) {
  const seg = new Intl.Segmenter(locale, { granularity: 'word' });
  return [...seg.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
}

function bigramsCJK(text) {
  const out = [];
  const chars = [...text].filter((c) =>
    /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c),
  );
  for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

function intlPlusBigram(text, locale) {
  return [...new Set([...segIntl(text, locale), ...bigramsCJK(text)])];
}

function buildPretok(pages, tokenize) {
  const t0 = performance.now();
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='unicode61');`);
  const ins = db.prepare('INSERT INTO docs(rowid, content) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < pages.length; i++) {
    const toks = tokenize(pages[i]).filter((t) => t && !/^\s+$/.test(t));
    ins.run(i + 1, toks.join(' '));
  }
  db.exec('COMMIT');
  const index_ms = performance.now() - t0;
  const page_size = db.prepare(`SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()`).get().b;
  return { db, index_ms, page_size };
}

function buildExt(pages, tokArg = 'zotlit_cjk') {
  const t0 = performance.now();
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  db.loadExtension(so);
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='${tokArg}');`);
  const ins = db.prepare('INSERT INTO docs(rowid, content) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < pages.length; i++) ins.run(i + 1, pages[i]);
  db.exec('COMMIT');
  const index_ms = performance.now() - t0;
  const page_size = db.prepare(`SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()`).get().b;
  return { db, index_ms, page_size };
}

function buildUnicode61(pages) {
  const t0 = performance.now();
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='unicode61');`);
  const ins = db.prepare('INSERT INTO docs(rowid, content) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < pages.length; i++) ins.run(i + 1, pages[i]);
  db.exec('COMMIT');
  return { db, index_ms: performance.now() - t0, page_size: db.prepare(`SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()`).get().b };
}

function queryExt(db, q, mode) {
  // For pretok indexes, join query tokens with spaces / AND
  let match;
  if (mode === 'raw') {
    match = q;
  } else if (mode === 'intl') {
    const toks = segIntl(q, modeLocale);
    if (!toks.length) return [];
    match = mode === 'phrase' ? `"${toks.join(' ')}"` : toks.map(escapeTok).join(' AND ');
  }
  return db.prepare(`SELECT rowid AS id FROM docs WHERE content MATCH ?`).all(match).map((r) => r.id);
}

function evalQueries(label, pages, queries, searchFn) {
  let tp = 0,
    fp = 0,
    fn = 0,
    phrase_ok = 0,
    phrase_n = 0;
  const rows = [];
  for (const q of queries) {
    const gt = new Set(groundTruth(pages, q));
    if (gt.size === 0) {
      rows.push({ q, gt: 0, hit: 0, note: 'no-gt' });
      continue;
    }
    const hits = searchFn(q, 'and');
    const hs = new Set(hits);
    let tpi = 0,
      fpi = 0;
    for (const h of hs) {
      if (gt.has(h)) tpi++;
      else fpi++;
    }
    const fni = [...gt].filter((g) => !hs.has(g)).length;
    tp += tpi;
    fp += fpi;
    fn += fni;
    const recall = tpi / gt.size;
    const prec = hs.size ? tpi / hs.size : 0;
    // phrase: quoted whole query when multi-token-ish
    phrase_n++;
    const ph = searchFn(q, 'phrase');
    const phs = new Set(ph);
    const ph_tp = [...phs].filter((h) => gt.has(h)).length;
    if (ph_tp === gt.size || (phs.size && ph_tp / gt.size >= 0.9)) phrase_ok++;
    rows.push({
      q,
      gt: gt.size,
      hit: hs.size,
      recall: +recall.toFixed(3),
      prec: +prec.toFixed(3),
      phrase_recall: +(gt.size ? ph_tp / gt.size : 0).toFixed(3),
    });
  }
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const prec = tp + fp ? tp / (tp + fp) : 0;
  return {
    label,
    n_queries: queries.length,
    micro_recall: +recall.toFixed(4),
    micro_prec: +prec.toFixed(4),
    phrase_frac: phrase_n ? +(phrase_ok / phrase_n).toFixed(3) : 0,
    samples: rows.slice(0, 8),
  };
}

function makeSearch(db, kind, locale) {
  return (q, mode) => {
    try {
      if (kind === 'ext') {
        if (mode === 'phrase') {
          // tokenize via MATCH "q" — FTS5 phrases need space-separated tokens;
          // for CJK tokenizer, quoting the raw string still re-tokenizes.
          return db
            .prepare(`SELECT rowid AS id FROM docs WHERE content MATCH ?`)
            .all(`"${q.replace(/"/g, '')}"`)
            .map((r) => r.id);
        }
        return db
          .prepare(`SELECT rowid AS id FROM docs WHERE content MATCH ?`)
          .all(q)
          .map((r) => r.id);
      }
      // pretok: query with same tokenizer
      let toks;
      if (kind === 'intl') toks = segIntl(q, locale);
      else if (kind === 'intl+bg') toks = intlPlusBigram(q, locale);
      else if (kind === 'bigram') toks = bigramsCJK(q);
      else toks = q.split(/\s+/).filter(Boolean);
      if (!toks.length) return [];
      const match =
        mode === 'phrase'
          ? `"${toks.join(' ').replace(/"/g, '')}"`
          : toks.map(escapeTok).join(' AND ');
      return db.prepare(`SELECT rowid AS id FROM docs WHERE content MATCH ?`).all(match).map((r) => r.id);
    } catch (e) {
      return [];
    }
  };
}

function runLang(locale, pages, hand) {
  console.error(`\n=== ${locale} docs=${pages.length} ===`);
  const sampled = sampleSubstrings(pages, 200, 2, locale);
  const queries = [...new Set([...hand, ...sampled])];

  const variants = {};
  {
    const b = buildExt(pages);
    variants['ext-icu'] = { ...b, kind: 'ext' };
  }
  {
    const b = buildPretok(pages, (t) => segIntl(t, locale));
    variants['intl'] = { ...b, kind: 'intl' };
  }
  {
    const b = buildPretok(pages, (t) => intlPlusBigram(t, locale));
    variants['intl+bigram'] = { ...b, kind: 'intl+bg' };
  }
  {
    const b = buildPretok(pages, (t) => bigramsCJK(t));
    variants['bigram-only'] = { ...b, kind: 'bigram' };
  }
  {
    const b = buildUnicode61(pages);
    variants['unicode61'] = { ...b, kind: 'u61' };
  }

  const summary = [];
  for (const [name, v] of Object.entries(variants)) {
    const handStats = evalQueries(
      `${name}/hand`,
      pages,
      hand,
      makeSearch(v.db, v.kind, locale),
    );
    const allStats = evalQueries(
      `${name}/all`,
      pages,
      queries,
      makeSearch(v.db, v.kind, locale),
    );
    // particle-focused for KO
    let particle = null;
    if (locale === 'ko') {
      const pq = hand.filter((q) => /에서|의|하면|은|는|을|를$/.test(q) || q === '저장소' || q === '커밋');
      particle = evalQueries(`${name}/particle`, pages, pq, makeSearch(v.db, v.kind, locale));
    }
    summary.push({
      variant: name,
      index_ms: +v.index_ms.toFixed(1),
      index_bytes: v.page_size,
      hand: handStats,
      all: allStats,
      particle,
    });
    console.error(
      name,
      'hand R/P',
      handStats.micro_recall,
      handStats.micro_prec,
      'all R',
      allStats.micro_recall,
      `idx ${v.index_ms.toFixed(0)}ms ${(v.page_size / 1024).toFixed(0)}KiB`,
    );
  }
  return { locale, docs: pages.length, summary };
}

// ZH 15-query regression (same spirit as prior report)
const ZH15 = [
  '版本',
  '控制',
  '版本控制',
  '版本控制系统',
  '分支',
  '提交',
  '仓库',
  '分布式',
  '快照',
  '暂存区',
  '工作目录',
  '合并',
  '冲突',
  '远程',
  '标签',
];

function zhRegression() {
  const pages = zhPages.slice(0, 200);
  const b = buildExt(pages);
  const stats = evalQueries('ext-icu/zh15', pages, ZH15, makeSearch(b.db, 'ext', 'zh'));
  // mixed page
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  db.loadExtension(so);
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='zotlit_cjk');`);
  db.prepare('INSERT INTO docs(rowid,content) VALUES (1, ?)').run(
    '日本語のバージョン管理と中文版本控制 and 한국어 저장소에서',
  );
  const mixed = {};
  for (const q of ['バージョン', '版本', '控制', '저장소', '관리']) {
    mixed[q] = db.prepare(`SELECT rowid FROM docs WHERE content MATCH ?`).all(q).length;
  }
  return { zh15: stats, index_ms: b.index_ms, mixed };
}

Math.seedrandom = undefined;
// deterministic-ish sample
const _r = Math.random;
let seed = 42;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const ja = runLang('ja', jaPages, qsets.ja_hand);
const ko = runLang('ko', koPages, qsets.ko_hand);
const zh = zhRegression();
Math.random = _r;

const soSize = fs.statSync(so).size;
const report = {
  so_bytes: soSize,
  ja,
  ko,
  zh,
  generated_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, 'bench-jk.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ so_bytes: soSize, zh_recall: zh.zh15.micro_recall, zh_mixed: zh.mixed }, null, 2));
console.error('wrote dist/bench-jk.json');
