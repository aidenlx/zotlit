// #1689: extracted facts from every recorded Obsidian 1.14.4 parity case.
// Source: quartz-community/remark-obsidian at a80395a3d80f351e67a0afdb63b51a604e010c8e,
// test/parity/corpus.ts and test/parity/goldens/obsidian.json (compute.links).
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { scanNote } from "./scan-note";
import type { NoteScanRecord } from "./scan-note";

// The fixture retains every case ID and source verbatim. Expected coordinates
// come from the recorded cache, converted to UTF-16 offsets. Eligibility follows
// #1689: unaliased, non-embedded wikilinks with a nonempty path and no subpath.
// Deliberate differences from the oracle:
// - fuzz/comment/{5,10}, fuzz/footnote/{9,33}: ADR 0079 excludes comments.
// - probe/autolink-trail/wikilink, fuzz/wikilink/2: #1689 leaves bare-URL
//   recognition off, so the following wikilink remains available.
// - probe/autolink/email-escaped: the recorded renderer leaves this as prose;
//   the shared Pandoc grammar recognizes its unescaped @bar.example.com.
// Frontmatter's exact closing delimiter remains the ticket's rule; the adapted
// closing-line-trailing-text row in scan-note.test.ts records that difference.
const cases = readFileSync(
  new URL("./__fixtures__/scan-note-corpus.jsonl", import.meta.url),
  "utf8",
)
  .trimEnd()
  .split("\n")
  .map(
    (line) =>
      JSON.parse(line) as {
        id: string;
        text: string;
        record: Partial<NoteScanRecord>;
      },
  );

it.each(cases)("$id", ({ text, record }) => {
  expect(scanNote(text)).toEqual({
    citations: [],
    citekeys: [],
    wikilinks: [],
    malformedWikilinks: [],
    annotations: [],
    malformedAnnotationCitations: [],
    ...record,
  });
});
