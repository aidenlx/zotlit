// Keeps one source generation with its parsed syntax, rendering input and valid occurrences.
import type { TFile, Vault } from "obsidian";

import { rewriteScannedPandocCitation } from "@zotlit/templates/pandoc-citation";
import type { ScannedPandocCitation } from "@zotlit/templates/pandoc-citation";

import type { PlainCitationParse } from "@/services/citation-parse/plain";

import { occurrencesEqual } from "./scan";
import type { CitationOccurrence } from "./scan";
import type { NoteScanRecord } from "./scan-note";
import type { FileScan } from "./store";

export function annotationCitations(
  scan: Pick<FileScan, "annotations"> | null,
): CitationOccurrence[] {
  return (scan?.annotations ?? [])
    .filter(({ form }) => form === "citation")
    .map(({ indexedKey, position, pageLabel }) => ({
      kind: "annotation",
      raw: indexedKey,
      position,
      pageLabel,
    }));
}

export function renderParsedCitation(
  citation: ScannedPandocCitation,
  keys: readonly (string | null)[],
): string {
  return rewriteScannedPandocCitation(citation, keys);
}

export class ParsedNote {
  constructor(
    readonly source: string,
    readonly record: NoteScanRecord,
  ) {}

  exportInput(): {
    markdown: string;
    literalKeys: ReadonlyMap<string, string>;
    literalMarker: string;
  } {
    const source = this.source.split("");
    let prefix = "ZotLitParsedCitation";
    const lowerSource = this.source.toLowerCase();
    while (lowerSource.includes(prefix.toLowerCase())) prefix += "X";
    const literalKeys = new Map<string, string>();
    for (const range of this.record.ranges) {
      if (range.kind === "text-dollar") source[range.from] = "\\$";
      else if (range.kind === "comment") source.fill("", range.from, range.to);
      else if (range.kind === "fenced-code" && range.blankLinePrefix !== null)
        source[range.lineStart] =
          `${range.blankLinePrefix}\n${source[range.lineStart]}`;
    }
    for (const citation of this.record.citations) {
      for (const item of citation.items) {
        const id = `${item.citationKey}${prefix}${literalKeys.size}`;
        literalKeys.set(id, item.citationKey);
        source.fill("", item.start, item.end);
        source[item.start] = `${item.suppressAuthor ? "-" : ""}@{${id}}`;
      }
    }
    return { markdown: source.join(""), literalKeys, literalMarker: prefix };
  }

  currentOccurrence(occurrence: CitationOccurrence): CitationOccurrence | null {
    return currentOccurrence({
      scan: this.record,
      source: this.source,
      occurrence,
    });
  }
}

export async function readParsedNote(
  file: TFile,
  {
    vault,
    parser,
    signal,
  }: {
    vault: Pick<Vault, "cachedRead">;
    parser: Pick<PlainCitationParse, "parse">;
    signal: AbortSignal;
  },
): Promise<ParsedNote> {
  for (;;) {
    signal.throwIfAborted();
    const {
      path,
      stat: { mtime, size },
    } = file;
    const source = await vault.cachedRead(file);
    const { record } = await parser.parse(
      { path, generation: 0, text: source },
      signal,
    );
    if (
      file.path === path &&
      file.stat.mtime === mtime &&
      file.stat.size === size
    )
      return new ParsedNote(source, record);
  }
}

export function currentOccurrence({
  scan,
  source,
  occurrence,
}: {
  scan: Pick<FileScan, "citekeys" | "wikilinks" | "annotations"> | null;
  source: string;
  occurrence: CitationOccurrence;
}): CitationOccurrence | null {
  if (!scan) return null;
  return (
    [...scan.citekeys, ...scan.wikilinks, ...annotationCitations(scan)].find(
      (candidate) => {
        if (!occurrencesEqual([candidate], [occurrence])) return false;
        return [candidate.position.start, candidate.position.end].every(
          ({ line, col, offset }) => {
            const before = source.slice(0, offset);
            return (
              offset <= source.length &&
              line === before.split("\n").length - 1 &&
              col === offset - before.lastIndexOf("\n") - 1
            );
          },
        );
      },
    ) ?? null
  );
}
