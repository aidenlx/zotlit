/**
 * JS fallback when loadExtension fails: pre-tokenize CJK with Intl.Segmenter
 * (+ Han bigrams) into a unicode61 FTS5 table.
 */
const intlZh = new Intl.Segmenter('zh', { granularity: 'word' });

function hanBigrams(text) {
  const out = [];
  for (const run of text.match(/[\u4e00-\u9fff]+/gu) || []) {
    const chars = [...run];
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  }
  return out;
}

export function tokenizeForIndex(text) {
  const words = [...intlZh.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment.toLowerCase());
  return [...new Set([...words, ...hanBigrams(text)])].join(' ');
}

export function tokenizeForQuery(text) {
  return [...intlZh.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment.toLowerCase())
    .join(' ');
}
