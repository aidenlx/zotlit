/**
 * Extract A/B/C/D for corpus-v3. C and D inference via Rust static ort napi.
 * Usage: NODE_PATH=BENCH_ROOT/node_modules node24 extract_v3.mjs [docId...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import canvasPkg from 'canvas';
import { patchContext } from 'BENCH_ROOT/layout-compare/scripts/canvas-fix.mjs';
import { createNativeOrtEngine, makeNativeONNXRun } from './native_onnx_bridge.mjs';

const { createCanvas, Image, DOMMatrix, ImageData, Path2D } = canvasPkg;
Object.assign(globalThis, { Image, DOMMatrix, ImageData, Path2D });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PDF_DIR = path.join(ROOT, 'pdfs-cap');
const OUT = path.join(ROOT, 'extract');
const PAGES = path.join(ROOT, 'pages');
const GT = JSON.parse(fs.readFileSync(path.join(ROOT, 'gt/SOURCE_GT_V3.json'), 'utf8'));
const WORKER = process.env.ZOTLIT_PDF_WORKER || 'PDF_WORKER_ROOT';
const require = createRequire('BENCH_ROOT/package.json');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PAGES, { recursive: true });

const LABELS_S = [
  'paragraph_title','image','text','number','abstract','content','figure_title',
  'formula','table','table_title','reference','doc_title','footnote','header',
  'algorithm','footer','seal','chart_title','chart','formula_number',
  'header_image','footer_image','aside_text',
];
const EXCLUDE = new Set(['header','footer','number','header_image','footer_image','seal','aside_text']);

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

async function extractAB(pdfPath, renderDir, targetW = 480) {
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
  const num = doc.numPages;
  const unitsA = [], unitsB = [], pagesRaw = [];
  const furniture = new Set();
  fs.mkdirSync(renderDir, { recursive: true });
  const rgbaPages = [];

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

    // render for D
    const scale = targetW / vp.width;
    const v2 = page.getViewport({ scale });
    const canvasFactory = new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(v2.width, v2.height);
    await page.render({ canvasContext: context, viewport: v2, canvas }).promise;
    const png = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(renderDir, `page-${String(i).padStart(3, '0')}.png`), png);
    const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
    rgbaPages.push({
      page_index: i - 1,
      width: canvas.width,
      height: canvas.height,
      rgba: Buffer.from(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
      width_pt: vp.width,
      height_pt: vp.height,
    });
    canvasFactory.destroy({ canvas, context });
    page.cleanup();
  }
  await doc.destroy();
  return {
    A: { units: unitsA, ms: performance.now() - t0, numPages: num, extractor: 'A-pdfjs' },
    B: { units: unitsB, ms: performance.now() - t0, numPages: num, extractor: 'B-heuristic', furnitureKeys: [...furniture] },
    pagesRaw, rgbaPages, numPages: num, abMs: performance.now() - t0,
  };
}

function parseDoclayoutBoxes(flat, shape, origW, origH, size = 480, thr = 0.4) {
  // shape typically [N, 6] = cls, score, x1,y1,x2,y2 in model input coords
  const cols = shape.length >= 2 ? shape[shape.length - 1] : 6;
  const n = Math.floor(flat.length / cols);
  const sx = origW / size, sy = origH / size;
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const o = i * cols;
    const cls = flat[o], score = flat[o + 1], x1 = flat[o + 2], y1 = flat[o + 3], x2 = flat[o + 4], y2 = flat[o + 5];
    if (score < thr) continue;
    const cid = Math.round(cls);
    const label = LABELS_S[cid] || `cls${cid}`;
    boxes.push({ label, score, cls: cid, bbox: [x1 * sx, y1 * sy, x2 * sx, y2 * sy] });
  }
  // NMS per class
  const by = {};
  for (const b of boxes) (by[b.label] ||= []).push(b);
  const kept = [];
  for (const bs of Object.values(by)) {
    bs.sort((a, b) => b.score - a.score);
    const take = [];
    for (const b of bs) {
      const ok = take.every((t) => {
        const ax1 = Math.max(b.bbox[0], t.bbox[0]), ay1 = Math.max(b.bbox[1], t.bbox[1]);
        const ax2 = Math.min(b.bbox[2], t.bbox[2]), ay2 = Math.min(b.bbox[3], t.bbox[3]);
        const inter = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
        const areaB = Math.max(0, b.bbox[2] - b.bbox[0]) * Math.max(0, b.bbox[3] - b.bbox[1]);
        const areaT = Math.max(0, t.bbox[2] - t.bbox[0]) * Math.max(0, t.bbox[3] - t.bbox[1]);
        return inter / (areaB + areaT - inter + 1e-6) <= 0.5;
      });
      if (ok) take.push(b);
    }
    kept.push(...take);
  }
  return kept;
}

function readingOrder(boxes) {
  if (!boxes.length) return { ordered: [], twoCol: false };
  const mids = boxes.map((b) => (b.bbox[0] + b.bbox[2]) / 2).sort((a, b) => a - b);
  let gap = 0, gapAt = null;
  for (let i = 1; i < mids.length; i++) {
    const g = mids[i] - mids[i - 1];
    if (g > gap) { gap = g; gapAt = (mids[i - 1] + mids[i]) / 2; }
  }
  const xs = boxes.flatMap((b) => [b.bbox[0], b.bbox[2]]);
  const pageW = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const twoCol = pageW > 50 && gap > pageW * 0.12 && boxes.length >= 4;
  const key = (b) => [b.bbox[1], b.bbox[0]];
  if (twoCol && gapAt != null) {
    const left = boxes.filter((b) => (b.bbox[0] + b.bbox[2]) / 2 < gapAt).sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    const right = boxes.filter((b) => (b.bbox[0] + b.bbox[2]) / 2 >= gapAt).sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
    return { ordered: left.concat(right), twoCol: true };
  }
  return { ordered: [...boxes].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]), twoCol: false };
}

function extractD(pagesRaw, rgbaPages, eng) {
  const t0 = performance.now();
  const layoutPages = [];
  let inferMs = 0;
  for (const rp of rgbaPages) {
    const r = eng.runDoclayoutRgba(rp.rgba, rp.width, rp.height, 480);
    inferMs += r.inferMs;
    const flat = Array.from(r.boxes);
    const shape = r.shape;
    const boxes = parseDoclayoutBoxes(flat, shape, rp.width, rp.height, 480, 0.35);
    const body = boxes.filter((b) => !EXCLUDE.has(b.label));
    const { ordered, twoCol } = readingOrder(body.filter((b) => b.label === 'text' || b.label === 'paragraph_title' || b.label === 'doc_title' || b.label === 'abstract' || b.label === 'content' || !EXCLUDE.has(b.label)));
    // Prefer text-like for body reading; keep all non-excluded
    const bodyOrdered = readingOrder(body).ordered;
    layoutPages.push({
      page_index: rp.page_index,
      render_w: rp.width,
      render_h: rp.height,
      boxes,
      body_boxes: bodyOrdered,
      two_col: twoCol,
      n_excluded: boxes.length - body.length,
      inferMs: r.inferMs,
    });
  }
  // assign text
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
    const pageParts = [];
    for (const box of lay.body_boxes) {
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
    units.push({
      unit_id: `d${pg.page_index}`, page_index: pg.page_index,
      text: norm(pageParts.join('\n')), kind: 'page', twoCol: !!lay.two_col,
      nBoxes: lay.body_boxes.length, nExcluded: lay.n_excluded || 0,
    });
  }
  return {
    units, blockUnits, layoutPages,
    ms: performance.now() - t0, inferMs,
    numPages: pagesRaw.length, extractor: 'D-pp-doclayout-s-napi',
  };
}

function extractCViaChild(pdfPath) {
  return new Promise((resolve, reject) => {
    const node = process.execPath;
    const setup = path.join(WORKER, 'scripts/pdfjs-setup.js');
    const child = path.join(__dirname, 'sdt-napi-child.mjs');
    const env = { ...process.env, NODE_PATH: 'BENCH_ROOT/node_modules', ZOTLIT_PDF_WORKER: WORKER };
    const ps = spawn(node, ['--import', setup, child, pdfPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ps.stdout.on('data', d => { out += d; });
    ps.stderr.on('data', d => { err += d; process.stderr.write(d); });
    ps.on('close', code => {
      if (code !== 0) return reject(new Error(`C child exit ${code}: ${err.slice(-800)}`));
      try {
        const j = JSON.parse(out);
        const byPage = new Map();
        for (const u of j.units || []) {
          if (!byPage.has(u.page_index)) byPage.set(u.page_index, []);
          byPage.get(u.page_index).push(u.text);
        }
        const pageUnits = [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([pi, ts]) => ({
          unit_id: `cp${pi}`, page_index: pi, text: norm(ts.join('\n')), kind: 'page',
        }));
        resolve({
          units: pageUnits, blockUnits: j.units || [],
          ms: j.ms, numPages: j.numPages,
          meta: j.meta || {}, extractor: 'C-sdt-napi',
        });
      } catch (e) {
        reject(new Error(`C parse fail: ${e.message}; out=${out.slice(0, 200)}`));
      }
    });
  });
}

const ids = process.argv.slice(2);
const all = ids.length ? ids : Object.keys(GT.docs);
// One Ort Environment per process for DocLayout-S (D). C runs in its own child process.
const SHARED_ENG = createNativeOrtEngine(1);

async function runDocShared(id) {
  const gt = GT.docs[id];
  if (!gt) throw new Error('no gt ' + id);
  const outPath = path.join(OUT, `${id}.json`);
  if (fs.existsSync(outPath) && !process.env.FORCE) {
    console.error(`skip ${id} (exists)`);
    return JSON.parse(fs.readFileSync(outPath, 'utf8'));
  }
  const pdfPath = path.join(PDF_DIR, `${id}.pdf`);
  if (!fs.existsSync(pdfPath)) throw new Error('missing pdf ' + pdfPath);
  console.error(`\n=== EXTRACT ${id} ===`);
  const renderDir = path.join(PAGES, id);
  const ab = await extractAB(pdfPath, renderDir);
  console.error(`A/B pages=${ab.numPages} ms=${ab.abMs.toFixed(0)}`);
  const D = extractD(ab.pagesRaw, ab.rgbaPages, SHARED_ENG);
  console.error(`D blocks=${D.blockUnits.length} inferMs=${D.inferMs.toFixed(0)}`);
  const C = await extractCViaChild(pdfPath);
  console.error(`C blocks=${C.blockUnits.length} pages=${C.units.length} ms=${C.ms.toFixed(0)}`);
  const result = {
    id, layout: gt.layout, short_name: gt.short_name,
    numPages: ab.numPages, A: ab.A, B: ab.B, C, D,
    extractedAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, JSON.stringify(result));
  console.error(`wrote ${outPath}`);
  return result;
}

for (const id of all) {
  try {
    await runDocShared(id);
  } catch (e) {
    console.error(`FAIL ${id}:`, e.stack || e);
    fs.writeFileSync(path.join(OUT, `${id}.error.txt`), String(e.stack || e));
  }
}
