import { regex } from "arkregex";

/** A `@citekey` occurrence within a line, with its character span. */
export interface CitationToken {
  citekey: string;
  /** Offset of the leading `@`. */
  start: number;
  /** Offset just past the citation key. */
  end: number;
}

/**
 * Pandoc-style citation key: `@` followed by key characters, where the `@` is
 * not preceded by a word character or `.` (so `user@host` / `a@b.com` don't
 * match). The key runs until a bracket, separator, or whitespace, covering
 * `[@key]`, `[@key, p. 3]`, `[@a; @b]`, and bare `@key`.
 */
const CITEKEY_RE = regex("(?<![\\w.])@(?<key>[^\\s\\[\\];,@]+)", "g");

/**
 * Find the `@citekey` token spanning `offset` in `line`. Both span ends are
 * inclusive so a click on the trailing key character still resolves.
 */
export function citationAtOffset(
  line: string,
  offset: number,
): CitationToken | null {
  CITEKEY_RE.lastIndex = 0;
  for (
    let match = CITEKEY_RE.exec(line);
    match;
    match = CITEKEY_RE.exec(line)
  ) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      return { citekey: match.groups.key, start, end };
    }
  }
  return null;
}
