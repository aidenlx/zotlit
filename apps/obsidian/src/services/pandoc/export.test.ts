import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type LinkCache } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { type CslItemData } from "@zotlit/db";

import {
  type BibliographyFailure,
  type BibliographyItemRef,
} from "./bibliography";
import { createCitationEngine, type DocumentRequest } from "./engine";
import {
  exportCitedDocument,
  type ExportFailure,
  type ExportPorts,
  type ExportResult,
} from "./export";
import { PANDOC_RESOLVE_MAP_FILENAME, pandocSandboxFilter } from "./filter";

const SOURCE = "Notes/Paper.md";

/** Its `id` is a native citation key, which is what a literal `@key` cites. */
const ZETA: CslItemData = {
  id: "zeta2020",
  type: "book",
  title: "A study of nothing",
  author: [{ family: "Zeta", given: "Ann" }],
  issued: { "date-parts": [[2020]] },
};
/** Its `id` is the item URI an Item with no citation key carries. */
const ADAMS: CslItemData = {
  id: "http://zotero.org/users/1/items/ADAM5678",
  type: "book",
  title: "Beta and beyond",
  author: [{ family: "Adams", given: "Bob" }],
  issued: { "date-parts": [[2018]] },
};

function link(target: string): LinkCache {
  return {
    link: target,
    original: `[[${target}]]`,
    position: {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: target.length + 4, offset: 0 },
    },
  };
}

function ref(itemKey: string, groupID: number | null = null) {
  return { itemKey, libraryID: groupID === null ? 1 : 5, groupID };
}

interface Fixture {
  links?: readonly LinkCache[];
  /** Linkpath → Indexed Key of the Literature Note it names. */
  notes?: Record<string, string>;
  /** Indexed Key → the Zotero library address the database places it in. */
  placed?: Record<string, BibliographyItemRef>;
  /** Indexed Key → the CSL-JSON Zotero answers with. */
  items?: Record<string, CslItemData>;
  /** Deny the read lease, as a degraded database does. */
  databaseUnavailable?: boolean;
  bibliographyFailure?: BibliographyFailure;
  /** Make the engine refuse the conversion. */
  engineError?: string;
}

function ports(fixture: Fixture): ExportPorts & {
  renderDocument: ReturnType<typeof vi.fn>;
  fetchBibliography: ReturnType<typeof vi.fn>;
} {
  const renderDocument = vi.fn((_request: DocumentRequest) => {
    if (fixture.engineError) throw new Error(fixture.engineError);
    return Promise.resolve(new Uint8Array([1, 2, 3]));
  });
  const fetchBibliography = vi.fn((refs: readonly BibliographyItemRef[]) => {
    if (fixture.bibliographyFailure) {
      return Promise.resolve({ error: fixture.bibliographyFailure });
    }
    const items = new Map<string, CslItemData>();
    for (const [indexedKey, item] of Object.entries(fixture.items ?? {})) {
      if (refs.some((r) => r.itemKey === indexedKey.split("g")[0])) {
        items.set(indexedKey, item);
      }
    }
    return Promise.resolve({ source: "local-api" as const, items });
  });
  return {
    renderDocument,
    fetchBibliography,
    engine: { renderDocument },
    dataDir: () => "/Zotero",
    resolveIndexedKey: (linkpath) => fixture.notes?.[linkpath] ?? null,
    readItemRefs: (indexedKeys) => {
      if (fixture.databaseUnavailable) return Promise.resolve(null);
      const placed = new Map<string, BibliographyItemRef>();
      for (const indexedKey of indexedKeys) {
        const item = fixture.placed?.[indexedKey];
        if (item) placed.set(indexedKey, item);
      }
      return Promise.resolve(placed);
    },
  };
}

function run(
  fixture: Fixture,
  request: Partial<Parameters<typeof exportCitedDocument>[0]> = {},
): Promise<ExportResult> & { ports: ReturnType<typeof ports> } {
  const wired = ports(fixture);
  const promise = exportCitedDocument(
    {
      document: { sourcePath: SOURCE, links: fixture.links ?? [] },
      markdown: "Cited [[Zeta 2020]].\n",
      format: "docx",
      ...request,
    },
    wired,
  );
  return Object.assign(promise, { ports: wired });
}

function failure(result: ExportResult): ExportFailure | undefined {
  return "error" in result ? result.error : undefined;
}

