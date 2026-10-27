/**
 * Child entry for Zotero pdf-worker getStructure.
 * Must be launched with:
 *   node --import "$ZOTLIT_PDF_WORKER/scripts/pdfjs-setup.js" pipeline/sdt-child.mjs <pdf> [maxPages]
 *
 * Prints one JSON object to stdout (AGPL pdf-worker stays external).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { normalizePageText } from './normalize.mjs';
import { assignTitleLevels, sectionPathsFromHeadings, getSymbolAndLevel } from './title-level.mjs';

const workerRoot = process.env.ZOTLIT_PDF_WORKER;
const pdfPath = process.argv[2];
const maxPages = Number(process.argv[3] || 0);
if (!workerRoot || !pdfPath) {
  console.error('Usage: ZOTLIT_PDF_WORKER=... node --import $ZOTLIT_PDF_WORKER/scripts/pdfjs-setup.js pipeline/sdt-child.mjs <pdf>');
  process.exit(2);
}

function blockPlainText(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) return node.content.map(blockPlainText).join('');
  if (Array.isArray(node)) return node.map(blockPlainText).join('');
  return '';
}

const { getStructure } = await import(pathToFileURL(path.join(workerRoot, 'src/pdf/index.js')).href);
let getBlockPlainText = blockPlainText;
try {
  ({ getBlockPlainText } = await import(
    pathToFileURL(path.join(workerRoot, 'structured-document-text/src/text.js')).href
  ));
} catch { /* optional */ }

const data = new Uint8Array(fs.readFileSync(pdfPath));
const build = path.join(workerRoot, 'build');
const dp = async (p) => new Uint8Array(fs.readFileSync(path.join(build, p)));
const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const structure = await getStructure(ab, '', dp, {
  sourceHash: crypto.createHash('md5').update(data).digest('hex'),
});

const pagesMeta = structure.catalog?.pages || [];
const outline = structure.catalog?.outline || [];
const outlineByPage = new Map();
function walkOut(items, prefix = []) {
  for (const it of items || []) {
    const title = String(it.title || '').trim();
    const parts = title ? [...prefix, title] : prefix;
    const pi = it.target?.position?.pageIndex ?? it.location?.pageIndex;
    if (pi != null && parts.length) outlineByPage.set(pi, parts.join(' / '));
    if (it.items?.length) walkOut(it.items, parts);
    if (it.children?.length) walkOut(it.children, parts);
  }
}
walkOut(outline);

const units = [];
const headingEvents = [];
let blockId = 0;
const nPages = maxPages > 0 ? Math.min(maxPages, pagesMeta.length) : pagesMeta.length;

for (const block of structure.content || []) {
  if (block?.flowClass === 'auxiliary') continue;
  const pr = block?.anchor?.pageRects;
  const rect = Array.isArray(pr) && pr.length ? pr[0] : null;
  const page_index = rect ? rect[0] : 0;
  if (page_index >= nPages) continue;
  let text = '';
  try { text = getBlockPlainText(block); } catch { text = blockPlainText(block); }
  text = normalizePageText(text);
  if (!text) continue;
  const type = block.type || 'body';
  const maybeHeading =
    type === 'heading' || type === 'title' ||
    (text.length < 80 && getSymbolAndLevel(text).level > 0);
  if (maybeHeading) {
    const h = Math.abs((rect?.[4] ?? 0) - (rect?.[2] ?? 0));
    headingEvents.push({ page_index, title: text.split('\n')[0], height: h, text: text.split('\n')[0] });
  }
  units.push({
    unit_id: `b${blockId++}`,
    item_key: null,
    attachment_key: null,
    page_index,
    page_label: pagesMeta[page_index]?.label != null ? String(pagesMeta[page_index].label) : String(page_index + 1),
    section_path: outlineByPage.get(page_index) || '',
    block_type: type,
    page_rects: block.anchor?.pageRects || (rect ? [rect] : []),
    text,
  });
}

const leveled = assignTitleLevels(headingEvents.map((h) => ({ ...h })));
const voted = sectionPathsFromHeadings(
  leveled.map((h) => ({ page_index: h.page_index, title: h.title || h.text, title_level: h.title_level })),
);
let last = '';
const byPagePath = new Map();
for (let i = 0; i < nPages; i++) {
  if (outlineByPage.has(i)) last = outlineByPage.get(i);
  else if (voted.has(i)) last = voted.get(i);
  byPagePath.set(i, last);
}
for (const u of units) {
  if (!u.section_path) u.section_path = byPagePath.get(u.page_index) || '';
}

process.stdout.write(JSON.stringify({
  units,
  meta: {
    extractor: 'zotero-sdt',
    pdf: path.resolve(pdfPath),
    numPages: pagesMeta.length,
    units: units.length,
    outlineItems: outline.length,
    workerRoot,
  },
}));
