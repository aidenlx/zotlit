/**
 * v3 FTS quality eval: A/B/C/D vs SOURCE_GT_V3, fixed CJK tokenizer only.
 * Each worker process loads the .so once (same-name loadExtension twice is ignored).
 * Usage: NODE24 eval_fts_v3.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXTRACT = path.join(ROOT, 'extract');
const OUT = path.join(ROOT, 'out');
const VIZ = path.join(ROOT, 'viz');
const GT = JSON.parse(fs.readFileSync(path.join(ROOT, 'gt/SOURCE_GT_V3.json'), 'utf8'));
const EXT = 'BENCH_ROOT/cjk-recall/dist/fixed/zotlit_cjk_icu.so';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(VIZ, { recursive: true });

const METHODS = ['A', 'B', 'C-block', 'C-page', 'D-block', 'D-page'];

function soft(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[\u2010-\u2015\u00ad]/g, '-')
    .replace(/[^a-z0-9\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, '');
}
function hyphenArtifacts(text) {
  return (String(text).match(/[A-Za-z]{3,}-\s+[a-z]{2,}/g) || []).length;
}
function escapeFts(q) {
  return '"' + String(q).replace(/"/g, '') + '"';
}

function unitsFor(ex, method) {
  if (method === 'A') return ex.A?.units || [];
  if (method === 'B') return ex.B?.units || [];
  if (method === 'C-block') return ex.C?.blockUnits || [];
  if (method === 'C-page') return ex.C?.units || [];
  if (method === 'D-block') return ex.D?.blockUnits || [];
  if (method === 'D-page') return ex.D?.units || [];
  return [];
}

function indexAndProbe(units, phrases, label, furnitureList, adjacencyPairs, sourceParas) {
  const tmpDb = path.join(OUT, `_tmp_${label}_${process.pid}_${Date.now()}.sqlite`);
  try { fs.unlinkSync(tmpDb); } catch {}
  const db = new DatabaseSync(tmpDb, { allowExtension: true });
  db.loadExtension(EXT);
  db.exec(`CREATE VIRTUAL TABLE fts USING fts5(unit_id, page_index UNINDEXED, text, tokenize='zotlit_cjk')`);
  const ins = db.prepare('INSERT INTO fts VALUES (?,?,?)');
  const t0 = performance.now();
  for (const u of units) if (u?.text) ins.run(String(u.unit_id), u.page_index ?? 0, u.text);
  const indexMs = performance.now() - t0;
  const all = units.map((u) => u.text || '').join('\n');
  const allSoft = soft(all);

  let phraseOk = 0, andOk = 0;
  let crossLineOk = 0, crossLineN = 0;
  let crossColOk = 0, crossColN = 0;
  let crossPageOk = 0, crossPageN = 0;
  let blockTop1 = 0, blockTop3 = 0, blockRankN = 0;
  const perQuery = [];

  for (const p of phrases) {
    const pq = escapeFts(p.q);
    let rows = [];
    const tq0 = performance.now();
    try {
      rows = db.prepare('SELECT unit_id, page_index, text, rank FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 5').all(pq);
    } catch {
      try {
        rows = db.prepare('SELECT unit_id, page_index, text, 0 as rank FROM fts WHERE text LIKE ? LIMIT 5').all('%' + p.q + '%');
      } catch { rows = []; }
    }
    const qMs = performance.now() - tq0;
    const hit = rows.length > 0;
    if (hit) phraseOk++;
    if (p.cross_line) { crossLineN++; if (hit) crossLineOk++; }
    if (p.cross_col) { crossColN++; if (hit) crossColOk++; }
    if (p.cross_page) { crossPageN++; if (hit) crossPageOk++; }

    // AND recall
    let andHit = false;
    if (p.kind === 'cjk' || /[\u3400-\u9fff]/.test(p.q)) {
      const toks = [];
      for (let i = 0; i + 1 < p.q.length && toks.length < 4; i++) {
        const bi = p.q.slice(i, i + 2);
        if (/[\u3400-\u9fff]/.test(bi)) toks.push(escapeFts(bi));
      }
      const q = toks.slice(0, 3).join(' AND ');
      if (q) {
        try { andHit = !!db.prepare('SELECT 1 FROM fts WHERE fts MATCH ? LIMIT 1').get(q); }
        catch { andHit = allSoft.includes(soft(p.q)); }
      } else {
        andHit = hit;
      }
    } else {
      const toks = p.q.split(/\s+/).filter(Boolean).slice(0, 5)
        .map((t) => escapeFts(t)).join(' AND ');
      try { andHit = !!db.prepare('SELECT 1 FROM fts WHERE fts MATCH ? LIMIT 1').get(toks); }
      catch { andHit = hit; }
    }
    if (andHit) andOk++;

    // block ranking vs source paragraph
    if (hit && sourceParas?.length) {
      const qSoft = soft(p.q);
      const paras = sourceParas.filter((para) => soft(para).includes(qSoft));
      if (paras.length) {
        const target = soft(paras[0]);
        blockRankN++;
        const scoreUnit = (txt) => {
          const s = soft(txt);
          if (!s.includes(qSoft)) return -1;
          let hitc = 0;
          const step = 8;
          for (let i = 0; i + step <= target.length; i += step) {
            if (s.includes(target.slice(i, i + step))) hitc++;
          }
          return hitc;
        };
        const ranked = rows.map((r) => ({ ...r, ov: scoreUnit(r.text) }));
        if (ranked[0]?.ov > 0) blockTop1++;
        if (ranked.some((r) => r.ov > 0)) blockTop3++;
      }
    }
    perQuery.push({ q: p.q.slice(0, 60), hit, andHit, cross_line: !!p.cross_line, cross_col: !!p.cross_col, qMs: +qMs.toFixed(3) });
  }

  // furniture false hits: GT furniture strings present in indexed text
  let furnHits = 0;
  const furnHitList = [];
  for (const f of furnitureList || []) {
    if (!f || soft(f).length < 6) continue;
    if (all.includes(f) || allSoft.includes(soft(f))) {
      furnHits++;
      furnHitList.push(f.slice(0, 80));
    }
  }

  // reading-order adjacency
  let adjOk = 0, adjN = 0;
  for (const pair of adjacencyPairs || []) {
    const a = soft(pair.a).slice(0, 48);
    const b = soft(pair.b).slice(0, 48);
    if (a.length < 12 || b.length < 12) continue;
    adjN++;
    const ia = allSoft.indexOf(a);
    const ib = allSoft.indexOf(b);
    if (ia >= 0 && ib >= 0 && ia < ib) adjOk++;
  }

  db.close();
  let indexBytes = 0;
  try { indexBytes = fs.statSync(tmpDb).size; fs.unlinkSync(tmpDb); } catch {}

  const n = phrases.length || 1;
  return {
    label,
    units: units.length,
    chars: all.length,
    indexMs: +indexMs.toFixed(2),
    indexBytes,
    phraseRecall: phrases.length ? +(phraseOk / phrases.length).toFixed(4) : null,
    andRecall: phrases.length ? +(andOk / phrases.length).toFixed(4) : null,
    phraseOk, phraseN: phrases.length,
    andOk,
    crossLineRecall: crossLineN ? +(crossLineOk / crossLineN).toFixed(4) : null,
    crossLineOk, crossLineN,
    crossColRecall: crossColN ? +(crossColOk / crossColN).toFixed(4) : null,
    crossColOk, crossColN,
    crossPageRecall: crossPageN ? +(crossPageOk / crossPageN).toFixed(4) : null,
    crossPageOk, crossPageN,
    furnitureFalseHits: furnHits,
    furnitureFalseHitsPer100q: +(furnHits / n * 100).toFixed(2),
    furnitureHitList: furnHitList,
    hyphenArtifacts: hyphenArtifacts(all),
    readingOrderAdj: adjN ? +(adjOk / adjN).toFixed(4) : null,
    readingOrderAdjOk: adjOk, readingOrderAdjN: adjN,
    blockTop1: blockRankN ? +(blockTop1 / blockRankN).toFixed(4) : null,
    blockTop3: blockRankN ? +(blockTop3 / blockRankN).toFixed(4) : null,
    blockRankN,
    meanQueryMs: perQuery.length
      ? +(perQuery.reduce((s, r) => s + r.qMs, 0) / perQuery.length).toFixed(3) : null,
  };
}

function bootstrapCI(values, nBoot = 2000, alpha = 0.05) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const boots = [];
  for (let i = 0; i < nBoot; i++) {
    let s = 0;
    for (let j = 0; j < values.length; j++) {
      s += values[Math.floor(Math.random() * values.length)];
    }
    boots.push(s / values.length);
  }
  boots.sort((a, b) => a - b);
  const lo = boots[Math.floor(nBoot * (alpha / 2))];
  const hi = boots[Math.floor(nBoot * (1 - alpha / 2))];
  return { mean: +mean.toFixed(4), lo: +lo.toFixed(4), hi: +hi.toFixed(4), n: values.length };
}

function pairedSignTest(a, b) {
  // Wilcoxon-ish sign test on paired per-doc differences; return two-sided p approx via binomial
  let pos = 0, neg = 0, ties = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    if (Math.abs(d) < 1e-9) ties++;
    else if (d > 0) pos++;
    else neg++;
  }
  const n = pos + neg;
  if (n === 0) return { pos, neg, ties, p: 1, meanDiff: 0 };
  // exact binomial two-sided
  const k = Math.min(pos, neg);
  let cdf = 0;
  const half = 0.5 ** n;
  for (let i = 0; i <= k; i++) {
    // C(n,i)
    let c = 1;
    for (let j = 0; j < i; j++) c = c * (n - j) / (j + 1);
    cdf += c * half;
  }
  const p = Math.min(1, 2 * cdf);
  const meanDiff = a.reduce((s, v, i) => s + (v - b[i]), 0) / a.length;
  return { pos, neg, ties, p: +p.toFixed(4), meanDiff: +meanDiff.toFixed(4), n };
}

function e2eMs(ex, method) {
  if (method === 'A' || method === 'B') return ex.A?.abMs || ex.abMs || null;
  if (method.startsWith('C')) return ex.C?.ms || null;
  if (method.startsWith('D')) return (ex.D?.inferMs || 0) + (ex.A?.abMs || 0);
  return null;
}

const docIds = Object.keys(GT.docs).filter((id) => fs.existsSync(path.join(EXTRACT, `${id}.json`)));
console.error(`Evaluating ${docIds.length} docs with fixed tokenizer ${EXT}`);

const perDoc = [];
for (const id of docIds) {
  const gt = GT.docs[id];
  const ex = JSON.parse(fs.readFileSync(path.join(EXTRACT, `${id}.json`), 'utf8'));
  const phrases = gt.queries || [];
  const furn = gt.furniture || [];
  const adj = gt.adjacency_pairs || [];
  const paras = gt.paragraphs || [];
  const metrics = {};
  for (const m of METHODS) {
    const units = unitsFor(ex, m);
    if (!units.length) {
      metrics[m] = { label: m, error: 'no-units' };
      continue;
    }
    try {
      const r = indexAndProbe(units, phrases, `${id}_${m}`, furn, adj, paras);
      r.e2eExtractMs = e2eMs(ex, m);
      // Prefer extract-recorded abMs from top-level if present
      if ((m === 'A' || m === 'B') && ex.A) {
        // ab time not stored on A; approximate from extract file if we add later
      }
      metrics[m] = r;
    } catch (e) {
      metrics[m] = { label: m, error: String(e.message || e) };
    }
  }
  const row = {
    id,
    layout: gt.layout,
    short_name: gt.short_name,
    alignment_coverage: gt.alignment_coverage,
    nQueries: phrases.length,
    nCrossLine: gt.n_cross_line_queries || phrases.filter((q) => q.cross_line).length,
    nCrossCol: gt.n_cross_col_queries || phrases.filter((q) => q.cross_col).length,
    nFurniture: furn.length,
    metrics,
  };
  perDoc.push(row);
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(row, null, 2));
  console.error(`  ${id} (${gt.layout}) phrase A=${metrics.A?.phraseRecall} B=${metrics.B?.phraseRecall} C=${metrics['C-block']?.phraseRecall} D=${metrics['D-block']?.phraseRecall}`);
}

function subsetAvg(docs, keys = METHODS) {
  const avg = {};
  for (const k of keys) {
    const rows = docs.map((d) => d.metrics[k]).filter((m) => m && m.phraseRecall != null);
    if (!rows.length) continue;
    const vals = (field) => rows.map((r) => r[field]).filter((v) => v != null && !Number.isNaN(v));
    avg[k] = {
      nDocs: rows.length,
      phraseRecall: bootstrapCI(vals('phraseRecall')),
      andRecall: bootstrapCI(vals('andRecall')),
      crossLineRecall: bootstrapCI(vals('crossLineRecall')),
      crossColRecall: bootstrapCI(vals('crossColRecall')),
      furnitureFalseHitsPer100q: bootstrapCI(vals('furnitureFalseHitsPer100q')),
      readingOrderAdj: bootstrapCI(vals('readingOrderAdj')),
      blockTop1: bootstrapCI(vals('blockTop1')),
      blockTop3: bootstrapCI(vals('blockTop3')),
      indexBytes: Math.round(vals('indexBytes').reduce((a, b) => a + b, 0) / Math.max(1, vals('indexBytes').length)),
      indexMs: +(vals('indexMs').reduce((a, b) => a + b, 0) / Math.max(1, vals('indexMs').length)).toFixed(2),
      meanChars: Math.round(vals('chars').reduce((a, b) => a + b, 0) / Math.max(1, vals('chars').length)),
      meanUnits: +(vals('units').reduce((a, b) => a + b, 0) / Math.max(1, vals('units').length)).toFixed(1),
    };
  }
  return avg;
}

const allOk = perDoc.filter((d) => d.metrics);
const twoCol = allOk.filter((d) => d.layout === '2col');
const oneCol = allOk.filter((d) => d.layout === '1col');

const paired = {};
const primary = ['A', 'B', 'C-block', 'D-block'];
for (let i = 0; i < primary.length; i++) {
  for (let j = i + 1; j < primary.length; j++) {
    const a = primary[i], b = primary[j];
    const pairs = allOk.filter((d) => d.metrics[a]?.phraseRecall != null && d.metrics[b]?.phraseRecall != null);
    const va = pairs.map((d) => d.metrics[a].phraseRecall);
    const vb = pairs.map((d) => d.metrics[b].phraseRecall);
    paired[`${a}_vs_${b}`] = {
      phrase: pairedSignTest(va, vb),
      crossLine: pairedSignTest(
        pairs.map((d) => d.metrics[a].crossLineRecall ?? d.metrics[a].phraseRecall),
        pairs.map((d) => d.metrics[b].crossLineRecall ?? d.metrics[b].phraseRecall),
      ),
      furniture: pairedSignTest(
        pairs.map((d) => d.metrics[a].furnitureFalseHitsPer100q ?? 0),
        pairs.map((d) => d.metrics[b].furnitureFalseHitsPer100q ?? 0),
      ),
    };
  }
}

const aggregate = {
  version: 'v3',
  tokenizer: EXT,
  methodology: GT.meta,
  nDocs: allOk.length,
  nTwoCol: twoCol.length,
  nOneCol: oneCol.length,
  totalQueries: allOk.reduce((s, d) => s + d.nQueries, 0),
  meanAlignCoverage: +(allOk.reduce((s, d) => s + (d.alignment_coverage || 0), 0) / Math.max(1, allOk.length)).toFixed(4),
  avg_all: subsetAvg(allOk),
  avg_2col: subsetAvg(twoCol),
  avg_1col: subsetAvg(oneCol),
  paired_significance: paired,
  perDoc: allOk.map((d) => ({
    id: d.id, layout: d.layout, short_name: d.short_name,
    alignment_coverage: d.alignment_coverage, nQueries: d.nQueries,
    phrase: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.phraseRecall])),
    and: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.andRecall])),
    crossLine: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.crossLineRecall])),
    crossCol: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.crossColRecall])),
    furniturePer100: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.furnitureFalseHitsPer100q])),
    readingOrderAdj: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.readingOrderAdj])),
    blockTop1: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.blockTop1])),
    indexBytes: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.indexBytes])),
    units: Object.fromEntries(METHODS.map((k) => [k, d.metrics[k]?.units])),
  })),
};

fs.writeFileSync(path.join(OUT, 'AGGREGATE_V3.json'), JSON.stringify(aggregate, null, 2));
console.log(JSON.stringify({
  nDocs: aggregate.nDocs,
  avg_phrase: Object.fromEntries(primary.map((k) => [k, aggregate.avg_all[k]?.phraseRecall])),
  avg_crossLine: Object.fromEntries(primary.map((k) => [k, aggregate.avg_all[k]?.crossLineRecall])),
  avg_furniture: Object.fromEntries(primary.map((k) => [k, aggregate.avg_all[k]?.furnitureFalseHitsPer100q])),
  paired: Object.fromEntries(Object.entries(paired).map(([k, v]) => [k, v.phrase])),
}, null, 2));