const CITED: Fixture = {
  links: [link("Zeta 2020"), link("Adams 2018#cite:locator=33")],
  notes: { "Zeta 2020": "ZETA1234", "Adams 2018": "ADAM5678g5" },
  placed: { ZETA1234: ref("ZETA1234"), ADAM5678g5: ref("ADAM5678", 5) },
  items: { ZETA1234: ZETA, ADAM5678g5: ADAMS },
};

describe("exportCitedDocument", () => {
  it("cites each Item by the CSL id its source gave it", async () => {
    const running = run(CITED);
    await expect(running).resolves.toEqual({
      output: new Uint8Array([1, 2, 3]),
    });

    const [request] = running.ports.renderDocument.mock.calls[0] as [
      DocumentRequest,
    ];
    expect(
      JSON.parse(String(request.files?.[PANDOC_RESOLVE_MAP_FILENAME])),
    ).toEqual({
      citations: { "Zeta 2020": ZETA.id, "Adams 2018": ADAMS.id },
    });
    expect(request.bibliography).toEqual([ZETA, ADAMS]);
    expect(request.luaFilters).toEqual([pandocSandboxFilter]);
    expect(request.format).toBe("docx");
  });

  it("asks the source chain for every cited Item once", async () => {
    const running = run({
      ...CITED,
      links: [link("Zeta 2020"), link("Zeta 2020"), link("Adams 2018")],
    });
    await running;

    expect(running.ports.fetchBibliography).toHaveBeenCalledWith([
      ref("ZETA1234"),
      ref("ADAM5678", 5),
    ]);
  });

  it("converts a document that cites nothing without asking Zotero", async () => {
    const running = run({ links: [link("Some Note")] });
    await expect(running).resolves.toHaveProperty("output");

    expect(running.ports.fetchBibliography).not.toHaveBeenCalled();
    const [request] = running.ports.renderDocument.mock.calls[0] as [
      DocumentRequest,
    ];
    expect(
      JSON.parse(String(request.files?.[PANDOC_RESOLVE_MAP_FILENAME])),
    ).toEqual({ citations: {} });
  });

  it("carries the chosen style through to the engine", async () => {
    const running = run(CITED, { styleXml: "<style/>", format: "html" });
    await running;

    const [request] = running.ports.renderDocument.mock.calls[0] as [
      DocumentRequest,
    ];
    expect(request.styleXml).toBe("<style/>");
    expect(request.format).toBe("html");
  });

  it("stops on a citation fragment that names no literature note", async () => {
    const running = run({
      links: [link("Zeta 2020"), link("Meeting notes#cite:locator=7")],
      notes: { "Zeta 2020": "ZETA1234" },
      placed: { ZETA1234: ref("ZETA1234") },
      items: { ZETA1234: ZETA },
    });

    expect(failure(await running)).toEqual({
      kind: "citation-intent",
      linkpaths: ["Meeting notes"],
    });
    expect(running.ports.renderDocument).not.toHaveBeenCalled();
  });

  it("stops when the Zotero database cannot be read", async () => {
    const running = run({ ...CITED, databaseUnavailable: true });

    expect(failure(await running)).toEqual({
      kind: "database-unavailable",
      dataDir: "/Zotero",
    });
    expect(running.ports.fetchBibliography).not.toHaveBeenCalled();
  });

  it("stops when the database cannot place a cited Item", async () => {
    const running = run({ ...CITED, placed: { ZETA1234: ref("ZETA1234") } });

    expect(failure(await running)).toEqual({
      kind: "items-missing",
      linkpaths: ["Adams 2018"],
    });
    expect(running.ports.renderDocument).not.toHaveBeenCalled();
  });

  it("names the notes behind the Items Zotero returned nothing for", async () => {
    const running = run({
      ...CITED,
      bibliographyFailure: {
        code: "items-missing",
        source: "local-api",
        indexedKeys: ["ADAM5678g5"],
      },
    });

    expect(failure(await running)).toEqual({
      kind: "items-missing",
      linkpaths: ["Adams 2018"],
    });
  });

  it("names the notes Better BibTeX holds no citation key for", async () => {
    const running = run({
      ...CITED,
      bibliographyFailure: {
        code: "citation-key-missing",
        indexedKeys: ["ZETA1234"],
      },
    });

    expect(failure(await running)).toEqual({
      kind: "citation-keys-missing",
      linkpaths: ["Zeta 2020"],
    });
  });

  it("passes a closed Zotero and a disabled local API through", async () => {
    expect(
      failure(
        await run({
          ...CITED,
          bibliographyFailure: { code: "zotero-not-running", port: 23119 },
        }),
      ),
    ).toEqual({ kind: "zotero-not-running", port: 23119 });

    expect(
      failure(
        await run({
          ...CITED,
          bibliographyFailure: {
            code: "local-api-disabled",
            pref: "httpServer.localAPI.enabled",
          },
        }),
      ),
    ).toEqual({
      kind: "local-api-disabled",
      pref: "httpServer.localAPI.enabled",
    });
  });

  it("reports a source that answered and refused", async () => {
    expect(
      failure(
        await run({
          ...CITED,
          bibliographyFailure: {
            code: "source-failed",
            source: "better-bibtex",
            detail: "no such translator",
          },
        }),
      ),
    ).toEqual({
      kind: "source-failed",
      source: "better-bibtex",
      detail: "no such translator",
    });
  });

  it("reports a conversion Pandoc refused", async () => {
    expect(
      failure(await run({ ...CITED, engineError: "unknown writer" })),
    ).toEqual({ kind: "engine", detail: "unknown writer" });
  });
});

