/**
 * FTS quality vs method-independent SOURCE ground truth (NOT sampled from C/SDT).
 * GT: gt/SOURCE_GT.json (arXiv LaTeX, Pro Git AsciiDoc, hand-label for authored demo).
 * Usage: ZOTLIT_PDF_WORKER=PDF_WORKER_ROOT node run-fts-source-gt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import canvasPkg from 'canvas';
import { patchContext } from './canvas-fix.mjs';

const { createCanvas, Image, DOMMatrix, ImageData, Path2D } = canvasPkg;
Object.assign(globalThis, { Image, DOMMatrix, ImageData, Path2D });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PDF_DIR = 'BENCH_ROOT/zotero-model-history/fts-exp/pdfs';
const OUT = path.join(ROOT, 'out-source-gt');
const PAGES_ROOT = path.join(ROOT, 'pages');
const WORKER = process.env.ZOTLIT_PDF_WORKER || 'PDF_WORKER_ROOT';
const EXT = fs.existsSync('BENCH_ROOT/zotlit-fts-addon/dist/zotlit_cjk_icu.so')
  ? 'BENCH_ROOT/zotlit-fts-addon/dist/zotlit_cjk_icu.so'
  : 'PROTOTYPE_ROOT/dist/zotlit_cjk_icu.so';
const require = createRequire('BENCH_ROOT/package.json');
const GT = JSON.parse(fs.readFileSync(path.join(ROOT, 'gt/SOURCE_GT.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const CORPUS = [
  { id: 'sample-cjk', file: 'sample-cjk.pdf', maxPages: 0 },
  { id: 'progit-en', file: 'progit-en-5p.pdf', maxPages: 0 },
  { id: 'progit-zh', file: 'progit-zh-5p.pdf', maxPages: 0 },
  { id: 'arxiv-attention', file: 'arxiv-1706.03762.pdf', maxPages: 8 },
  { id: 'arxiv-lora', file: 'arxiv-2106.09685.pdf', maxPages: 8 },
].filter((d) => GT.docs[d.id]);

function joinSoft(a, b) {
  if (!a) return b; if (!b) return a;
  const L = a.slice(-1), R = b[0];
  const cjk = (ch) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch);
  if (cjk(L) || cjk(R)) return a + b;
  if (L === '-' && /[a-z]/i.test(R)) return a.slice(0, -1) + b;
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
  if (/[A-Za-z0-9]$/.test(L) && /[A-Za-z0-9]/.test(R)) return a + ' ' + b;
  return a + b;
}
function norm(s) {
  return String(s || '').normalize('NFC').replace(/\u00ad/g, '')
    .replace(/[\u2010-\u2015]/g, '-').replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n').trim();
}
function median(a) {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[b.length >> 1];
}

class NodeCanvasFactory {
  #enableHWA = false;
  constructor({ enableHWA = false } = {}) { this.#enableHWA = enableHWA; }
  _createCanvas(width, height) {
    return createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
  }
  create(width, height) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = this._createCanvas(width, height);
    const context = patchContext(canvas.getContext('2d', { willReadFrequently: !this.#enableHWA }));
    const orig = context.drawImage.bind(context);
    context.drawImage = (img, ...args) => {
      try { return orig(img, ...args); }
      catch (e) {
        if (img && img.width && img.height && typeof img.toBuffer === 'function') {
          const im = new Image(); im.src = img.toBuffer('image/png'); return orig(im, ...args);
        }
        throw e;
      }
    };
    return { canvas, context };
  }
  reset(c, w, h) { c.canvas.width = w; c.canvas.height = h; }
  destroy(c) { c.canvas.width = 0; c.canvas.height = 0; c.canvas = null; c.context = null; }
}

async function loadPdfJs() {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const mod = await import(pathToFileURL(path.join(root, 'legacy/build/pdf.mjs')).href);
  return { mod, root };
}

async function extractAB(pdfPath, maxPages = 0, doRender = false, renderDir = null, targetW = 480) {
  const t0 = performance.now();
  const { mod, root } = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await mod.getDocument({
    data, verbosity: 0, CanvasFactory: NodeCanvasFactory,
    isOffscreenCanvasSupported: false, disableFontFace: false, useSystemFonts: true,
    isEvalSupported: false,
    cMapUrl: pathToFileURL(path.join(root, 'cmaps')).href + '/',
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(path.join(root, 'standard_fonts')).href + '/',
  }).promise;
  const num = maxPages > 0 ? Math.min(doc.numPages, maxPages) : doc.numPages;
  const unitsA = [], unitsB = [], pagesRaw = [], renderTimings = [];
  const furniture = new Set();
  if (doRender && renderDir) fs.mkdirSync(renderDir, { recursive: true });

  for (let i = 1; i <= num; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent({ includeMarkedContent: false });
    const items = [];
    let pageText = '';
    for (const it of tc.items) {
      if (!it.str) continue;
      const tr = it.transform;
      const x = tr[4], y = tr[5];
      const h = Math.hypot(tr[2], tr[3]) || it.height || 0;
      const w = Math.hypot(tr[0], tr[1]) || it.width || 0;
      items.push({ str: it.str, x, y, w, h });
      pageText = pageText ? joinSoft(pageText, it.str) : it.str;
    }
    pageText = norm(pageText);
    const vp = page.getViewport({ scale: 1 });
    pagesRaw.push({ page_index: i - 1, width_pt: vp.width, height_pt: vp.height, text: pageText, items });
    unitsA.push({ unit_id: `a${i - 1}`, page_index: i - 1, text: pageText, kind: 'page' });

    // B: line cluster + furniture strip + 2col heuristic
    const linesMap = new Map();
    for (const it of items) {
      const key = Math.round(it.y);
      if (!linesMap.has(key)) linesMap.set(key, []);
      linesMap.get(key).push(it);
    }
    let lines = [...linesMap.entries()].map(([y, its]) => {
      its.sort((a, b) => a.x - b.x);
      let text = '';
      for (const it of its) text = text ? joinSoft(text, it.str) : it.str;
      const x0 = Math.min(...its.map((t) => t.x));
      const x1 = Math.max(...its.map((t) => t.x + t.w));
      return { y, text: norm(text), x0, x1, mid: (x0 + x1) / 2 };
    }).filter((l) => l.text);

    // furniture: repeated short lines
    const counts = new Map();
    for (const l of lines) {
      const k = l.text.slice(0, 80);
      if (k.length < 60) counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const [k, c] of counts) if (c >= 2 && k.length < 50) furniture.add(k);
    lines = lines.filter((l) => !furniture.has(l.text.slice(0, 80)));

    const mids = lines.map((l) => l.mid).sort((a, b) => a - b);
    let gap = 0, gapAt = 0;
    for (let j = 1; j < mids.length; j++) {
      const g = mids[j] - mids[j - 1];
      if (g > gap) { gap = g; gapAt = (mids[j - 1] + mids[j]) / 2; }
    }
    const xs = lines.flatMap((l) => [l.x0, l.x1]);
    const pageW = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    const twoCol = pageW > 200 && gap > pageW * 0.12 && mids.length >= 6;
    const ordered = twoCol
      ? [...lines.filter((l) => l.mid < gapAt).sort((a, b) => b.y - a.y), ...lines.filter((l) => l.mid >= gapAt).sort((a, b) => b.y - a.y)]
      : lines.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    let textB = '';
    for (const l of ordered) textB = textB ? joinSoft(textB, l.text) : l.text;
    unitsB.push({ unit_id: `b${i - 1}`, page_index: i - 1, text: norm(textB), kind: 'page', twoCol });

    if (doRender && renderDir) {
      const tR = performance.now();
      const scale = targetW / vp.width;
      const v2 = page.getViewport({ scale });
      const canvasFactory = new NodeCanvasFactory();
      const { canvas, context } = canvasFactory.create(v2.width, v2.height);
      await page.render({ canvasContext: context, viewport: v2, canvas }).promise;
      const png = canvas.toBuffer('image/png');
      fs.writeFileSync(path.join(renderDir, `page-${String(i).padStart(3, '0')}.png`), png);
      renderTimings.push({ page: i - 1, renderMs: performance.now() - tR });
      canvasFactory.destroy({ canvas, context });
    }
    page.cleanup();
  }
  await doc.destroy();
  return {
    A: { units: unitsA, ms: performance.now() - t0, numPages: num, extractor: 'A-pdfjs' },
    B: { units: unitsB, ms: performance.now() - t0, numPages: num, extractor: 'B-heuristic', furnitureKeys: [...furniture] },
    pagesRaw, renderTimings, numPages: num,
  };
}

async function extractC(pdfPath, maxPages = 0) {
  const t0 = performance.now();
  const child = 'BENCH_ROOT/zotero-model-history/fts-exp/sdt-body-child.mjs';
  const setup = path.join(WORKER, 'scripts/pdfjs-setup.js');
  const args = ['--import', setup, child, path.resolve(pdfPath)];
  if (maxPages > 0) args.push(String(maxPages));
  const result = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, {
      env: { ...process.env, ZOTLIT_PDF_WORKER: WORKER },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`sdt ${code}: ${err.slice(-800)}`));
      else resolve(JSON.parse(out));
    });
  });
  const byPage = new Map();
  for (const u of result.units) {
    if (!byPage.has(u.page_index)) byPage.set(u.page_index, []);
    byPage.get(u.page_index).push(u.text);
  }
  const pageUnits = [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([pi, ts]) => ({
    unit_id: `c${pi}`, page_index: pi, text: norm(ts.join('\n')), kind: 'page',
  }));
  return { units: pageUnits, blockUnits: result.units, ms: performance.now() - t0, numPages: result.numPages, meta: result.meta, extractor: 'C-sdt-body-page' };
}

function assignTextToBoxes(pagesRaw, layoutPages) {
  const units = [], blockUnits = [];
  let bid = 0;
  for (const pg of pagesRaw) {
    const lay = layoutPages.find((p) => p.page_index === pg.page_index);
    if (!lay) {
      units.push({ unit_id: `d${pg.page_index}`, page_index: pg.page_index, text: pg.text, kind: 'page' });
      continue;
    }
    const sx = lay.render_w / pg.width_pt;
    const sy = lay.render_h / pg.height_pt;
    const body = lay.body_boxes || lay.boxes || [];
    const pageParts = [];
    for (const box of body) {
      const [x1, y1, x2, y2] = box.bbox;
      const hit = [];
      for (const it of pg.items) {
        const ix = it.x * sx;
        const iy = (pg.height_pt - it.y) * sy;
        const cx = ix + (it.w * sx) / 2;
        const cy = iy - (it.h * sy) / 2;
        if (cx >= x1 - 2 && cx <= x2 + 2 && cy >= y1 - 2 && cy <= y2 + 2) hit.push(it);
      }
      hit.sort((a, b) => b.y - a.y || a.x - b.x);
      let text = '';
      for (const it of hit) text = text ? joinSoft(text, it.str) : it.str;
      text = norm(text.replace(/([A-Za-z]{2,})-\n([a-z]{2,})/g, '$1$2'));
      if (!text) continue;
      pageParts.push(text);
      blockUnits.push({ unit_id: `db${bid++}`, page_index: pg.page_index, text, kind: 'block', label: box.label, score: box.score });
    }
    units.push({ unit_id: `d${pg.page_index}`, page_index: pg.page_index, text: norm(pageParts.join('\n')), kind: 'page', twoCol: !!lay.two_col, nBoxes: body.length, nExcluded: lay.n_excluded || 0 });
  }
  return { units, blockUnits };
}

function loadLayout(pagesDir) {
  for (const name of ['layout-boxes-paddle.json', 'layout-boxes.json']) {
    const p = path.join(pagesDir, name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

function hyphenArtifacts(text) {
  return (String(text).match(/[A-Za-z]{3,}-\s+[a-z]{2,}/g) || []).length;
}

/** Normalize for soft containment checks */
function soft(s) {
  return String(s || '').normalize('NFC').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function indexAndProbeSource(units, phrases, label, furnitureList, adjacencyPairs, sourceParas) {
  const tmpDb = path.join(OUT, `_tmp_${label.replace(/[^A-Za-z0-9]/g, '_')}_${Date.now()}.sqlite`);
  try { fs.unlinkSync(tmpDb); } catch {}
  const db = new DatabaseSync(tmpDb, { allowExtension: true });
  db.loadExtension(EXT);
  db.exec(`CREATE VIRTUAL TABLE fts USING fts5(unit_id, page_index UNINDEXED, text, tokenize='zotlit_cjk')`);
  const ins = db.prepare('INSERT INTO fts VALUES (?,?,?)');
  const t0 = performance.now();
  for (const u of units) if (u.text) ins.run(u.unit_id, u.page_index, u.text);
  const indexMs = performance.now() - t0;
  const all = units.map((u) => u.text).join('\n');
  const allSoft = soft(all);

  let phraseOk = 0, andOk = 0, top1 = 0, top3 = 0, rankN = 0;
  let blockTop1 = 0, blockTop3 = 0, blockRankN = 0;
  // block ranking vs source paragraph: for each body phrase, find GT paragraph containing it,
  // then check whether top FTS hit's unit text overlaps that paragraph most among blocks.
  for (const p of phrases) {
    const pq = '"' + p.q.replace(/"/g, '') + '"';
    let rows = [];
    try { rows = db.prepare('SELECT unit_id, page_index, text, rank FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 5').all(pq); }
    catch {
      try { rows = db.prepare('SELECT unit_id, page_index, text, 0 as rank FROM fts WHERE text LIKE ? LIMIT 5').all('%' + p.q + '%'); }
      catch { rows = []; }
    }
    if (rows.length) {
      phraseOk++;
      rankN++;
      // page ranking not GT-grounded (source has no page map) — still report for continuity
      top1 += 1; // if hit exists at all we count presence; pageTop replaced by block metrics
      top3 += 1;
      if (p.src === 'body' && sourceParas?.length && units.some((u) => u.kind === 'block' || units.length > 5)) {
        const qSoft = soft(p.q);
        const paras = sourceParas.filter((para) => soft(para).includes(qSoft));
        if (paras.length) {
          const target = soft(paras[0]);
          blockRankN++;
          const scoreUnit = (txt) => {
            const s = soft(txt);
            if (!s.includes(qSoft)) return -1;
            // overlap proxy: shared length / target
            let hit = 0;
            const step = 8;
            for (let i = 0; i + step <= target.length; i += step) {
              if (s.includes(target.slice(i, i + step))) hit++;
            }
            return hit;
          };
          const ranked = rows.map((r) => ({ ...r, ov: scoreUnit(r.text) }));
          if (ranked[0]?.ov > 0) blockTop1++;
          if (ranked.some((r) => r.ov > 0)) blockTop3++;
        }
      }
    }
    if (p.kind === 'cjk') {
      const toks = [];
      for (let i = 0; i + 1 < p.q.length; i++) toks.push('"' + p.q.slice(i, i + 2) + '"');
      const q = toks.slice(0, 3).join(' AND ');
      try { if (db.prepare('SELECT 1 FROM fts WHERE fts MATCH ? LIMIT 1').get(q)) andOk++; }
      catch { if (db.prepare('SELECT 1 FROM fts WHERE text LIKE ? LIMIT 1').get('%' + p.q + '%')) andOk++; }
    } else {
      const toks = p.q.split(/\s+/).map((t) => '"' + t.replace(/"/g, '') + '"').join(' AND ');
      try { if (db.prepare('SELECT 1 FROM fts WHERE fts MATCH ? LIMIT 1').get(toks)) andOk++; } catch {}
    }
  }

  // furniture false hits: GT furniture strings present in indexed text
  let furnHits = 0;
  const furnHitList = [];
  for (const f of furnitureList || []) {
    if (!f) continue;
    if (all.includes(f) || allSoft.includes(soft(f))) {
      furnHits++;
      furnHitList.push(f);
    }
  }

  // reading-order: adjacent source sentence pair both present and in order (a before b)
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

  return {
    label,
    units: units.length,
    chars: all.length,
    indexMs: +indexMs.toFixed(2),
    indexBytes,
    phraseRecall: phrases.length ? +(phraseOk / phrases.length).toFixed(4) : null,
    andRecall: phrases.length ? +(andOk / phrases.length).toFixed(4) : null,
    phraseOk, phraseN: phrases.length,
    furnitureFalseHits: furnHits,
    furnitureHitList: furnHitList,
    hyphenArtifacts: hyphenArtifacts(all),
    readingOrderAdj: adjN ? +(adjOk / adjN).toFixed(4) : null,
    readingOrderAdjOk: adjOk,
    readingOrderAdjN: adjN,
    // pageTop* not source-grounded; keep hit-rate as presenceTop for continuity
    presenceTop1: rankN ? +(top1 / rankN).toFixed(4) : null,
    rankN,
    blockOverlapTop1: blockRankN ? +(blockTop1 / blockRankN).toFixed(4) : null,
    blockOverlapTop3: blockRankN ? +(blockTop3 / blockRankN).toFixed(4) : null,
    blockRankN,
  };
}

async function runDoc(doc) {
  console.error(`\n=== SOURCE-GT ${doc.id} ===`);
  const gt = GT.docs[doc.id];
  const pdfPath = path.join(PDF_DIR, doc.file);
  const renderDir = path.join(PAGES_ROOT, doc.id);
  const needRender = !fs.existsSync(path.join(renderDir, 'page-001.png'));
  const ab = await extractAB(pdfPath, doc.maxPages, needRender, renderDir, 480);
  console.error(`A/B pages=${ab.numPages}`);

  const C = await extractC(pdfPath, doc.maxPages);
  console.error(`C blocks=${C.blockUnits.length}`);

  let D = { units: null, blockUnits: null };
  const lay = loadLayout(renderDir);
  if (lay?.pages) {
    const assigned = assignTextToBoxes(ab.pagesRaw, lay.pages);
    D = { units: assigned.units, blockUnits: assigned.blockUnits };
    console.error(`D blocks=${D.blockUnits.length}`);
  } else {
    console.error('D SKIP no layout cache');
  }

  const phrases = gt.queries;
  const furn = gt.furniture || [];
  const adj = gt.adjacency_pairs || [];
  const paras = gt.paragraphs || [];

  const mA = indexAndProbeSource(ab.A.units, phrases, 'A', furn, adj, paras);
  const mB = indexAndProbeSource(ab.B.units, phrases, 'B', furn, adj, paras);
  const mC = indexAndProbeSource(C.units, phrases, 'C-page', furn, adj, paras);
  const mCb = indexAndProbeSource(C.blockUnits, phrases, 'C-block', furn, adj, paras);
  const mD = D.units ? indexAndProbeSource(D.units, phrases, 'D-page', furn, adj, paras) : { label: 'D-page', error: 'no-layout' };
  const mDb = D.blockUnits ? indexAndProbeSource(D.blockUnits, phrases, 'D-block', furn, adj, paras) : null;

  const summary = {
    id: doc.id,
    source_kind: gt.source_kind,
    note: gt.note || null,
    pages: ab.numPages,
    nQueries: phrases.length,
    nFurniture: furn.length,
    nAdjacency: adj.length,
    methodology: 'queries from SOURCE_GT (authoring text), not from C blocks',
    metrics: { A: mA, B: mB, 'C-page': mC, 'C-block': mCb, 'D-page': mD, 'D-block': mDb },
    sampleQueries: phrases.slice(0, 8),
  };
  fs.writeFileSync(path.join(OUT, `${doc.id}.json`), JSON.stringify(summary, null, 2));
  return summary;
}

const all = [];
for (const doc of CORPUS) {
  try { all.push(await runDoc(doc)); }
  catch (e) {
    console.error('FAIL', doc.id, e);
    all.push({ id: doc.id, error: String(e.message || e) });
  }
}
fs.writeFileSync(path.join(OUT, 'AGGREGATE.json'), JSON.stringify(all, null, 2));

const keys = ['A', 'B', 'C-page', 'C-block', 'D-page', 'D-block'];
const ok = all.filter((d) => d.metrics);
const avg = {};
for (const k of keys) {
  const rows = ok.map((d) => d.metrics[k]).filter((m) => m && m.phraseRecall != null);
  if (!rows.length) continue;
  avg[k] = {
    nDocs: rows.length,
    phraseRecall: +(rows.reduce((s, r) => s + r.phraseRecall, 0) / rows.length).toFixed(4),
    andRecall: +(rows.reduce((s, r) => s + r.andRecall, 0) / rows.length).toFixed(4),
    furnitureFalseHits: +(rows.reduce((s, r) => s + (r.furnitureFalseHits || 0), 0) / rows.length).toFixed(2),
    readingOrderAdj: +(rows.filter((r) => r.readingOrderAdj != null).reduce((s, r) => s + r.readingOrderAdj, 0) / Math.max(1, rows.filter((r) => r.readingOrderAdj != null).length)).toFixed(4),
    hyphenArtifacts: +(rows.reduce((s, r) => s + r.hyphenArtifacts, 0) / rows.length).toFixed(1),
    blockOverlapTop1: (() => {
      const rr = rows.filter((r) => r.blockOverlapTop1 != null);
      return rr.length ? +(rr.reduce((s, r) => s + r.blockOverlapTop1, 0) / rr.length).toFixed(4) : null;
    })(),
    chars: Math.round(rows.reduce((s, r) => s + r.chars, 0) / rows.length),
  };
}
const payload = {
  methodology: GT.meta.methodology,
  dropped_no_source: GT.meta.dropped_no_source,
  primary_docs: ok.map((d) => d.id),
  avg,
  perDoc: ok.map((d) => ({
    id: d.id,
    source_kind: d.source_kind,
    phrase: Object.fromEntries(keys.map((k) => [k, d.metrics[k]?.phraseRecall])),
    and: Object.fromEntries(keys.map((k) => [k, d.metrics[k]?.andRecall])),
    furnitureFalseHits: Object.fromEntries(keys.map((k) => [k, d.metrics[k]?.furnitureFalseHits])),
    readingOrderAdj: Object.fromEntries(keys.map((k) => [k, d.metrics[k]?.readingOrderAdj])),
    blockOverlapTop1: Object.fromEntries(keys.map((k) => [k, d.metrics[k]?.blockOverlapTop1])),
  })),
};
fs.writeFileSync(path.join(OUT, 'SOURCE_GT_AVG.json'), JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 2));
