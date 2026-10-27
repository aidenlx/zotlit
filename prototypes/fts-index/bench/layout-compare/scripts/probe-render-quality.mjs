import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import canvasPkg from 'canvas';
import { patchContext } from './canvas-fix.mjs';
const { createCanvas, Image, DOMMatrix, ImageData, Path2D, registerFont } = canvasPkg;
Object.assign(globalThis, { Image, DOMMatrix, ImageData, Path2D });
class NodeCanvasFactory {
  #enableHWA=false;
  constructor({enableHWA=false}={}){this.#enableHWA=enableHWA;}
  _createCanvas(w,h){return createCanvas(Math.max(1,Math.ceil(w)),Math.max(1,Math.ceil(h)));}
  create(w,h){
    const canvas=this._createCanvas(w,h);
    const context=patchContext(canvas.getContext('2d',{willReadFrequently:!this.#enableHWA}));
    return {canvas, context};
  }
  reset(c,w,h){c.canvas.width=w;c.canvas.height=h;}
  destroy(c){c.canvas.width=0;c.canvas.height=0;c.canvas=null;c.context=null;}
}
const require=createRequire('BENCH_ROOT/package.json');
const root=path.dirname(require.resolve('pdfjs-dist/package.json'));
const mod=await import(pathToFileURL(path.join(root,'legacy/build/pdf.mjs')).href);
const pdf='BENCH_ROOT/zotero-model-history/fts-exp/pdfs/stroke-2col.pdf';
const data=new Uint8Array(fs.readFileSync(pdf));

async function tryOnce(label, opts){
  const doc=await mod.getDocument({
    data: data.slice(), verbosity:0,
    CanvasFactory: NodeCanvasFactory,
    cMapUrl: pathToFileURL(path.join(root,'cmaps')).href+'/',
    cMapPacked:true,
    standardFontDataUrl: pathToFileURL(path.join(root,'standard_fonts')).href+'/',
    ...opts,
  }).promise;
  const page=await doc.getPage(1);
  const vp1=page.getViewport({scale:1});
  const scale=480/vp1.width;
  const viewport=page.getViewport({scale});
  const {canvas,context}=doc.canvasFactory.create(viewport.width,viewport.height);
  await page.render({canvasContext:context, viewport, canvas}).promise;
  const img=context.getImageData(0,0,canvas.width,canvas.height);
  let dark=0;
  for(let i=0;i<img.data.length;i+=4){
    if(img.data[i]<250||img.data[i+1]<250||img.data[i+2]<250) dark++;
  }
  const frac=dark/(canvas.width*canvas.height);
  const out=`/tmp/probe-${label}.png`;
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(label, 'size', canvas.width, canvas.height, 'darkFrac', frac.toFixed(4), '->', out);
  await doc.destroy();
}

await tryOnce('default', {isOffscreenCanvasSupported:false});
await tryOnce('fontface', {isOffscreenCanvasSupported:false, disableFontFace:false, useSystemFonts:true});
await tryOnce('fontface-no-sys', {isOffscreenCanvasSupported:false, disableFontFace:false, useSystemFonts:false});
await tryOnce('no-patch', {isOffscreenCanvasSupported:false, disableFontFace:false});
