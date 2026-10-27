/** @deprecated Prefer extract-blocks.mjs; kept as page-oriented wrapper. */
import { extractIndexUnits } from './extract-blocks.mjs';
import { pathToFileURL } from 'node:url';

export async function extractPages(pdfPath, opts) {
  const { units, meta } = await extractIndexUnits(pdfPath, opts);
  const byPage = new Map();
  for (const u of units) {
    if (!byPage.has(u.page_index)) {
      byPage.set(u.page_index, {
        page_index: u.page_index,
        page_label: u.page_label,
        section_path: u.section_path,
        text: u.text,
      });
    } else {
      const p = byPage.get(u.page_index);
      p.text = p.text + '\n' + u.text;
    }
  }
  return { pages: [...byPage.values()].sort((a, b) => a.page_index - b.page_index), meta };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await extractPages(process.argv[2]);
  console.log(JSON.stringify({ meta: r.meta, pages: r.pages.length }, null, 2));
}
