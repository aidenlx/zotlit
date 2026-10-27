import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createNativeOrtEngine, makeNativeONNXRun } from './native_onnx_bridge.mjs';

const workerRoot = process.env.ZOTLIT_PDF_WORKER || 'PDF_WORKER_ROOT';
const pdfPath = process.argv[2];
const maxPages = Number(process.argv[3] || 0);

function blockPlainText(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) return node.content.map(blockPlainText).join('');
  if (Array.isArray(node)) return node.map(blockPlainText).join('');
  return '';
}

const eng = createNativeOrtEngine(1);
const nativeONNXRun = makeNativeONNXRun(eng);

const { getStructure } = await import(pathToFileURL(path.join(workerRoot, 'src/pdf/index.js')).href);
let getBlockPlainText = blockPlainText;
try {
  ({ getBlockPlainText } = await import(pathToFileURL(path.join(workerRoot, 'structured-document-text/src/text.js')).href));
} catch {}

const data = new Uint8Array(fs.readFileSync(pdfPath));
const build = path.join(workerRoot, 'build');
const dp = async (p) => new Uint8Array(fs.readFileSync(path.join(build, p)));
const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const t0 = performance.now();
const structure = await getStructure(ab, '', dp, {
  sourceHash: crypto.createHash('md5').update(data).digest('hex'),
  nativeONNXRun,
});

const pagesMeta = structure.catalog?.pages || [];
const nPages = maxPages > 0 ? Math.min(maxPages, pagesMeta.length) : pagesMeta.length;
const units = [];
let droppedExcluded = 0, droppedAuxiliary = 0, droppedEmpty = 0, blockId = 0;
for (const block of structure.content || []) {
  const fc = block?.flowClass;
  if (fc === 'excluded') { droppedExcluded++; continue; }
  if (fc === 'auxiliary') { droppedAuxiliary++; continue; }
  const pr = block?.anchor?.pageRects;
  const rect = Array.isArray(pr) && pr.length ? pr[0] : null;
  const page_index = rect ? rect[0] : 0;
  if (page_index >= nPages) continue;
  let text = '';
  try { text = getBlockPlainText(block); } catch { text = blockPlainText(block); }
  text = String(text || '').normalize('NFC').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  text = text.replace(/([A-Za-z]{2,})-\n([a-z]{2,})/g, '$1$2');
  if (!text) { droppedEmpty++; continue; }
  units.push({
    unit_id: 'c' + (blockId++), page_index, text, kind: 'block',
    block_type: block.type || 'body', flowClass: fc || 'body',
  });
}

process.stdout.write(JSON.stringify({
  units, numPages: nPages, ms: performance.now() - t0,
  meta: {
    extractor: 'C-sdt-napi',
    numPages: pagesMeta.length, extractedPages: nPages, units: units.length,
    droppedExcluded, droppedAuxiliary, droppedEmpty,
    processor: structure.metadata?.processor || null,
  },
}));
