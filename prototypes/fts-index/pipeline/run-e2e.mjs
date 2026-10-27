/**
 * End-to-end: PDF → extract (SDT or pdf.js) → normalize → FTS5 (zotlit_cjk) → sample queries.
 *
 * Usage:
 *   node pipeline/run-e2e.mjs [path/to.pdf]
 *   ZOTLIT_CJK_VARIANT=jieba node pipeline/run-e2e.mjs
 *   ZOTLIT_PDF_WORKER=/path/to/pdf-worker node pipeline/run-e2e.mjs
 *
 * Default PDF: samples/sample-cjk.pdf (CC0 demo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { extractIndexUnits } from './extract-blocks.mjs';
import { openIndexedDb, insertUnits, search, resolveExtensionPath } from './index-fts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const pdf = process.argv[2] || path.join(ROOT, 'samples', 'sample-cjk.pdf');
const variant = process.env.ZOTLIT_CJK_VARIANT || 'icu';
const tokenizeArg =
  variant === 'jieba' ? 'zotlit_cjk jieba' : variant === 'icu' ? 'zotlit_cjk' : `zotlit_cjk ${variant}`;

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const dbPath = path.join(outDir, 'e2e-demo.db');
const reportPath = path.join(outDir, 'e2e-demo.json');

console.log('=== ZotLit FTS e2e ===');
console.log('pdf:', pdf);
console.log('variant:', variant, 'tokenize:', tokenizeArg);
console.log('ZOTLIT_PDF_WORKER:', process.env.ZOTLIT_PDF_WORKER || '(unset → pdf.js fallback)');

const t0 = performance.now();
const { units, meta } = await extractIndexUnits(pdf);
const extractMs = performance.now() - t0;
console.log('extract:', meta.extractor, 'units', units.length, `${extractMs.toFixed(0)}ms`);

const so = resolveExtensionPath(ROOT, variant);
const { db, mode, loadError } = openIndexedDb(dbPath, {
  root: ROOT,
  extPath: so,
  tokenizeArg: variant === 'jieba' ? 'zotlit_cjk jieba' : 'zotlit_cjk',
});
if (loadError) console.warn('extension note:', loadError);
console.log('index mode:', mode);

const t1 = performance.now();
insertUnits(db, units, { mode, itemKey: 'SAMPLE1', attachmentKey: 'ATT1' });
const indexMs = performance.now() - t1;
console.log(`indexed ${units.length} units in ${indexMs.toFixed(1)}ms → ${dbPath}`);

const queries = ['版本控制', '控制', '暂存区', 'pre-commit', 'v2.4.0', '저장소', 'バージョン'];
const results = {};
for (const q of queries) {
  try {
    const hits = search(db, q, { mode, limit: 5 });
    results[q] = hits;
    console.log(`\nQUERY ${JSON.stringify(q)} → ${hits.length} hit(s)`);
    for (const h of hits) {
      console.log(
        `  p${h.page_index} label=${h.page_label} § ${h.section_path || '—'}`,
      );
      console.log(`  snip: ${h.snip}`);
      console.log(`  link: ${h.open_pdf}`);
    }
  } catch (e) {
    results[q] = { error: String(e.message || e) };
    console.log(`\nQUERY ${JSON.stringify(q)} ERROR`, e.message || e);
  }
}

const report = {
  pdf,
  variant,
  mode,
  loadError,
  extract: meta,
  extract_ms: +extractMs.toFixed(1),
  index_ms: +indexMs.toFixed(1),
  units: units.length,
  sample_unit: units[0]
    ? { ...units[0], text: units[0].text.slice(0, 160) }
    : null,
  results,
  generated_at: new Date().toISOString(),
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log('\nWrote', reportPath);
db.close?.();