/**
 * The binary the plugin pins, read straight out of `pandoc-wasm`. The package
 * resolves through its `node` condition, so its entry sits beside `pandoc.wasm`.
 */
const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

/** Every citation shape at once: plain, fragment, run, literal, ordinary link. */
const DEMO_MARKDOWN = `Plain [[Zeta 2020]] and fragment [[Adams 2018#cite:locator=33]].

A run [[Zeta 2020]]; [[Adams 2018]] here.

Literal @zeta2020 too.

Ordinary [[Some Note]] stays a link.
`;

const DEMO: Fixture = {
  ...CITED,
  links: [
    link("Zeta 2020"),
    link("Adams 2018#cite:locator=33"),
    link("Zeta 2020"),
    link("Adams 2018"),
    link("Some Note"),
  ],
};

/**
 * The body text of a docx. Only `<w:t>` elements hold text nodes, so dropping
 * every tag joins the runs Word splits one sentence across.
 */
function docxText(docx: Uint8Array): string {
  const body = unzipSync(docx)["word/document.xml"];
  return new TextDecoder().decode(body).replaceAll(/<[^>]*>/g, "");
}

describe(
  "exportCitedDocument over the real engine",
  { timeout: 60_000 },
  () => {
    it("cites the demo note through the bundled sandbox filter", async () => {
      await using engine = await createCitationEngine(
        await readFile(WASM_PATH),
      );
      const result = await exportCitedDocument(
        {
          document: { sourcePath: SOURCE, links: DEMO.links ?? [] },
          markdown: DEMO_MARKDOWN,
          format: "html",
        },
        { ...ports(DEMO), engine },
      );

      expect(result).toHaveProperty("output");
      // Pandoc's HTML writer wraps lines, so match on collapsed whitespace.
      const html = new TextDecoder()
        .decode((result as { output: Uint8Array }).output)
        .replaceAll(/\s+/g, " ");
      // The fragment's locator, the run's two keys, and the literal key.
      expect(html).toContain("(Adams 2018, 33)");
      expect(html).toContain(`data-cites="${ZETA.id} ${ADAMS.id}"`);
      expect(html).toContain(`data-cites="${ZETA.id}">Zeta (2020)`);
      expect(html).toContain('<a href="Some Note" class="wikilink">');
      expect(html).toContain(`id="ref-${ZETA.id}"`);
      expect(html).toContain(`id="ref-${ADAMS.id}"`);
    });

    it("cites the same note in the docx it writes", async () => {
      await using engine = await createCitationEngine(
        await readFile(WASM_PATH),
      );
      const result = await exportCitedDocument(
        {
          document: { sourcePath: SOURCE, links: DEMO.links ?? [] },
          markdown: DEMO_MARKDOWN,
          format: "docx",
        },
        { ...ports(DEMO), engine },
      );

      expect(result).toHaveProperty("output");
      const output = (result as { output: Uint8Array }).output;
      // docx is a zip container; its local file header starts every archive.
      expect(output.slice(0, 4)).toEqual(
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      );

      const text = docxText(output);
      // Every citation shape renders, and the ordinary link stays plain text.
      expect(text).toContain(
        "Plain (Zeta 2020) and fragment (Adams 2018, 33).",
      );
      expect(text).toContain("A run (Zeta 2020; Adams 2018) here.");
      expect(text).toContain("Literal Zeta (2020) too.");
      expect(text).toContain("Ordinary Some Note stays a link.");
      // Both cited Items reach the bibliography, and nothing else does.
      expect(text).toContain("Zeta, Ann. 2020. A Study of Nothing.");
      expect(text).toContain("Adams, Bob. 2018. Beta and Beyond.");
    });
  },
);
