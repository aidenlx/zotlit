import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { initSync, cut, cut_for_search, cut_all } from 'jieba-wasm/web';

const require = createRequire(import.meta.url);
const { Jieba } = require('@node-rs/jieba');
const { dict } = require('@node-rs/jieba/dict');
const nodeJ = Jieba.withDict(dict);

const pages = JSON.parse(fs.readFileSync('/workspace/bench/progit-zh.clean.json'));
initSync({
  module: new WebAssembly.Module(
    fs.readFileSync('node_modules/jieba-wasm/pkg/web/jieba_rs_wasm_bg.wasm'),
  ),
});
const intl = new Intl.Segmenter('zh', { granularity: 'word' });
const cutI = (t) =>
  [...intl.segment(t)].filter((s) => s.isWordLike).map((s) => s.segment);

const queries = [
  '版本', '控制', '系统', '版本控制', '版本控制系统',
  '分布式', '暂存区', '仓库', '远程仓库',
  '机器', '学习', '机器学习',
  '神经', '网络', '神经网络', '卷积', '卷积神经网络',
  '文献', '综述', '文献综述',
  '提交', '分支', '变基', '快进', '子模块', '旧版本',
];

function build(name, tok) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE VIRTUAL TABLE fts USING fts5(page UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')`);
  const ins = db.prepare('INSERT INTO fts(page,text) VALUES (?,?)');
  db.exec('BEGIN');
  let tokBytes = 0;
  for (let i = 0; i < pages.length; i++) {
    const toks = tok(pages[i]).filter(Boolean);
    const s = toks.join(' ');
    tokBytes += Buffer.byteLength(s);
    ins.run(i, s);
  }
  db.exec('COMMIT');
  return { name, db, tok, tokBytes };
}

const indexes = [
  build('intl', cutI),
  build('cut', (t) => cut(t, true)),
  build('cut_for_search', (t) => cut_for_search(t, true)),
  build('cut_all', (t) => cut_all(t)),
  build('node-rs-search', (t) => nodeJ.cutForSearch(t, true)),
  // hybrid: intl + bigrams of CJK runs
  build('intl+bigram', (t) => {
    const out = [...cutI(t)];
    for (const m of t.matchAll(/[\u4e00-\u9fff]+/g)) {
      const s = m[0];
      for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2));
    }
    return out;
  }),
];

function gt(q) {
  const s = new Set();
  for (let i = 0; i < pages.length; i++) if (pages[i].includes(q)) s.add(i);
  return s;
}

function runMode(idx, q, mode) {
  const qToks = idx.tok(q).filter((t) => t && !/^\s+$/.test(t));
  if (!qToks.length) return { err: 'empty', qToks };
  // unique preserve order
  const seen = new Set();
  const toks = qToks.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  let match;
  if (mode === 'phrase') match = `"${toks.join(' ')}"`;
  else if (mode === 'and') match = toks.map((t) => `"${t}"`).join(' AND ');
  else match = toks.map((t) => `"${t}"`).join(' OR ');
  try {
    const hits = new Set(
      idx.db.prepare('SELECT page FROM fts WHERE text MATCH ?').all(match).map((r) => r.page),
    );
    return { hits, qToks: toks, match };
  } catch (e) {
    return { err: e.message, qToks: toks, match };
  }
}

const summary = [];
for (const idx of indexes) {
  for (const mode of ['phrase', 'and', 'or']) {
    let perfect = 0,
      partial = 0,
      missAll = 0,
      noGt = 0;
    let recallSum = 0,
      precSum = 0,
      n = 0;
    const bad = [];
    for (const q of queries) {
      const g = gt(q);
      if (g.size === 0) {
        noGt++;
        continue;
      }
      const r = runMode(idx, q, mode);
      if (r.err) {
        missAll++;
        bad.push({ q, err: r.err, qToks: r.qToks });
        continue;
      }
      let found = 0;
      for (const p of g) if (r.hits.has(p)) found++;
      const recall = found / g.size;
      const prec = r.hits.size ? found / r.hits.size : 0;
      recallSum += recall;
      precSum += prec;
      n++;
      if (found === g.size) perfect++;
      else if (found === 0) {
        missAll++;
        bad.push({ q, qToks: r.qToks, gt: g.size, found: 0 });
      } else {
        partial++;
        if (bad.length < 4) bad.push({ q, qToks: r.qToks, gt: g.size, found, recall: +recall.toFixed(2) });
      }
    }
    summary.push({
      name: idx.name,
      mode,
      tokMB: +(idx.tokBytes / 1e6).toFixed(2),
      perfect,
      partial,
      missAll,
      avgRecall: +(recallSum / n).toFixed(3),
      avgPrec: +(precSum / n).toFixed(3),
      bad: bad.slice(0, 4),
    });
  }
}
fs.writeFileSync('/workspace/bench/tok-recall2.json', JSON.stringify(summary, null, 2));
for (const s of summary) {
  console.log(
    s.name.padEnd(16),
    s.mode.padEnd(7),
    'tokMB',
    String(s.tokMB).padStart(5),
    'perf',
    s.perfect,
    'part',
    s.partial,
    'miss',
    s.missAll,
    'R',
    s.avgRecall,
    'P',
    s.avgPrec,
  );
  for (const b of s.bad) console.log('   ', JSON.stringify(b));
}
