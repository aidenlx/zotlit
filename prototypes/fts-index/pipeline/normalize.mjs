/**
 * Line/paragraph join rules ported as *ideas* (not vendored code) from:
 * - PaddleX layout_parsing/pipeline_v2.py `merge_text_across_page` /
 *   markdown join (~L1355–1425): no space when either side is CJK;
 *   space only for Latin–Latin wraps.
 * - Zotero pdf-worker `block-cleanup.js` (~L352–357) + SDT `parts.js`
 *   `shouldDropHardHyphenAtPartBoundary`: drop trailing `-` when the next
 *   token continues a Latin word in lowercase.
 *
 * Why not `.zotero-ft-cache` / single `getFulltext` blob:
 * pages are joined with `\f`; trimming a leading `\f` shifts every page
 * index vs `pageIndex` used by `zotero://open-pdf`. Hyphen joining and
 * reading-order must happen on stable per-page / per-block units.
 */

const CJK_CHAR = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

export function isCjkChar(ch) {
  return ch != null && CJK_CHAR.test(ch);
}

/** PaddleX-style: separator between two fragments. */
export function joinSeparator(prevText, nextText) {
  const last = [...String(prevText)].at(-1) || '';
  const first = [...String(nextText)].at(0) || '';
  if (!last || !first) return '';
  // Zotero-style Latin hyphen continuation
  if (last === '-' && /^[a-z]/.test(first)) return ''; // caller should also drop '-'
  if (isCjkChar(last) || isCjkChar(first)) return '';
  return ' ';
}

export function joinFragments(a, b) {
  const prev = String(a);
  const next = String(b);
  const last = [...prev].at(-1) || '';
  const first = [...next].at(0) || '';
  if (last === '-' && /^[a-z]/.test(first)) {
    return prev.slice(0, -1) + next; // drop hard hyphen
  }
  return prev + joinSeparator(prev, next) + next;
}

export function joinCjkLineBreaks(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines.length <= 1) return String(text);
  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];
    const last = [...out].at(-1) || '';
    const first = [...next].at(0) || '';
    if (last === '-' && /^[a-z]/.test(first)) {
      out = out.slice(0, -1) + next;
    } else if (isCjkChar(last) && isCjkChar(first)) {
      out = out + next;
    } else if (/[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(next)) {
      out = out + ' ' + next;
    } else {
      out = out + '\n' + next;
    }
  }
  return out;
}

export function normalizePageText(text) {
  // NFC so NFD kana/hangul from some extractors match NFC queries
  let t = String(text).normalize('NFC').replace(/\u00ad/g, '');
  t = joinCjkLineBreaks(t);
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}
