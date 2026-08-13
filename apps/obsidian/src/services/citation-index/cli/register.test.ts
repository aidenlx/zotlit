import type { CliHandler, Plugin, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { DocumentCitationSet } from "@/services/citation-index/service";

import { CITED_BY_COMMAND, REFERENCES_COMMAND } from "./commands";
import { registerCitationsCli } from "./register";

describe("Citations CLI registration", () => {
  it("publishes cited-by with localized command and flag help", () => {
    const registerCliHandler = vi.fn();
    const plugin = { registerCliHandler } as unknown as Plugin;

    registerCitationsCli(plugin, {} as never);

    expect(registerCliHandler).toHaveBeenCalledWith(
      CITED_BY_COMMAND,
      m.cli_cited_by_desc(),
      {
        key: {
          value: "<zotero-key>",
          description: m.cli_flag_cited_by_key_desc(),
        },
        citekey: {
          value: "<citation-key>",
          description: m.cli_flag_cited_by_citekey_desc(),
        },
        "expect-source": {
          value: "<source-id>",
          description: m.cli_flag_expect_source_desc(),
        },
      },
      expect.any(Function),
    );
  });

  it("publishes references with localized command and flag help", () => {
    const registerCliHandler = vi.fn();
    const plugin = { registerCliHandler } as unknown as Plugin;

    registerCitationsCli(plugin, {} as never);

    expect(registerCliHandler).toHaveBeenCalledWith(
      REFERENCES_COMMAND,
      m.cli_references_desc(),
      {
        file: {
          value: "<vault-path>",
          description: m.cli_flag_references_file_desc(),
          required: true,
        },
        "expect-source": {
          value: "<source-id>",
          description: m.cli_flag_expect_source_desc(),
        },
      },
      expect.any(Function),
    );
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
            occurrences: [OCCURRENCE],
          },
        ],
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
