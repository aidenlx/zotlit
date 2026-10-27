/**
 * Heading-level vote inspired by PaddleX
 * `paddlex/inference/pipelines/layout_parsing/title_level.py`
 * (`get_symbol_and_level`, `SPECIAL_KEYWORDS`, vote among semantic numbering /
 * relative symbol order / height cluster). Apache-2.0 upstream — idea port only.
 *
 * Section breadcrumbs follow PageIndex's section-tree → path idea
 * (`pageindex/flash/api.py` `page_index_flash`, outline/TOC → structure nodes).
 */

const SPECIAL = new Map([
  ['ABSTRACT', 1], ['SUMMARY', 1], ['INTRODUCTION', 1], ['BACKGROUND', 1],
  ['METHOD', 1], ['METHODS', 1], ['RESULTS', 1], ['DISCUSSION', 1],
  ['CONCLUSION', 1], ['CONCLUSIONS', 1], ['REFERENCES', 1], ['APPENDIX', 1],
  ['ACKNOWLEDGMENTS', 1],
  ['摘要', 1], ['绪论', 1], ['引言', 1], ['目录', 1], ['参考文献', 1],
  ['附录', 1], ['致谢', 1], ['结论', 1], ['讨论', 1], ['前言', 1],
]);

const RE_NUM = /^\s*(\d+(?:\.\d+)*)(?![）)])(?:[.\s]|(?=[A-Z\u4e00-\u9fff]))/;
const RE_CN = /^\s*(?:第|[（(])?([一二三四五六七八九十]{1,2})(?:[章节篇卷部条题]|[）)])?/;
const RE_ROMAN = /^\s*([IVX]+)(?:[.\s)．]|$)/i;

export function getSymbolAndLevel(content) {
  const txt = String(content).trim();
  const num = txt.match(RE_NUM);
  if (num) return { symbol: 'NUM_LIST', level: num[1].split('.').length };
  if (RE_CN.test(txt)) return { symbol: 'CHINESE_NUM', level: 1 };
  if (RE_ROMAN.test(txt)) return { symbol: 'ROMAN', level: 1 };
  const key = txt.toUpperCase().replace(/[\s：:]+$/g, '').replace(/\s+/g, '');
  if (SPECIAL.has(key)) return { symbol: 'SPECIAL', level: SPECIAL.get(key) };
  if (SPECIAL.has(txt)) return { symbol: 'SPECIAL', level: SPECIAL.get(txt) };
  return { symbol: null, level: -1 };
}

/** @param {{text:string, height?:number}[]} entries */
export function assignTitleLevels(entries) {
  const heights = entries.map((e) => e.height || 0).filter((h) => h > 0).sort((a, b) => b - a);
  const uniq = [...new Set(heights.map((h) => Math.round(h)))];
  const clusterOf = (h) => {
    const i = uniq.indexOf(Math.round(h || 0));
    return i < 0 ? 3 : Math.min(i + 1, 6);
  };
  const symbolFirst = new Map();
  return entries.map((e) => {
    const { symbol, level: sem } = getSymbolAndLevel(e.text);
    const cluster = clusterOf(e.height);
    if (symbol === 'SPECIAL' && sem > 0) return { ...e, title_level: sem };
    let relative = cluster;
    if (symbol && symbol !== 'SPECIAL') {
      if (!symbolFirst.has(symbol)) symbolFirst.set(symbol, sem > 0 ? sem : cluster);
      relative = symbol === 'NUM_LIST' && sem > 0 ? sem : symbolFirst.get(symbol);
    }
    const votes = [];
    if (sem > 0) votes.push(sem);
    votes.push(relative, cluster);
    const counts = new Map();
    for (const v of votes) counts.set(v, (counts.get(v) || 0) + 1);
    let best = relative;
    let bestN = 0;
    for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
    return { ...e, title_level: Math.max(1, Math.min(6, Number(best) || 3)) };
  });
}

/** PageIndex-style breadcrumb from ordered heading events. */
export function sectionPathsFromHeadings(headings) {
  const stack = [];
  const byPage = new Map();
  for (const h of headings) {
    while (stack.length && stack[stack.length - 1].title_level >= h.title_level) stack.pop();
    stack.push(h);
    byPage.set(h.page_index, stack.map((x) => x.title).join(' / '));
  }
  return byPage;
}
