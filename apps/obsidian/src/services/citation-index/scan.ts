// Citation occurrence types, equality, and the editor's synchronous wikilink mask.
import type { Pos } from "obsidian";

/** Which syntax wrote a Citation Occurrence. */
export type CitationSyntax = "citekey" | "wikilink" | "annotation";

/**
 * One appearance of a Citation in one document. Raw and unresolved by design:
 * what it cites is answered at query time.
 */
export interface CitationOccurrence {
  kind: CitationSyntax;
  /** The literal citekey, stripped wikilink linkpath, or Annotation Indexed Key. */
  raw: string;
  /** The validated text after a Wikilink Citation’s #cite: marker. */
  fragment?: string;
  position: Pos;
  /** The Annotation Citation's page locator, when supplied by its link. */
  pageLabel?: string | null;
}

/** A Citation Fragment that declares citation intent but cannot be parsed. */
export interface MalformedWikilinkCitation {
  occurrence: CitationOccurrence;
}

/**
 * Structural equality. A `changed` event also fires on a content-identical
 * touch, so this is what keeps such a touch from waking the index's listeners.
 */
export function occurrencesEqual(
  prev: readonly CitationOccurrence[],
  next: readonly CitationOccurrence[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((occurrence, index) => {
    const other = next[index]!;
    return (
      occurrence.kind === other.kind &&
      occurrence.raw === other.raw &&
      occurrence.fragment === other.fragment &&
      occurrence.pageLabel === other.pageLabel &&
      occurrence.position.start.offset === other.position.start.offset &&
      occurrence.position.end.offset === other.position.end.offset
    );
  });
}

/**
 * Blank every wikilink and embed of `text`, keeping each offset. Pandoc reads
 * `[[…]]` as a wikilink, so a `[@key]` inside one is no citation; the Wikilink
 * Citations path alone reads a link. The citekey editor reads a line through
 * this alone: its syntax tree rules out the rest.
 */
export function maskWikilinks(text: string): string {
  const body = text.split("");
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "\\") {
      at += 1;
    } else if (body[at] === "[" && body[at + 1] === "[") {
      at = maskWikilink(body, at);
    }
  }
  return body.join("");
}

function mask(body: string[], from: number, to: number): void {
  for (let at = from; at < to; at += 1) {
    if (body[at] !== "\n") body[at] = " ";
  }
}

/**
 * A wikilink stays on one line; an unclosed `[[` is text.
 *
 * @returns the offset the inline scan continues from, after the masked link.
 */
function maskWikilink(body: string[], open: number): number {
  for (let at = open + 2; at < body.length - 1 && body[at] !== "\n"; at += 1) {
    if (body[at] !== "]" || body[at + 1] !== "]") continue;
    mask(body, open, at + 2);
    return at + 1;
  }
  return open + 1;
}
