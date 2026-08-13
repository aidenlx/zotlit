// The one-page Citations Guide: the field semantics behind the citation commands.
//
// Guide prose is literal English, like the diagnostics: it is the agent-facing
// reference, not UI text a user reads while browsing help. Every value list is
// a registry typed against the contract it documents, so an entry kind, an
// index state, a selector, or a diagnostic code cannot reach the payload
// without its row reaching this page.

import type {
  CitationCoverage,
  CitationKeyResolution,
  CitationSyntax,
} from "@/services/citation-index/service";

import { DIAGNOSTIC_HINTS } from "./envelope";
import type { ReferenceEntry } from "./envelope";
import type { CITED_BY_PARAMS, REFERENCES_PARAMS } from "./request";

/** What each selector of the citation commands names. */
const SELECTORS = {
  key: "A Zotero key: an 8-character item key, with a 'g<group-id>' suffix for an item in a group library. cited-by takes exactly one of key= or citekey=.",
  citekey:
    "A citation key, written as it appears in the note body without the leading '@'. It names an item through the citation-key snapshot.",
  file: "The vault-relative path of one Markdown note, as file=folder/note.md. Any Markdown note answers: a document need not be a Literature Note to cite works.",
  "expect-source":
    "The Zotero source the call expects, checked before any data load. It asserts the Zotero source, not the vault; put vault=<vault-name> before the command name to select the vault.",
} as const satisfies Record<
  (typeof CITED_BY_PARAMS)[number] | (typeof REFERENCES_PARAMS)[number],
  string
>;

/** What each entry kind of a references answer reports (ADR 0024). */
const ENTRY_KINDS = {
  resolved:
    "A cited work the connected Zotero source holds. Adds key, citekey, summary, and linkpath; linkpath is null while the work has no Literature Note.",
  unresolved:
    "A citation key that names no item in the connected Zotero source. Adds citekey.",
  missing:
    "A work the index cites that the Zotero source no longer holds. Adds key.",
  malformed:
    "Citation intent that cannot be parsed. It names no work, so it carries no refNumber.",
} as const satisfies Record<ReferenceEntry["kind"], string>;

/** Which syntax wrote an occurrence. */
const OCCURRENCE_KINDS = {
  citekey:
    "A citation key written literally in the note body, with its leading '@'.",
  wikilink:
    "A wikilink to a Literature Note, alone or with a '#cite:' Citation Fragment.",
} as const satisfies Record<CitationSyntax, string>;

/** How much of the vault the reported citation facts cover. */
const COVERAGE_STATES = {
  indexing: "The vault-wide scan is still running.",
  complete: "Every Markdown note in the vault is indexed.",
  degraded:
    "At least one note could not be read, so a citer inside it is absent from the answer.",
} as const satisfies Record<CitationCoverage, string>;

/** How well citation keys resolve to items of the connected Zotero source. */
const RESOLUTION_STATES = {
  resolving: "The citation-key snapshot is being rebuilt.",
  ready: "The snapshot matches the connected Zotero source.",
  degraded:
    "The Zotero database could not be read, so the snapshot is stale or empty and a citation key may resolve to nothing.",
} as const satisfies Record<CitationKeyResolution, string>;

const LABEL_WIDTH = 12;
const PAGE_WIDTH = 78;

/** The Citations Guide: one page, served without an envelope. */
export function renderCitationsGuide(): string {
  return `ZOTLIT-CITATIONS(1)

NAME
  zotlit-citations - read the vault's citation facts from the command line

SYNOPSIS
  obsidian-cli zotlit:cited-by (key=<zotero-key> | citekey=<citation-key>) \\
    [expect-source=<source-id>]
  obsidian-cli zotlit:references file=<vault-path> [expect-source=<source-id>]
  obsidian-cli zotlit:citations-guide

DESCRIPTION
  The Citation Index answers two questions: which notes cite one Zotero item
  (cited-by), and what one document cites (references). Both answer with index
  facts and no view presentation: there is no excerpt text and no rendered
  bibliography. Every occurrence carries its position, so open the file and
  read as much context as the task needs. Full item data stays on one surface:
  call zotlit:template-data with the Zotero key an answer reports.

WORKFLOW
  1. Run obsidian-cli help zotlit and use only the commands it reports.
  2. Run obsidian-cli zotlit:citations-guide.
  3. Read identity.source.id from the first answer, then pass
     expect-source=<source-id> to every later call.
  4. Query with cited-by or references.
  5. Open each reported path and read it at the reported position.
  6. Run zotlit:template-data key=<zotero-key> when the task needs item data.

SELECTORS
${rows(assignments(SELECTORS))}

ENVELOPE
  Both data commands answer with JSON: contractVersion, command, ok, the
  echoed request, identity, and then either the payload or a diagnostic. This
  guide is literal text and carries no envelope.

CITED BY PAYLOAD
  item        { key, citekey } of the item the selector named. citekey is null
              when the Zotero source holds none for it.
  groups      One entry per citing note, in path order, as
              { path, occurrences }. An item that no note cites answers ok
              with an empty list.
  coverage    See INDEX STATE.
  resolution  See INDEX STATE.

REFERENCES PAYLOAD
  entries     The document's cited works in first-occurrence order, each as
              { refNumber, kind, occurrences } plus the fields its kind adds.
              refNumber is the reference number the document gives the work.

ENTRY KINDS
${rows(ENTRY_KINDS)}

OCCURRENCES
  Every occurrence is { kind, raw, position }.

${rows(OCCURRENCE_KINDS)}
  raw         The literal citation key, or the wikilink's linkpath with its
              subpath removed.
  position    { start, end }, each { line, col, offset }. line and col count
              from 0; offset counts UTF-16 code units from the start of the
              file. start is inclusive and end is exclusive, so
              end.offset - start.offset is the length of the fragment.

  Frontmatter, code, math, and %% comments hold no citations: text there is
  excluded before the index reads a note.

INDEX STATE
  coverage
${rows(COVERAGE_STATES, 4)}

  resolution
${rows(RESOLUTION_STATES, 4)}

  Both commands wait out the transitional states, indexing and resolving, and
  answer INDEX_NOT_READY when either persists. degraded is settled data rather
  than a failure: the answer is partial, so report the state with it.

DIAGNOSTICS
  A failed call answers ok:false with diagnostic { code, message, hint,
  details }. code is the stable machine surface; hint is the recovery action.

${rows(DIAGNOSTIC_HINTS)}`;
}

/** A parameter is written `name=<value>`, so its row is labeled that way. */
function assignments(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, description]) => [
      `${name}=`,
      description,
    ]),
  );
}

/**
 * `  name        description`, in the man-page column layout. A name as wide as
 * the label column takes a line of its own.
 */
function rows(entries: Record<string, string>, indent = 2): string {
  const margin = " ".repeat(indent + LABEL_WIDTH);
  return Object.entries(entries)
    .map(([name, description]) => {
      const body = wrap(description, PAGE_WIDTH - margin.length).join(
        `\n${margin}`,
      );
      return name.length < LABEL_WIDTH
        ? `${" ".repeat(indent)}${name.padEnd(LABEL_WIDTH)}${body}`
        : `${" ".repeat(indent)}${name}\n${margin}${body}`;
    })
    .join("\n");
}

/** Greedy fill, so a registry description reads as a paragraph in its column. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}
