import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import canvasPkg from 'canvas';
const { createCanvas, Image, DOMMatrix, ImageData, Path2D } = canvasPkg;

// Disable Node's OffscreenCanvas so pdf.js uses our canvasFactory
const _OSC = globalThis.OffscreenCanvas;
delete globalThis.OffscreenCanvas;
if (typeof globalThis.createImageBitmap !== 'undefined') {
  // keep but we'll convert
}

globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
globalThis.Path2D = Path2D;
globalThis.Image = Image;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    const ctx = canvas.getContext('2d');
    const orig = ctx.drawImage.bind(ctx);
    ctx.drawImage = (img, ...args) => {
      if (img instanceof Image || (img?.constructor?.name === 'Canvas' && typeof img.getContext === 'function')) {
        return orig(img, ...args);
      }
      // OffscreenCanvas / foreign canvas: blit via PNG or ImageData
      try {
        if (typeof img?.transferToImageBitmap === 'function' || img?.constructor?.name === 'OffscreenCanvas' || img?.constructor?.name === 'CanvasElement') {
          const w = img.width|0, h = img.height|0;
          if (w && h) {
            let id;
            try {
              const ictx = img.getContext?.('2d');
              if (ictx?.getImageData) id = ictx.getImageData(0,0,w,h);
            } catch {}
            const c = createCanvas(w,h);
            if (id) c.getContext('2d').putImageData(id,0,0);
            else if (img.toBuffer) {
              const im = new Image();
              im.src = img.toBuffer('image/png');
              return orig(im, ...args);
            }
            return orig(c, ...args);
          }
        }
      } catch (e) { console.error('convert fail', e.message); }
      if (img?.data && img.width && img.height) {
        const c = createCanvas(img.width, img.height);
        c.getContext('2d').putImageData(
          img instanceof ImageData ? img : new ImageData(Uint8ClampedArray.from(img.data), img.width, img.height),
          0, 0
        );
        return orig(c, ...args);
      }
      console.error('drawImage unknown', img?.constructor?.name, img?.width, img?.height);
      return orig(img, ...args);
    };
    return { canvas, context: ctx };
  }
  reset(c,w,h){ c.canvas.width=Math.ceil(w); c.canvas.height=Math.ceil(h); }
  destroy(c){ c.canvas.width=0; c.canvas.height=0; c.canvas=null; c.context=null; }
}

const require = createRequire('BENCH_ROOT/package.json');
const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
const mod = await import(pathToFileURL(path.join(root, 'legacy/build/pdf.mjs')).href);
const pdf = 'BENCH_ROOT/zotero-model-history/fts-exp/pdfs/stroke-2col.pdf';
const data = new Uint8Array(fs.readFileSync(pdf));
const cf = new NodeCanvasFactory();
const doc = await mod.getDocument({ data, verbosity:0, canvasFactory: cf,
  cMapUrl: pathToFileURL(path.join(root,'cmaps')).href+'/', cMapPacked:true,
  standardFontDataUrl: pathToFileURL(path.join(root,'standard_fonts')).href+'/',
  isEvalSupported:false,
}).promise;
const page = await doc.getPage(1);
const vp1 = page.getViewport({scale:1});
const vp = page.getViewport({ scale: 480/vp1.width });
const {canvas, context} = cf.create(vp.width, vp.height);
await page.render({ canvasContext: context, viewport: vp, canvas, canvasFactory: cf }).promise;
console.log('OK', canvas.width, canvas.height);
fs.writeFileSync('BENCH_ROOT/layout-compare/pages/stroke-2col/page-001.png', canvas.toBuffer('image/png'));
console.log('wrote png');
