import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { initSync, cut_for_search } from 'jieba-wasm/web';
const pages = JSON.parse(fs.readFileSync('progit-zh.clean.json'));
initSync({ module: new WebAssembly.Module(fs.readFileSync('node_modules/jieba-wasm/pkg/web/jieba_rs_wasm_bg.wasm')) });
const intl = new Intl.Segmenter('zh', { granularity: 'word' });
const cutI = (t) => [...intl.segment(t)].filter((s) => s.isWordLike).map((s) => s.segment);
const bigram = (t) => { const out=[]; for (const m of t.matchAll(/[\u4e00-\u9fff]+/g)) { const s=m[0]; for (let i=0;i+1<s.length;i++) out.push(s.slice(i,i+2)); } return out; };
const toks = {
  intl: cutI,
  bigramOnly: bigram,
  'intl+bigram': (t) => cutI(t).concat(bigram(t)),
  cut_for_search: (t) => cut_for_search(t, true),
};
function med(a){a=[...a].sort((x,y)=>x-y);return a[a.length>>1];}
for (const [name, f] of Object.entries(toks)) {
  for (let w=0;w<3;w++) for (const p of pages) f(p);
  const tt=[], bt=[];
  let size=0;
  for (let r=0;r<7;r++){
    let t0=performance.now(); const docs=pages.map(p=>f(p).join(' ')); tt.push(performance.now()-t0);
    const db=new DatabaseSync(':memory:');
    db.exec(`CREATE VIRTUAL TABLE fts USING fts5(text, tokenize='unicode61 remove_diacritics 2')`);
    const ins=db.prepare('INSERT INTO fts(text) VALUES (?)');
    t0=performance.now(); db.exec('BEGIN'); for(const d of docs) ins.run(d); db.exec('COMMIT'); bt.push(performance.now()-t0);
    size=db.prepare("SELECT sum(length(block)) s FROM fts_data").get().s; db.close();
  }
  const T=med(tt), B=med(bt);
  console.log(`${name.padEnd(15)} tokenize ${T.toFixed(1)} ms (${(T/pages.length).toFixed(3)} ms/page)  fts insert ${B.toFixed(1)} ms  total ${(T+B).toFixed(1)} ms  index ${(size/1e6).toFixed(2)} MB`);
}
