/**
 * PDF.js text-layer + page render via node-canvas (CanvasFactory class API).
 * Usage: node render-pdfjs.mjs <pdf> <outDir> [maxPages] [renderW]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import canvasPkg from 'canvas';
import { patchContext } from './canvas-fix.mjs';

const { createCanvas, Image, DOMMatrix, ImageData, Path2D } = canvasPkg;
const require = createRequire('BENCH_ROOT/package.json');
const [,, pdfPath, outDir, maxPagesS = '0', renderWS = '480'] = process.argv;
if (!pdfPath || !outDir) { console.error('usage: render-pdfjs.mjs pdf outDir [maxPages] [renderW]'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const maxPages = Number(maxPagesS) || 0;
const targetW = Number(renderWS) || 480;

globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;
globalThis.Image = Image;

/** Matches pdf.js BaseCanvasFactory; forces node-canvas instead of @napi-rs/canvas. */
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
    // Make drawImage accept node-canvas canvases only; convert unknowns via PNG
    const orig = context.drawImage.bind(context);
    context.drawImage = (img, ...args) => {
      try { return orig(img, ...args); }
      catch (e) {
        if (img && img.width && img.height && typeof img.toBuffer === 'function') {
          const im = new Image();
          im.src = img.toBuffer('image/png');
          return orig(im, ...args);
        }
        if (img?.data && img.width && img.height) {
          const c = createCanvas(img.width, img.height);
          c.getContext('2d').putImageData(
            img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
            0, 0
          );
          return orig(c, ...args);
        }
        throw e;
      }
    };
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
const mod = await import(pathToFileURL(path.join(root, 'legacy/build/pdf.mjs')).href);

const data = new Uint8Array(fs.readFileSync(pdfPath));
const tParse0 = performance.now();
const doc = await mod.getDocument({
  data, verbosity: 0,
  CanvasFactory: NodeCanvasFactory,
  cMapUrl: pathToFileURL(path.join(root, 'cmaps')).href + '/',
  cMapPacked: true,
  standardFontDataUrl: pathToFileURL(path.join(root, 'standard_fonts')).href + '/',
  isEvalSupported: false,
  isOffscreenCanvasSupported: false,
  disableFontFace: false,
  useSystemFonts: true,
}).promise;
const parseMs = performance.now() - tParse0;
const num = maxPages > 0 ? Math.min(maxPages, doc.numPages) : doc.numPages;

const pages = [];
const timings = [];
for (let i = 0; i < num; i++) {
  const page = await doc.getPage(i + 1);
  const tText0 = performance.now();
  const tc = await page.getTextContent({ includeMarkedContent: false });
  const textMs = performance.now() - tText0;
  const vp1 = page.getViewport({ scale: 1 });
  const items = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    items.push({
      str: it.str, x: tr[4], y: tr[5],
      w: it.width || 0, h: Math.abs(tr[3] || tr[0] || 12),
      hasEOL: !!it.hasEOL,
    });
  }

  const scale = targetW / vp1.width;
  const viewport = page.getViewport({ scale });
  // Use same factory instance as transport for temp canvases consistency
  const factory = doc.canvasFactory;
  const canvasAndContext = factory.create(viewport.width, viewport.height);
  const { canvas, context: ctx } = canvasAndContext;
  const tR0 = performance.now();
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const renderMs = performance.now() - tR0;

  const tCopy0 = performance.now();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  const copyMs = performance.now() - tCopy0;

  const pngPath = path.join(outDir, `page-${String(i + 1).padStart(3, '0')}.png`);
  const rgbaPath = path.join(outDir, `page-${String(i + 1).padStart(3, '0')}.rgba`);
  const tPng0 = performance.now();
  fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
  const pngMs = performance.now() - tPng0;
  fs.writeFileSync(rgbaPath, rgba);

  pages.push({
    page_index: i,
    width_pt: vp1.width, height_pt: vp1.height,
    render_w: canvas.width, render_h: canvas.height,
    scale, items, rgbaBytes: rgba.length, png: path.basename(pngPath),
  });
  timings.push({ page: i, textMs, renderMs, copyMs, pngMs, rgbaBytes: rgba.length });
  factory.destroy(canvasAndContext);
  page.cleanup();
}

function median(a) { const b = [...a].sort((x,y)=>x-y); return b[b.length >> 1]; }
const meta = {
  pdf: pdfPath, numPages: num, targetW, parseMs,
  canvasBackend: 'node-canvas',
  pdfjs: require('pdfjs-dist/package.json').version,
  timings,
  medianRenderMs: median(timings.map(t => t.renderMs)),
  medianTextMs: median(timings.map(t => t.textMs)),
  medianCopyMs: median(timings.map(t => t.copyMs)),
};
fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(pages));
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
