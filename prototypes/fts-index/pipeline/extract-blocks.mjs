/**
 * PDF → indexable units (prefer block/paragraph, else page).
 *
 * Primary path (when ZOTLIT_PDF_WORKER points at zotero/pdf-worker or
 * document-worker build): Structured Document Text (SDT) from
 * `getStructure` — ONNX block-seg (`structure/model/block-seg`), reading
 * order / flowClass, page labels, outline, and `anchor.pageRects` in the
 * same coordinate space as Zotero annotation positions.
 *
 * Fallback: pdf.js per-page text (stable page_index) + heuristic headings
 * via title-level.mjs when outline is thin.
 *
 * Optional OCR: set ZOTLIT_OCR_HOOK=1 to call `ocr-hook.mjs` for pages with
 * almost no extractable text (paddleocr-js PP-OCRv6 — not required to run).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizePageText, joinFragments } from './normalize.mjs';
import { assignTitleLevels, sectionPathsFromHeadings, getSymbolAndLevel } from './title-level.mjs';

const require = createRequire(import.meta.url);



async function loadPdfJs() {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const mod = await import(pathToFileURL(path.join(root, 'legacy/build/pdf.mjs')).href);
  return { mod, root };
}

async function extractViaSdt(pdfPath, workerRoot, { maxPages = 0 } = {}) {
  const setup = path.join(workerRoot, 'scripts/pdfjs-setup.js');
  const childScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sdt-child.mjs');
  if (!fs.existsSync(setup)) {
    throw new Error(`pdf-worker setup missing: ${setup}`);
  }
  const args = ['--import', setup, childScript, path.resolve(pdfPath)];
  if (maxPages > 0) args.push(String(maxPages));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ZOTLIT_PDF_WORKER: workerRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`sdt-child exit ${code}: ${err.slice(-800)}`));
      else {
        try { resolve(JSON.parse(out)); }
        catch (e) { reject(new Error(`sdt-child bad JSON: ${e.message}\n${out.slice(0, 400)}\n${err.slice(-400)}`)); }
      }
    });
  });
  return result;
}

async function extractViaPdfJs(pdfPath, { maxPages = 0 } = {}) {
  const { mod, root } = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await mod.getDocument({
    data,
    verbosity: 0,
    cMapUrl: pathToFileURL(path.join(root, 'cmaps')).href + '/',
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(path.join(root, 'standard_fonts')).href + '/',
  }).promise;
  const num = maxPages > 0 ? Math.min(maxPages, doc.numPages) : doc.numPages;
  const labels = await doc.getPageLabels().catch(() => null);
  const outline = await doc.getOutline().catch(() => null);
  const outlineByPage = new Map();

  async function resolveDest(dest) {
    try {
      let d = dest;
      if (typeof d === 'string') d = await doc.getDestination(d);
      if (!Array.isArray(d) || !d[0]) return null;
      return await doc.getPageIndex(d[0]);
    } catch { return null; }
  }
  async function walk(items, prefix = []) {
    for (const it of items || []) {
      const title = String(it.title || '').trim();
      const parts = title ? [...prefix, title] : prefix;
      const pi = await resolveDest(it.dest);
      if (pi != null && parts.length) outlineByPage.set(pi, parts.join(' / '));
      if (it.items?.length) await walk(it.items, parts);
    }
  }
  await walk(outline);

  const units = [];
  const headingEvents = [];
  for (let i = 0; i < num; i++) {
    const page = await doc.getPage(i + 1);
    const tc = await page.getTextContent();
    // Group into rough lines by Y, then paragraphs — lightweight reading-order proxy
    const lines = [];
    let cur = null;
    for (const it of tc.items) {
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4];
      const y = tr[5];
      const h = Math.abs(tr[3] || tr[0] || 12);
      if (!cur || Math.abs(cur.y - y) > h * 0.4) {
        cur = { y, h, parts: [], x0: x, x1: x };
        lines.push(cur);
      }
      cur.parts.push(it.str);
      cur.x1 = x + (it.width || 0);
      cur.h = Math.max(cur.h, h);
      if (it.hasEOL) cur = null;
    }
    const lineTexts = lines.map((l) => ({
      text: l.parts.join(''),
      height: l.h,
      rect: [i, l.x0, l.y, l.x1, l.y + l.h],
    }));

    // Detect short heading-like lines
    for (const lt of lineTexts) {
      const t = lt.text.trim();
      if (!t) continue;
      if (t.length < 60 && (getSymbolAndLevel(t).level > 0 || outlineByPage.has(i))) {
        headingEvents.push({ page_index: i, title: t, text: t, height: lt.height });
      }
    }

    // Join lines with CJK/Latin rules into one page unit (fallback granularity)
    let pageText = '';
    for (const lt of lineTexts) {
      const t = lt.text;
      if (!t) continue;
      pageText = pageText ? joinFragments(pageText, t) : t;
      // keep soft paragraph breaks when large vertical gaps — approximated by empty parts
    }
    pageText = normalizePageText(pageText);

    // Optional OCR hook for near-empty pages
    if ((!pageText || pageText.length < 8) && process.env.ZOTLIT_OCR_HOOK === '1') {
      try {
        const { ocrPage } = await import('./ocr-hook.mjs');
        const ocr = await ocrPage(pdfPath, i);
        if (ocr?.text) pageText = normalizePageText(ocr.text);
      } catch (e) {
        /* hook optional */
      }
    }

    units.push({
      unit_id: `p${i}`,
      item_key: null,
      attachment_key: null,
      page_index: i,
      page_label: labels?.[i] != null ? String(labels[i]) : String(i + 1),
      section_path: outlineByPage.get(i) || '',
      block_type: 'page',
      page_rects: [[i, 0, 0, 0, 0]],
      text: pageText,
    });
    page.cleanup();
  }

  const leveled = assignTitleLevels(headingEvents);
  const voted = sectionPathsFromHeadings(
    leveled.map((h) => ({ page_index: h.page_index, title: h.title, title_level: h.title_level })),
  );
  let last = '';
  for (let i = 0; i < num; i++) {
    if (outlineByPage.has(i)) last = outlineByPage.get(i);
    else if (voted.has(i)) last = voted.get(i);
    const u = units.find((x) => x.page_index === i);
    if (u && !u.section_path) u.section_path = last;
    else if (u && outlineByPage.has(i)) u.section_path = outlineByPage.get(i);
    else if (u && !u.section_path) u.section_path = last;
  }

  return {
    units,
    meta: {
      extractor: 'pdfjs-fallback',
      pdf: path.resolve(pdfPath),
      numPages: doc.numPages,
      extractedPages: num,
      units: units.length,
      outlineItems: outline?.length ?? 0,
      note: 'Set ZOTLIT_PDF_WORKER to a pdf-worker checkout for SDT block/pageRects path',
    },
  };
}

export async function extractIndexUnits(pdfPath, opts = {}) {
  const worker = process.env.ZOTLIT_PDF_WORKER;
  if (worker && fs.existsSync(path.join(worker, 'src/pdf/index.js'))) {
    try {
      return await extractViaSdt(pdfPath, worker, opts);
    } catch (e) {
      console.error('[extract] SDT failed, falling back to pdf.js:', e.message || e);
    }
  }
  return extractViaPdfJs(pdfPath, opts);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pdf = process.argv[2];
  if (!pdf) { console.error('Usage: node extract-blocks.mjs <file.pdf>'); process.exit(2); }
  const r = await extractIndexUnits(pdf);
  console.log(JSON.stringify({ meta: r.meta, sample: r.units.slice(0, 3) }, null, 2));
}
