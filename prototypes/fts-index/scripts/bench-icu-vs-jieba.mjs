/**
 * ICU-only vs ICU+jieba on progit-zh. Each .so loads in a child process
 * (SQLite extension symbols collide if two zotlit_cjk builds share a process).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const soFull = path.join(root, 'dist', 'zotlit_cjk_icu_jieba.so');
const soIcu = path.join(root, 'dist', 'zotlit_cjk_icu.so');

const MODE = process.env.BENCH_CHILD;
if (MODE) {
  const { so, arg, pagesPath, queries, label } = JSON.parse(process.env.BENCH_PAYLOAD);
  const pages = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
  const t0 = performance.now();
  const db = new DatabaseSync(':memory:', { allowExtension: true });
  db.loadExtension(so);
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='${arg}');`);
  const ins = db.prepare('INSERT INTO docs(rowid, content) VALUES (?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < pages.length; i++) ins.run(i + 1, pages[i]);
  db.exec('COMMIT');
  const index_ms = performance.now() - t0;
  const index_bytes = db.prepare(
    `SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()`,
  ).get().b;

  function gt(q) {
    const hits = [];
    for (let i = 0; i < pages.length; i++) if (pages[i].includes(q)) hits.push(i + 1);
    return hits;
  }
  function search(q, mode) {
    try {
      const match = mode === 'phrase' ? `"${q.replace(/"/g, '')}"` : q;
      return db.prepare(`SELECT rowid AS id FROM docs WHERE content MATCH ?`).all(match).map((r) => r.id);
    } catch {
      return [];
    }
  }
  function evalSet(qs) {
    let tp = 0, fp = 0, fn = 0, p_tp = 0, p_fp = 0, p_fn = 0;
    const samples = [];
    for (const q of qs) {
      const g = new Set(gt(q));
      if (!g.size) continue;
      const andHits = new Set(search(q, 'and'));
      const phHits = new Set(search(q, 'phrase'));
      let tpi = 0, fpi = 0;
      for (const h of andHits) (g.has(h) ? tpi++ : fpi++);
      const fni = [...g].filter((x) => !andHits.has(x)).length;
      tp += tpi; fp += fpi; fn += fni;
      let pt = 0, pf = 0;
      for (const h of phHits) (g.has(h) ? pt++ : pf++);
      const pn = [...g].filter((x) => !phHits.has(x)).length;
      p_tp += pt; p_fp += pf; p_fn += pn;
      if (samples.length < 6) {
        samples.push({
          q, gt: g.size,
          and_r: +(tpi / g.size).toFixed(3),
          and_p: +(andHits.size ? tpi / andHits.size : 0).toFixed(3),
          ph_r: +(pt / g.size).toFixed(3),
        });
      }
    }
    return {
      n: qs.length,
      and_recall: +(tp + fn ? tp / (tp + fn) : 0).toFixed(4),
      and_prec: +(tp + fp ? tp / (tp + fp) : 0).toFixed(4),
      phrase_recall: +(p_tp + p_fn ? p_tp / (p_tp + p_fn) : 0).toFixed(4),
      phrase_prec: +(p_tp + p_fp ? p_tp / (p_tp + p_fp) : 0).toFixed(4),
      samples,
    };
  }
  const out = {
    label,
    index_ms: +index_ms.toFixed(1),
    index_bytes,
    hand: evalSet(queries.hand),
    sampled300: evalSet(queries.sampled),
  };
  fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify(out));
  process.exit(0);
}

// Parent
const zhAll = JSON.parse(fs.readFileSync('/workspace/bench/progit-zh.clean.json', 'utf8')).filter(
  (p) => p && String(p).trim(),
);
const zhPages = zhAll.slice(0, 500);
const pagesPath = path.join(root, 'dist', '_zh500.json');
fs.writeFileSync(pagesPath, JSON.stringify(zhPages));

const zh15 = [
  '版本', '控制', '版本控制', '版本控制系统', '分支', '提交', '仓库', '分布式',
  '暂存区', '远程', '快进', '合并', '变基', '标签', '克隆',
];
function sampleHan(pages, n) {
  const out = [];
  const re = /[\u4e00-\u9fff]{2,8}/g;
  let guard = 0;
  while (out.length < n && guard < n * 80) {
    guard++;
    const p = pages[Math.floor(Math.random() * pages.length)];
    const m = p.match(re) || [];
    if (!m.length) continue;
    const s = m[Math.floor(Math.random() * m.length)];
    if ([...s].length >= 2) out.push(s);
  }
  return [...new Set(out)].slice(0, n);
}
const sampled = sampleHan(zhPages, 300);

const variants = [
  { name: 'icu-only', so: soIcu, arg: 'zotlit_cjk' },
  { name: 'icu-only icu', so: soIcu, arg: 'zotlit_cjk icu' },
  { name: 'full jieba', so: soFull, arg: 'zotlit_cjk jieba' },
  { name: 'full icu', so: soFull, arg: 'zotlit_cjk icu' },
  { name: 'full default', so: soFull, arg: 'zotlit_cjk' },
];

const zh = {};
for (const v of variants) {
  const outFile = path.join(root, 'dist', `_child_${v.name.replace(/\s+/g, '_')}.json`);
  const payload = {
    so: v.so,
    arg: v.arg,
    pagesPath,
    queries: { hand: zh15, sampled },
    label: v.name,
  };
  console.error('child', v.name, '…');
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, BENCH_CHILD: '1', BENCH_PAYLOAD: JSON.stringify(payload), BENCH_OUT: outFile },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`child failed: ${v.name}`);
  }
  zh[v.name] = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const s = zh[v.name];
  console.error(
    v.name,
    'hand AND',
    s.hand.and_recall,
    s.hand.and_prec,
    'ph',
    s.hand.phrase_recall,
    `idx ${s.index_ms}ms ${(s.index_bytes / 1024).toFixed(0)}KiB`,
    's300',
    s.sampled300.and_recall,
  );
}

// reject jieba on icu-only (fresh process)
const rejectFile = path.join(root, 'dist', '_reject.json');
const reject = spawnSync(
  process.execPath,
  [
    '-e',
    `
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(':memory:',{allowExtension:true});
    db.loadExtension(${JSON.stringify(soIcu)});
    try {
      db.exec("CREATE VIRTUAL TABLE t USING fts5(c, tokenize='zotlit_cjk jieba')");
      require('fs').writeFileSync(${JSON.stringify(rejectFile)}, JSON.stringify({ok:true}));
    } catch(e) {
      require('fs').writeFileSync(${JSON.stringify(rejectFile)}, JSON.stringify({ok:false,error:String(e.message||e)}));
    }
    `,
  ],
  { encoding: 'utf8' },
);
const rejectJieba = JSON.parse(fs.readFileSync(rejectFile, 'utf8'));

// EN + Thai token dump in fresh process with full.so
function dumpInChild(so, arg, text) {
  const outF = path.join(root, 'dist', '_tok.json');
  spawnSync(
    process.execPath,
    [
      '-e',
      `
      const {DatabaseSync}=require('node:sqlite');
      const fs=require('fs');
      const db=new DatabaseSync(':memory:',{allowExtension:true});
      db.loadExtension(${JSON.stringify(so)});
      db.exec("CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='${arg}');");
      db.prepare('INSERT INTO docs(content) VALUES (?)').run(${JSON.stringify(text)});
      db.exec("CREATE VIRTUAL TABLE v USING fts5vocab(docs,'row')");
      const terms=db.prepare('SELECT term FROM v ORDER BY term').all().map(r=>r.term);
      fs.writeFileSync(${JSON.stringify(outF)}, JSON.stringify(terms));
      `,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(fs.readFileSync(outF, 'utf8'));
}

const enText = 'Use pre-commit on git-scm.com with C++ and v2.4.0 — café';
const enIcu = dumpInChild(soFull, 'zotlit_cjk icu', enText);
function u61Tokens(text) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='unicode61');`);
  db.prepare('INSERT INTO docs(content) VALUES (?)').run(text);
  db.exec(`CREATE VIRTUAL TABLE v USING fts5vocab(docs, 'row');`);
  return db.prepare(`SELECT term FROM v ORDER BY term`).all().map((r) => r.term);
}
const thaiTok = dumpInChild(soFull, 'zotlit_cjk icu', 'ภาษาไทยคือภาษาประจำชาติของประเทศไทย');

// JA hand on full default
const jaPages = JSON.parse(fs.readFileSync('/workspace/bench/jk-corpus/progit-ja.pages.json', 'utf8'));
const jaPath = path.join(root, 'dist', '_ja.json');
fs.writeFileSync(jaPath, JSON.stringify(jaPages));
const jaHand = ['ブランチ', 'リポジトリ', 'コミット', '変更', '管理', 'バージョン管理システム'];
const jaOut = path.join(root, 'dist', '_child_ja.json');
spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
  env: {
    ...process.env,
    BENCH_CHILD: '1',
    BENCH_OUT: jaOut,
    BENCH_PAYLOAD: JSON.stringify({
      so: soFull,
      arg: 'zotlit_cjk',
      pagesPath: jaPath,
      queries: { hand: jaHand, sampled: [] },
      label: 'ja',
    }),
  },
  encoding: 'utf8',
});
const ja = JSON.parse(fs.readFileSync(jaOut, 'utf8'));

const out = {
  so_sizes: {
    icu_only: fs.statSync(soIcu).size,
    icu_jieba: fs.statSync(soFull).size,
  },
  zh,
  reject_jieba_on_icu_only: rejectJieba,
  english: { text: enText, icu: enIcu, unicode61: u61Tokens(enText) },
  thai: { tokens: thaiTok },
  ja_hand_full: ja.hand,
  generated_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(root, 'dist', 'bench-icu-vs-jieba.json'), JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      so_MiB: {
        icu_only: +(out.so_sizes.icu_only / 1048576).toFixed(2),
        icu_jieba: +(out.so_sizes.icu_jieba / 1048576).toFixed(2),
      },
      reject_jieba_on_icu_only: rejectJieba,
      zh: Object.fromEntries(
        Object.entries(zh).map(([k, v]) => [
          k,
          {
            ms: v.index_ms,
            KiB: Math.round(v.index_bytes / 1024),
            hand_and: [v.hand.and_recall, v.hand.and_prec],
            hand_ph: v.hand.phrase_recall,
            s300_and: v.sampled300.and_recall,
          },
        ]),
      ),
      en_icu: enIcu,
      en_u61: u61Tokens(enText),
      thai: thaiTok,
      ja_hand_and_R: ja.hand.and_recall,
    },
    null,
    2,
  ),
);
