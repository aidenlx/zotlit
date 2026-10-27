/**
 * Create FTS5 table and insert index units.
 * Prefer zotlit_cjk loadable extension; fall back to JS Intl pretokenize + unicode61.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tokenizeForIndex, tokenizeForQuery } from './js-fallback-tokenizer.mjs';

export function resolveExtensionPath(root, variant = process.env.ZOTLIT_CJK_VARIANT || 'icu') {
  const dist = path.join(root, 'dist');
  if (variant === 'jieba') {
    for (const n of ['zotlit_cjk_icu_jieba.so', 'zotlit_cjk.so', 'libzotlit_cjk.so']) {
      const p = path.join(dist, n);
      if (fs.existsSync(p)) return p;
    }
  }
  for (const n of ['zotlit_cjk_icu.so', 'zotlit_cjk.so', 'libzotlit_cjk.so']) {
    const p = path.join(dist, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function openIndexedDb(dbPath, { root, extPath, tokenizeArg = 'zotlit_cjk' } = {}) {
  if (dbPath !== ':memory:' && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new DatabaseSync(dbPath === ':memory:' ? ':memory:' : dbPath, { allowExtension: true });
  let mode = 'js-fallback';
  let loadError = null;
  const so = extPath || resolveExtensionPath(root);
  if (so) {
    try {
      db.loadExtension(so);
      db.exec(`CREATE VIRTUAL TABLE pages USING fts5(
        item_key UNINDEXED,
        attachment_key UNINDEXED,
        page_index UNINDEXED,
        page_label UNINDEXED,
        section_path UNINDEXED,
        unit_id UNINDEXED,
        page_rects UNINDEXED,
        text,
        tokenize='${tokenizeArg}'
      )`);
      mode = `ext:${path.basename(so)}:${tokenizeArg}`;
    } catch (e) {
      loadError = String(e.message || e);
      try { db.exec('DROP TABLE IF EXISTS pages'); } catch {}
    }
  } else {
    loadError = 'extension .so not found — run scripts/build-ext.sh';
  }
  if (mode === 'js-fallback') {
    db.exec(`CREATE VIRTUAL TABLE pages USING fts5(
      item_key UNINDEXED,
      attachment_key UNINDEXED,
      page_index UNINDEXED,
      page_label UNINDEXED,
      section_path UNINDEXED,
      unit_id UNINDEXED,
      page_rects UNINDEXED,
      text,
      tokenize='unicode61 remove_diacritics 2'
    )`);
  }
  return { db, mode, loadError, so };
}

export function insertUnits(db, units, { mode, itemKey = 'DEMOITEM', attachmentKey = 'DEMOATT' } = {}) {
  const ins = db.prepare(`INSERT INTO pages(
    item_key, attachment_key, page_index, page_label, section_path, unit_id, page_rects, text
  ) VALUES (?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN');
  for (const u of units) {
    const text =
      mode === 'js-fallback' ? tokenizeForIndex(u.text) : u.text;
    ins.run(
      u.item_key || itemKey,
      u.attachment_key || attachmentKey,
      u.page_index,
      u.page_label || '',
      u.section_path || '',
      u.unit_id || '',
      JSON.stringify(u.page_rects || []),
      text,
    );
  }
  db.exec('COMMIT');
}

/** Quote an FTS5 query when it contains operators / punctuation. */
export function fts5Query(raw) {
  const s = String(raw).trim();
  if (!s) return '""';
  // Already a phrase or boolean expression the caller built — pass through if quoted.
  if ((s.startsWith('"') && s.endsWith('"')) || /\b(AND|OR|NOT|NEAR)\b/i.test(s)) return s;
  // Bare tokens with FTS5-special chars need phrase quoting.
  if (/[-.+*^:(){}\[\]"']/.test(s) || /\s/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function search(db, query, { mode, limit = 10 } = {}) {
  let q = mode === 'js-fallback' ? tokenizeForQuery(query) : String(query);
  q = fts5Query(q);
  const rows = db
    .prepare(
      `SELECT item_key, attachment_key, page_index, page_label, section_path, unit_id,
              snippet(pages, 7, '«', '»', '…', 24) AS snip,
              page_rects
       FROM pages WHERE pages MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(q, limit);
  return rows.map((r) => ({
    ...r,
    open_pdf: `zotero://open-pdf/library/items/${r.attachment_key}?page=${Number(r.page_index) + 1}&annotation=`,
  }));
}
