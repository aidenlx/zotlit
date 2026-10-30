import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";
import { describe, expect } from "vitest";

import { Vault } from "@/lib/obsidian-vault";
import type { ParseRequest } from "@/services/citation-parse/client";
import { CitationParse } from "@/services/citation-parse/service";

import { readParsedNote } from "./parsed-note";
import { scanNote } from "./scan-note";

function note(path: string, mtime: number): TFile {
  const file = new TFile();
  file.path = path;
  file.stat = { ctime: 0, mtime, size: 0 };
  return file;
}

/** The parse worker's answer, scanned in process. */
const scanned = (request: ParseRequest) =>
  Effect.succeed({ ...request, record: scanNote(request.text) });

describe("readParsedNote", () => {
  it.effect("parses the note's cached source as generation 0", () => {
    const file = note("draft.md", 1);
    const requests: ParseRequest[] = [];
    return Effect.gen(function* () {
      const parsed = yield* readParsedNote(file);
      expect(requests).toEqual([
        { path: "draft.md", generation: 0, text: "See @doe2024." },
      ]);
      expect(parsed.source).toBe("See @doe2024.");
      expect(
        parsed.record.citations.flatMap(({ items }) =>
          items.map(({ citationKey }) => citationKey),
        ),
      ).toEqual(["doe2024"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(Vault, {
            cachedRead: () => Effect.succeed("See @doe2024."),
          }),
          Layer.mock(CitationParse, {
            parse: (request) => {
              requests.push(request);
              return scanned(request);
            },
          }),
        ),
      ),
    );
  });

  it.effect("reads again when the note changes during the parse", () => {
    const file = note("draft.md", 1);
    const sources = ["@old2020", "@new2024"];
    const reads: string[] = [];
    return Effect.gen(function* () {
      const parsed = yield* readParsedNote(file);
      expect(reads).toEqual(["@old2020", "@new2024"]);
      expect(parsed.source).toBe("@new2024");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(Vault, {
            cachedRead: () =>
              Effect.sync(() => {
                const source = sources[reads.length]!;
                reads.push(source);
                return source;
              }),
          }),
          Layer.mock(CitationParse, {
            parse: (request) => {
              // The first parse sees the note saved under it.
              if (reads.length === 1) file.stat = { ...file.stat, mtime: 2 };
              return scanned(request);
            },
          }),
        ),
      ),
    );
  });
});
