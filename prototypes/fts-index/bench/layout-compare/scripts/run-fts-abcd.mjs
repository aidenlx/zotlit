/**
 * FTS quality: A pdf.js | B heuristic 2col | C SDT body (page-joined) | D PP-DocLayout body
 * Reuses same corpus/tokenizer as fts-exp. Phrases sampled intra-block from SDT.
 * Usage: ZOTLIT_PDF_WORKER=PDF_WORKER_ROOT npx -y node@24 run-fts-abcd.mjs
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
const OUT = path.join(ROOT, 'out');
const PAGES_ROOT = path.join(ROOT, 'pages');
const WORKER = process.env.ZOTLIT_PDF_WORKER || 'PDF_WORKER_ROOT';
const EXT = fs.existsSync('BENCH_ROOT/zotlit-fts-addon/dist/zotlit_cjk_icu.so')
  ? 'BENCH_ROOT/zotlit-fts-addon/dist/zotlit_cjk_icu.so'
  : 'PROTOTYPE_ROOT/dist/zotlit_cjk_icu.so';
const require = createRequire('BENCH_ROOT/package.json');
fs.mkdirSync(OUT, { recursive: true });

const CORPUS = [
  { id: 'sample-cjk', file: 'sample-cjk.pdf', maxPages: 0, lang: 'cjk' },
  { id: 'progit-en', file: 'progit-en-5p.pdf', maxPages: 0, lang: 'en' },
  { id: 'progit-zh', file: 'progit-zh-5p.pdf', maxPages: 0, lang: 'zh' },
  { id: 'arxiv-attention', file: 'arxiv-1706.03762.pdf', maxPages: 8, lang: 'en' },
  { id: 'arxiv-lora', file: 'arxiv-2106.09685.pdf', maxPages: 8, lang: 'en' },
  { id: 'frai-xai', file: 'frai-xai.pdf', maxPages: 8, lang: 'en' },
  { id: 'plos-meta', file: 'plos-meta.pdf', maxPages: 6, lang: 'en' },
  { id: 'stroke-2col', file: 'stroke-2col.pdf', maxPages: 0, lang: 'en' },
];
const ACADEMIC = new Set(['arxiv-attention','arxiv-lora','frai-xai','plos-meta','stroke-2col']);

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

async function extractAB(pdfPath, maxPages = 0, doRender = false, renderDir = null, targetW = 480) {
  const t0 = performance.now();
  const { mod, root } = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await mod.getDocument({
    data, verbosity: 0,
    CanvasFactory: NodeCanvasFactory,
    isOffscreenCanvasSupported: false,
  disableFontFace: false,
  useSystemFonts: true,
    isEvalSupported: false,
    cMapUrl: pathToFileURL(path.join(root, 'cmaps')).href + '/',
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(path.join(root, 'standard_fonts')).href + '/',
  }).promise;
  const num = maxPages > 0 ? Math.min(maxPages, doc.numPages) : doc.numPages;
  const pagesRaw = [];
  const unitsA = [];
  const renderTimings = [];
  if (doRender && renderDir) fs.mkdirSync(renderDir, { recursive: true });

  for (let i = 0; i < num; i++) {
    const page = await doc.getPage(i + 1);
    const tText0 = performance.now();
    const tc = await page.getTextContent({ includeMarkedContent: false });
    const textMs = performance.now() - tText0;
    const vp1 = page.getViewport({ scale: 1 });
    let text = '';
    const items = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      items.push({ str: it.str, x: tr[4], y: tr[5], w: it.width || 0, h: Math.abs(tr[3] || tr[0] || 12), hasEOL: !!it.hasEOL });
      text = text ? joinSoft(text, it.str) : it.str;
      if (it.hasEOL) text += '\n';
    }
    text = norm(text);
    unitsA.push({ unit_id: `a${i}`, page_index: i, text, kind: 'page' });
    const pageRec = { page_index: i, items, text, width_pt: vp1.width, height_pt: vp1.height };

    let renderMs = 0, copyMs = 0;
    if (doRender && renderDir) {
      const scale = targetW / vp1.width;
      const viewport = page.getViewport({ scale });
      const factory = doc.canvasFactory;
      const canvasAndContext = factory.create(viewport.width, viewport.height);
      const { canvas, context: ctx } = canvasAndContext;
      const tR0 = performance.now();
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      renderMs = performance.now() - tR0;
      const tC0 = performance.now();
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const rgba = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
      copyMs = performance.now() - tC0;
      const pngName = `page-${String(i + 1).padStart(3, '0')}.png`;
      fs.writeFileSync(path.join(renderDir, pngName), canvas.toBuffer('image/png'));
      fs.writeFileSync(path.join(renderDir, pngName.replace('.png', '.rgba')), rgba);
      Object.assign(pageRec, { render_w: canvas.width, render_h: canvas.height, scale, png: pngName, rgbaBytes: rgba.length });
      factory.destroy(canvasAndContext);
    }
    pagesRaw.push(pageRec);
    renderTimings.push({ page: i, textMs, renderMs, copyMs });
    page.cleanup();
  }

  if (doRender && renderDir) {
    fs.writeFileSync(path.join(renderDir, 'pages.json'), JSON.stringify(pagesRaw.map(({ items, text, ...meta }) => ({ ...meta, items }))));
  }

  // B heuristic
  const topCounts = new Map(), botCounts = new Map(), pageLines = [];
  for (const pg of pagesRaw) {
    const items = pg.items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = []; let cur = null;
    for (const it of items) {
      if (!cur || Math.abs(cur.y - it.y) > Math.max(it.h, cur.h) * 0.45) {
        cur = { y: it.y, h: it.h, parts: [] }; lines.push(cur);
      }
      cur.parts.push(it); cur.h = Math.max(cur.h, it.h); cur.y = (cur.y + it.y) / 2;
    }
    const lined = lines.map((l) => {
      l.parts.sort((a, b) => a.x - b.x);
      const t = norm(l.parts.map((p) => p.str).join(''));
      const x0 = Math.min(...l.parts.map((p) => p.x));
      const x1 = Math.max(...l.parts.map((p) => p.x + p.w));
      return { text: t, y: l.y, h: l.h, x0, x1, mid: (x0 + x1) / 2 };
    }).filter((l) => l.text);
    pageLines.push({ page_index: pg.page_index, lines: lined });
    if (lined.length >= 3) {
      const top = lined[0].text.replace(/\d+/g, '#').slice(0, 80);
      const bot = lined[lined.length - 1].text.replace(/\d+/g, '#').slice(0, 80);
      topCounts.set(top, (topCounts.get(top) || 0) + 1);
      botCounts.set(bot, (botCounts.get(bot) || 0) + 1);
    }
  }
  const n = pagesRaw.length;
  const furniture = new Set();
  for (const [k, c] of topCounts) if (c >= Math.max(2, Math.ceil(n * 0.4)) && k.length >= 3) furniture.add(k);
  for (const [k, c] of botCounts) if (c >= Math.max(2, Math.ceil(n * 0.4)) && k.length >= 3) furniture.add(k);
  const unitsB = [];
  for (const pg of pageLines) {
    let lines = pg.lines.filter((l) => {
      const key = l.text.replace(/\d+/g, '#').slice(0, 80);
      if (furniture.has(key)) return false;
      if (/^\d{1,4}$/.test(l.text.trim()) || /^page\s*\d+/i.test(l.text.trim())) return false;
      return true;
    });
    const mids = lines.map((l) => l.mid).sort((a, b) => a - b);
    let gap = 0, gapAt = -1;
    for (let i = 1; i < mids.length; i++) {
      const g = mids[i] - mids[i - 1];
      if (g > gap) { gap = g; gapAt = (mids[i - 1] + mids[i]) / 2; }
    }
    const xs = lines.flatMap((l) => [l.x0, l.x1]);
    const pageW = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    const twoCol = pageW > 200 && gap > pageW * 0.12 && mids.length >= 6;
    let ordered = twoCol
      ? [...lines.filter((l) => l.mid < gapAt).sort((a, b) => b.y - a.y), ...lines.filter((l) => l.mid >= gapAt).sort((a, b) => b.y - a.y)]
      : lines.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    let text = '';
    for (const l of ordered) text = text ? joinSoft(text, l.text) : l.text;
    unitsB.push({ unit_id: `b${pg.page_index}`, page_index: pg.page_index, text: norm(text), kind: 'page', twoCol });
  }

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
  // page-join for fair phrase recall
  const byPage = new Map();
  for (const u of result.units) {
    if (!byPage.has(u.page_index)) byPage.set(u.page_index, []);
    byPage.get(u.page_index).push(u.text);
  }
  const pageUnits = [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([pi, ts]) => ({
    unit_id: `c${pi}`, page_index: pi, text: norm(ts.join('\n')), kind: 'page',
  }));
  return {
    units: pageUnits,
    blockUnits: result.units,
    ms: performance.now() - t0,
    numPages: result.numPages,
    meta: result.meta,
    extractor: 'C-sdt-body-page',
  };
}

function assignTextToBoxes(pagesRaw, layoutPages) {
  // PDF.js: origin bottom-left, y up. Rendered image: origin top-left, y down.
  const units = [];
  const blockUnits = [];
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
      const [x1, y1, x2, y2] = box.bbox; // image coords
      // convert item to image coords
      const hit = [];
      for (const it of pg.items) {
        const ix = it.x * sx;
        const iy = (pg.height_pt - it.y) * sy; // flip y
        const cx = ix + (it.w * sx) / 2;
        const cy = iy - (it.h * sy) / 2;
        if (cx >= x1 - 2 && cx <= x2 + 2 && cy >= y1 - 2 && cy <= y2 + 2) hit.push(it);
      }
      // reading order inside box: top-to-bottom then left (in pdf y-up => sort by -y, x)
      hit.sort((a, b) => b.y - a.y || a.x - b.x);
      let text = '';
      for (const it of hit) text = text ? joinSoft(text, it.str) : it.str;
      text = norm(text.replace(/([A-Za-z]{2,})-\n([a-z]{2,})/g, '$1$2'));
      if (!text) continue;
      pageParts.push(text);
      blockUnits.push({
        unit_id: `db${bid++}`, page_index: pg.page_index, text,
        kind: 'block', label: box.label, score: box.score,
      });
    }
    units.push({
      unit_id: `d${pg.page_index}`, page_index: pg.page_index,
      text: norm(pageParts.join('\n')), kind: 'page',
      twoCol: !!lay.two_col, nBoxes: body.length, nExcluded: lay.n_excluded || 0,
    });
  }
  return { units, blockUnits };
}

function runLayoutDetect(pagesDir) {
  const py = 'POCR_VENV/bin/python';
  const script = path.join(__dirname, 'pp_layout_paddle.py');
  return new Promise((resolve, reject) => {
    const p = spawn(py, [script, pagesDir, '--model', 'PP-DocLayout-S', '--thr', '0.3'], {
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) {
        // fallback ONNX detect
        const script2 = path.join(__dirname, 'pp_layout_detect.py');
        const p2 = spawn(py, [script2, pagesDir, '--threads', '4', '--thr', '0.25'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out2='', err2='';
        p2.stdout.on('data', d => out2 += d);
        p2.stderr.on('data', d => err2 += d);
        p2.on('close', code2 => {
          if (code2 !== 0) reject(new Error(`layout fail paddle:${err.slice(-600)} onnx:${err2.slice(-600)}`));
          else {
            const data = JSON.parse(fs.readFileSync(path.join(pagesDir, 'layout-boxes.json'), 'utf8'));
            resolve({ summary: data.summary, pages: data.pages, stdout: out2, backend: 'onnx-fallback' });
          }
        });
        return;
      }
      const boxesPath = path.join(pagesDir, 'layout-boxes-paddle.json');
      const data = JSON.parse(fs.readFileSync(boxesPath, 'utf8'));
      // also copy for consumers
      fs.writeFileSync(path.join(pagesDir, 'layout-boxes.json'), JSON.stringify(data));
      resolve({ summary: data.summary, pages: data.pages, stdout: out, backend: 'paddle' });
    });
  });
}

function sampleIntra(units, n = 80) {
  const out = [], seen = new Set();
  for (const u of units) {
    const words = u.text.replace(/[\n\r]+/g, ' ').split(/\s+/)
      .map((w) => w.replace(/^[^A-Za-z0-9\u3400-\u9fff]+|[^A-Za-z0-9\u3400-\u9fff]+$/g, ''))
      .filter((w) => w.length >= 2);
    for (let len = 3; len <= 5; len++) {
      for (let i = 0; i + len <= words.length; i += 3) {
        const q = words.slice(i, i + len).join(' ');
        if (q.length < 10 || seen.has(q.toLowerCase())) continue;
        seen.add(q.toLowerCase()); out.push({ q, kind: 'en', page: u.page_index, unit_id: u.unit_id });
        if (out.length >= n) return out;
      }
    }
    for (const m of u.text.matchAll(/[\u3400-\u9fff]{5,20}/g)) {
      const run = m[0];
      for (let len = 4; len <= 7; len++) {
        for (let i = 0; i + len <= run.length; i += 2) {
          const q = run.slice(i, i + len);
          if (seen.has(q)) continue; seen.add(q); out.push({ q, kind: 'cjk', page: u.page_index, unit_id: u.unit_id });
          if (out.length >= n) return out;
        }
      }
    }
  }
  return out;
}

function hyphenArtifacts(text) {
  return (String(text).match(/[A-Za-z]{3,}-\s+[a-z]{2,}/g) || []).length;
}

function indexAndProbe(units, phrases, label) {
  const tmpDb = path.join(OUT, `_tmp_${label.replace(/[^A-Za-z0-9]/g,'_')}_${Date.now()}.sqlite`);
  try { fs.unlinkSync(tmpDb); } catch {}
  const db = new DatabaseSync(tmpDb, { allowExtension: true });
  db.loadExtension(EXT);
  db.exec(`CREATE VIRTUAL TABLE fts USING fts5(unit_id, page_index UNINDEXED, text, tokenize='zotlit_cjk')`);
  const ins = db.prepare('INSERT INTO fts VALUES (?,?,?)');
  const t0 = performance.now();
  for (const u of units) if (u.text) ins.run(u.unit_id, u.page_index, u.text);
  const indexMs = performance.now() - t0;
  let phraseOk = 0, andOk = 0, top1 = 0, top3 = 0, rankN = 0, blockTop1 = 0, blockTop3 = 0, blockRankN = 0;
  for (const p of phrases) {
    const pq = '"' + p.q.replace(/"/g, '') + '"';
    let rows = [];
    try { rows = db.prepare('SELECT unit_id, page_index, rank FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 5').all(pq); }
    catch {
      rows = db.prepare('SELECT unit_id, page_index, 0 as rank FROM fts WHERE text LIKE ? LIMIT 5').all('%' + p.q + '%');
    }
    if (rows.length) {
      phraseOk++;
      rankN++;
      if (rows[0].page_index === p.page) top1++;
      if (rows.some((r) => r.page_index === p.page)) top3++;
      if (p.unit_id) {
        blockRankN++;
        if (rows[0].unit_id === p.unit_id) blockTop1++;
        if (rows.some((r) => r.unit_id === p.unit_id)) blockTop3++;
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
  const furnPatterns = ['arXiv:', 'doi.org', 'Frontiers in Artificial Intelligence', 'PLOS ONE', 'https://j-stroke.org', 'page label:'];
  const all = units.map((u) => u.text).join('\n');
  let furn = 0;
  for (const f of furnPatterns) if (all.includes(f)) furn++;
  const hy = hyphenArtifacts(all);
  db.close();
  let indexBytes = 0;
  try { indexBytes = fs.statSync(tmpDb).size; fs.unlinkSync(tmpDb); } catch {}
  return {
    label, units: units.length, chars: all.length, indexMs: +indexMs.toFixed(2),
    indexBytes,
    phraseRecall: phrases.length ? +(phraseOk / phrases.length).toFixed(4) : null,
    andRecall: phrases.length ? +(andOk / phrases.length).toFixed(4) : null,
    phraseOk, phraseN: phrases.length,
    furniturePatternHits: furn, hyphenArtifacts: hy,
    pageTop1: rankN ? +(top1 / rankN).toFixed(4) : null,
    pageTop3: rankN ? +(top3 / rankN).toFixed(4) : null,
    rankN,
    blockTop1: blockRankN ? +(blockTop1 / blockRankN).toFixed(4) : null,
    blockTop3: blockRankN ? +(blockTop3 / blockRankN).toFixed(4) : null,
    blockRankN,
  };
}


async function runDoc(doc) {
  console.error(`\n=== ${doc.id} ===`);
  const pdfPath = path.join(PDF_DIR, doc.file);
  const renderDir = path.join(PAGES_ROOT, doc.id);
  const ab = await extractAB(pdfPath, doc.maxPages, true, renderDir, 480);
  console.error(`A/B text+render pages=${ab.numPages}`);

  const C = await extractC(pdfPath, doc.maxPages);
  console.error(`C blocks=${C.blockUnits.length} pages=${C.units.length} ${C.ms.toFixed(0)}ms`);

  let D = null, layoutSummary = null;
  try {
    const lay = await runLayoutDetect(renderDir);
    layoutSummary = lay.summary;
    const assigned = assignTextToBoxes(ab.pagesRaw, lay.pages);
    const renderMsSum = ab.renderTimings.reduce((s, t) => s + t.renderMs, 0);
    D = {
      units: assigned.units,
      blockUnits: assigned.blockUnits,
      ms: ab.A.ms + (layoutSummary?.mean_ms || 0) * ab.numPages, // approx
      numPages: ab.numPages,
      extractor: 'D-pp-doclayout-S',
      layoutSummary,
      renderMsMedian: median(ab.renderTimings.map((t) => t.renderMs)),
    };
    console.error(`D boxes pages ok; body units=${D.units.length} blocks=${D.blockUnits.length}`);
  } catch (e) {
    console.error('D FAIL', e.message?.slice(0, 300));
    D = { error: String(e.message || e) };
  }

  const phrases = sampleIntra(C.blockUnits.length ? C.blockUnits : C.units, 80);
  const mA = indexAndProbe(ab.A.units, phrases, 'A');
  const mB = indexAndProbe(ab.B.units, phrases, 'B');
  const mC = indexAndProbe(C.units, phrases, 'C-page');
  const mCb = indexAndProbe(C.blockUnits, phrases, 'C-block');
  const mD = D.units ? indexAndProbe(D.units, phrases, 'D-page') : { label: 'D-page', error: D.error };
  const mDb = D.blockUnits ? indexAndProbe(D.blockUnits, phrases, 'D-block') : null;

  const summary = {
    id: doc.id, file: doc.file, pages: ab.numPages, academic: ACADEMIC.has(doc.id),
    furniture: ab.B.furnitureKeys,
    render: {
      backend: 'node-canvas',
      targetW: 480,
      medianRenderMs: median(ab.renderTimings.map((t) => t.renderMs)),
      medianTextMs: median(ab.renderTimings.map((t) => t.textMs)),
      medianCopyMs: median(ab.renderTimings.map((t) => t.copyMs)),
    },
    extractMs: { A: Math.round(ab.A.ms), B: Math.round(ab.B.ms), C: Math.round(C.ms) },
    msPerPage: {
      A: +(ab.A.ms / ab.numPages).toFixed(1),
      B: +(ab.B.ms / ab.numPages).toFixed(1),
      C: +(C.ms / ab.numPages).toFixed(1),
      render: ab.renderTimings.length ? +median(ab.renderTimings.map((t) => t.renderMs)).toFixed(1) : null,
    },
    layoutSummary,
    sdtMeta: C.meta,
    metrics: { A: mA, B: mB, 'C-page': mC, 'C-block': mCb, 'D-page': mD, 'D-block': mDb },
    samplePhrases: phrases.slice(0, 10),
  };
  fs.writeFileSync(path.join(OUT, `${doc.id}.json`), JSON.stringify(summary, null, 2));
  return summary;
}

function median(a) {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[b.length >> 1];
}

if (!process.argv.includes('--fair-rank')) {
const all = [];
for (const doc of CORPUS) {
  try { all.push(await runDoc(doc)); }
  catch (e) {
    console.error('FAIL', doc.id, e);
    all.push({ id: doc.id, error: String(e.message || e) });
  }
}
fs.writeFileSync(path.join(OUT, 'AGGREGATE.json'), JSON.stringify(all, null, 2));

// academic averages
const acad = all.filter((d) => d.academic && d.metrics);
const keys = ['A', 'B', 'C-page', 'D-page'];
const avg = {};
for (const k of keys) {
  const rows = acad.map((d) => d.metrics[k]).filter((m) => m && m.phraseRecall != null);
  if (!rows.length) continue;
  avg[k] = {
    phraseRecall: +(rows.reduce((s, r) => s + r.phraseRecall, 0) / rows.length).toFixed(4),
    andRecall: +(rows.reduce((s, r) => s + r.andRecall, 0) / rows.length).toFixed(4),
    hyphenArtifacts: +(rows.reduce((s, r) => s + r.hyphenArtifacts, 0) / rows.length).toFixed(1),
    furniturePatternHits: +(rows.reduce((s, r) => s + r.furniturePatternHits, 0) / rows.length).toFixed(1),
    chars: rows.reduce((s, r) => s + r.chars, 0),
    pageTop1: +(rows.reduce((s, r) => s + (r.pageTop1 || 0), 0) / rows.length).toFixed(4),
    indexBytes: Math.round(rows.reduce((s, r) => s + (r.indexBytes || 0), 0) / rows.length),
    nDocs: rows.length,
  };
}
fs.writeFileSync(path.join(OUT, 'ACADEMIC_AVG.json'), JSON.stringify(avg, null, 2));
console.log(JSON.stringify({ avg, n: all.length }, null, 2));

} // end main (!fair-rank)


/* ===== FAIR_RANK_PASS ===== */
if (process.argv.includes('--fair-rank')) {
  // Recompute with self-sampled phrases + kind split; reuse cached layout PNGs.
  async function fairDoc(doc) {
    const pdfPath = path.join(PDF_DIR, doc.file);
    const renderDir = path.join(PAGES_ROOT, doc.id);
    const abR = await extractAB(pdfPath, doc.maxPages, false, null, 480); // text+geometry; reuse cached layout
    const C = await extractC(pdfPath, doc.maxPages);
    const layPath = path.join(renderDir, 'layout-boxes-paddle.json');
    const lay = JSON.parse(fs.readFileSync(layPath, 'utf8'));
    const assigned = assignTextToBoxes(abR.pagesRaw, lay.pages);
    const phrasesC = sampleIntra(C.blockUnits.length ? C.blockUnits : C.units, 80);
    const phrasesD = sampleIntra(assigned.blockUnits.length ? assigned.blockUnits : assigned.units, 80);
    function splitByKind(phrases) {
      return {
        en: phrases.filter((p) => p.kind === 'en'),
        cjk: phrases.filter((p) => p.kind === 'cjk'),
      };
    }
    const sc = splitByKind(phrasesC);
    const mCself = indexAndProbe(C.blockUnits, phrasesC, 'C-block-self');
    const mDself = indexAndProbe(assigned.blockUnits, phrasesD, 'D-block-self');
    const mCen = sc.en.length ? indexAndProbe(C.blockUnits, sc.en, 'C-en') : null;
    const mCcjk = sc.cjk.length ? indexAndProbe(C.blockUnits, sc.cjk, 'C-cjk') : null;
    const mAen = sc.en.length ? indexAndProbe(abR.A.units, sc.en, 'A-en') : null;
    const mAcjk = sc.cjk.length ? indexAndProbe(abR.A.units, sc.cjk, 'A-cjk') : null;
    const mDen = sc.en.length ? indexAndProbe(assigned.units, sc.en, 'D-en') : null;
    const mDcjk = sc.cjk.length ? indexAndProbe(assigned.units, sc.cjk, 'D-cjk') : null;
    // cross: C phrases on D (same as main) already known; self ranking is the gap-filler
    return {
      id: doc.id,
      academic: ACADEMIC.has(doc.id),
      nPhrasesC: phrasesC.length,
      nPhrasesD: phrasesD.length,
      nEn: sc.en.length,
      nCjk: sc.cjk.length,
      C_block_self: { phraseRecall: mCself.phraseRecall, andRecall: mCself.andRecall, blockTop1: mCself.blockTop1, blockTop3: mCself.blockTop3, pageTop1: mCself.pageTop1, blockRankN: mCself.blockRankN },
      D_block_self: { phraseRecall: mDself.phraseRecall, andRecall: mDself.andRecall, blockTop1: mDself.blockTop1, blockTop3: mDself.blockTop3, pageTop1: mDself.pageTop1, blockRankN: mDself.blockRankN },
      kindSplit_fromC: {
        A_en: mAen && { phraseRecall: mAen.phraseRecall, andRecall: mAen.andRecall, n: sc.en.length },
        A_cjk: mAcjk && { phraseRecall: mAcjk.phraseRecall, andRecall: mAcjk.andRecall, n: sc.cjk.length },
        C_en: mCen && { phraseRecall: mCen.phraseRecall, andRecall: mCen.andRecall, n: sc.en.length },
        C_cjk: mCcjk && { phraseRecall: mCcjk.phraseRecall, andRecall: mCcjk.andRecall, n: sc.cjk.length },
        D_en: mDen && { phraseRecall: mDen.phraseRecall, andRecall: mDen.andRecall, n: sc.en.length },
        D_cjk: mDcjk && { phraseRecall: mDcjk.phraseRecall, andRecall: mDcjk.andRecall, n: sc.cjk.length },
      },
    };
  }
  const fair = [];
  for (const doc of CORPUS) {
    try {
      console.error('fair', doc.id);
      fair.push(await fairDoc(doc));
    } catch (e) {
      console.error('fair FAIL', doc.id, e.message?.slice(0, 200));
      fair.push({ id: doc.id, error: String(e.message || e) });
    }
  }
  fs.writeFileSync(path.join(OUT, 'FAIR_RANK.json'), JSON.stringify(fair, null, 2));
  // averages
  const ok = fair.filter((d) => d.C_block_self);
  const acad = ok.filter((d) => d.academic);
  function avgKey(rows, pathArr) {
    const vals = rows.map((r) => {
      let x = r;
      for (const k of pathArr) x = x?.[k];
      return x;
    }).filter((v) => typeof v === 'number');
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4) : null;
  }
  const summary = {
    n: ok.length,
    nAcademic: acad.length,
    all: {
      C_blockTop1_self: avgKey(ok, ['C_block_self', 'blockTop1']),
      D_blockTop1_self: avgKey(ok, ['D_block_self', 'blockTop1']),
      C_phrase_self: avgKey(ok, ['C_block_self', 'phraseRecall']),
      D_phrase_self: avgKey(ok, ['D_block_self', 'phraseRecall']),
    },
    academic: {
      C_blockTop1_self: avgKey(acad, ['C_block_self', 'blockTop1']),
      D_blockTop1_self: avgKey(acad, ['D_block_self', 'blockTop1']),
      C_phrase_self: avgKey(acad, ['C_block_self', 'phraseRecall']),
      D_phrase_self: avgKey(acad, ['D_block_self', 'phraseRecall']),
    },
  };
  fs.writeFileSync(path.join(OUT, 'FAIR_RANK_AVG.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
