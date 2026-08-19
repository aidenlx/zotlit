import type { CliHandler, Plugin, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { DocumentCitationSet } from "@/services/citation-index/service";

import {
  CITATIONS_GUIDE_COMMAND,
  CITED_BY_COMMAND,
  REFERENCES_COMMAND,
} from "./commands";
import { registerCitationsCli } from "./register";

describe("Citations CLI registration", () => {
  it("publishes cited-by with command and flag help", () => {
    const registerCliHandler = vi.fn();
    const plugin = { registerCliHandler } as unknown as Plugin;

    registerCitationsCli(plugin, {} as never);

    expect(registerCliHandler).toHaveBeenCalledWith(
      CITED_BY_COMMAND,
      "List the notes that cite one Zotero item, with the position of every citation",
      {
        key: {
          value: "<zotero-key>",
          description: "Zotero key of the item; use instead of citekey",
        },
        citekey: {
          value: "<citation-key>",
          description: "Citation key of the item; use instead of key",
        },
        "expect-source": {
          value: "<source-id>",
          description: "Zotero source ID the call must match",
        },
      },
      expect.any(Function),
    );
  });

  it("publishes references with command and flag help", () => {
    const registerCliHandler = vi.fn();
    const plugin = { registerCliHandler } as unknown as Plugin;

    registerCitationsCli(plugin, {} as never);

    expect(registerCliHandler).toHaveBeenCalledWith(
      REFERENCES_COMMAND,
      "List what one note cites, with the position of every citation",
      {
        file: {
          value: "<vault-path>",
          description: "Vault path of the note, such as notes/review.md",
          required: true,
        },
        "expect-source": {
          value: "<source-id>",
          description: "Zotero source ID the call must match",
        },
      },
      expect.any(Function),
    );
  });

  it("publishes the guide with command help and no flags", async () => {
    const registerCliHandler = vi.fn();
    const plugin = { registerCliHandler } as unknown as Plugin;

    registerCitationsCli(plugin, {} as never);

    expect(registerCliHandler).toHaveBeenCalledWith(
      CITATIONS_GUIDE_COMMAND,
      "Print the ZotLit citations CLI guide",
      null,
      expect.any(Function),
    );
    const guide = registerCliHandler.mock.calls.find(
      ([command]) => command === CITATIONS_GUIDE_COMMAND,
    )![3] as CliHandler;
    expect(await guide({})).toContain("ZOTLIT-CITATIONS(1)");
  });

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
      const registerCliHandler = vi.fn();
      const plugin = { registerCliHandler } as unknown as Plugin;
      const files = new Map([
        [NOTE.path, NOTE],
        [ASSET.path, ASSET],
      ]);
      const getDocumentCitationSet = vi.fn(() => Promise.resolve(CITATION_SET));

      registerCitationsCli(plugin, {
        app: {
          vault: {
            getName: () => "Test Vault",
            adapter: { getBasePath: () => "/vaults/test" },
            getFileByPath: (path: string) => files.get(path) ?? null,
          },
        },
        citationIndex: {
          waitUntilSettled: () => Promise.resolve("settled"),
          getDocumentCitationSet,
          resolveCitekey: () => ({ kind: "missing" }),
          resolution: "ready",
          syntaxes: () => ({ citekey: "included", wikilink: "excluded" }),
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

      const references = registerCliHandler.mock.calls.find(
        ([command]) => command === REFERENCES_COMMAND,
      )![3] as CliHandler;
      return {
        getDocumentCitationSet,
        references: (file: string) => Promise.resolve(references({ file })),
      };
    }

    it("answers for any Markdown note, not only a Literature Note", async () => {
      const { references, getDocumentCitationSet } = setup();

      const output = await references(NOTE.path);

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
    });

    it("reports a path that names a file other than a Markdown note", async () => {
      const { references, getDocumentCitationSet } = setup();

      const output = await references(ASSET.path);

      expect(getDocumentCitationSet).not.toHaveBeenCalled();
      expect(JSON.parse(output)).toMatchObject({
        ok: false,
        diagnostic: { code: "FILE_NOT_FOUND", details: { file: ASSET.path } },
      });
    });
  });
});
