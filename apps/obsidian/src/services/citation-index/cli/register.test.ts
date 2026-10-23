import type { TFile } from "obsidian";
import { describe, expect, vi } from "vitest";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type { DocumentCitationSet } from "@/services/citation-index/service";

import { CITATIONS_GUIDE_COMMAND, REFERENCES_COMMAND } from "./commands";
import { registerCitationsCli } from "./register";

describe("Citations CLI registration", () => {
  it.effect("publishes the guide with command help and no flags", () =>
    Effect.gen(function* () {
      const { host, command } = fakeCliHost();

      registerCitationsCli(host, {} as never);

      const guide = command(CITATIONS_GUIDE_COMMAND);
      expect(guide).toMatchObject({
        description: "Print the ZotLit citations CLI guide",
        flags: null,
      });
      expect(yield* guide.handler({})).toContain("ZOTLIT-CITATIONS(1)");
    }),
  );

  describe("references over the vault", () => {
    const OCCURRENCE = {
      kind: "citekey",
      raw: "roe2099",
      position: {
        start: { line: 0, col: 2, offset: 2 },
        end: { line: 0, col: 10, offset: 10 },
      },
    } as const;

    /** {@link OCCURRENCE} as an answer reports it: line and col count from 1. */
    const REPORTED_OCCURRENCE = {
      kind: "citekey",
      raw: "roe2099",
      position: {
        start: { line: 1, col: 3, offset: 2 },
        end: { line: 1, col: 11, offset: 10 },
      },
    } as const;

    const CITATION_SET: DocumentCitationSet = {
      lookup: lookupAnswer({ roe2099: { kind: "missing" } }),
      occurrences: [OCCURRENCE],
      citations: [
        {
          indexedKey: null,
          linkpath: null,
          refNumber: 1,
          occurrences: [OCCURRENCE],
        },
      ],
      errors: [],
    };

    /** An ordinary note, with no Literature Note frontmatter of its own. */
    const NOTE = { path: "writing/essay.md", extension: "md" } as TFile;
    const ASSET = { path: "writing/figure.png", extension: "png" } as TFile;

    function setup() {
      const { host, command } = fakeCliHost();
      const files = new Map([
        [NOTE.path, NOTE],
        [ASSET.path, ASSET],
      ]);
      const getDocumentCitationSet = vi.fn(() => Promise.resolve(CITATION_SET));

      registerCitationsCli(host, {
        app: {
          vault: {
            getName: () => "Test Vault",
            adapter: { getBasePath: () => "/vaults/test" },
            getFileByPath: (path: string) => files.get(path) ?? null,
          },
        },
        citationLookup: { read: async () => lookupAnswer(), status: "fresh" },
        citationIndex: {
          citationKeys: () => [],
          annotationCitationKeys: () => [],
          waitUntilSettled: () => Promise.resolve("settled"),
          getDocumentCitationSet,
          readLookup: async () => lookupAnswer(),
          resolution: "fresh",
          syntaxes: () => ({
            citekey: "included",
            wikilink: "excluded",
            annotation: "included",
          }),
          documentOmittedSyntaxes: () => Promise.resolve([]),
          citedByOmittedSyntaxes: () => Promise.resolve([]),
        },
        db: { state: "loading" },
        zoteroPref: {
          ready: Promise.resolve(),
          sourceId: "a1b2c3d4",
          databasePath: "/Zotero/zotero.sqlite",
        },
      } as never);

      const references = command(REFERENCES_COMMAND).handler;
      return {
        getDocumentCitationSet,
        references: (file: string) => references({ file }),
      };
    }

    it.effect("answers for any Markdown note, not only a Literature Note", () =>
      Effect.gen(function* () {
        const { references, getDocumentCitationSet } = setup();

        const output = yield* references(NOTE.path);

        expect(getDocumentCitationSet).toHaveBeenCalledWith(NOTE);
        expect(JSON.parse(output)).toMatchObject({
          ok: true,
          request: { file: NOTE.path },
          entries: [
            {
              refNumber: 1,
              kind: "unresolved",
              citekey: "roe2099",
              occurrences: [REPORTED_OCCURRENCE],
            },
          ],
          // The fake database never became readable, which the payload reports.
          database: "unreadable",
        });
      }),
    );

    it.effect(
      "reports a path that names a file other than a Markdown note",
      () =>
        Effect.gen(function* () {
          const { references, getDocumentCitationSet } = setup();

          const output = yield* references(ASSET.path);

          expect(getDocumentCitationSet).not.toHaveBeenCalled();
          expect(JSON.parse(output)).toMatchObject({
            ok: false,
            diagnostic: {
              code: "FILE_NOT_FOUND",
              details: { file: ASSET.path },
            },
          });
        }),
    );
  });
});
