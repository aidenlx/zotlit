// @vitest-environment happy-dom
import type { MarkdownPostProcessor, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import type { Citation } from "@/services/citation-index/service";
import {
  ALPHA,
  ALPHA_KEY,
  citation,
  fragment,
  literalOccurrences,
} from "@/services/citation-text/__fixtures__";
import { CitationText } from "@/services/citation-text/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { CitekeyReading } from "./service";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    // The stub client runs no queries; these three are the whole read path from
    // an Indexed Key to the Item the citation names.
    getZoteroIdentity: () => ({
      userID: 1,
      localUserKey: null,
      username: null,
    }),
    resolveIndexedKeyLibrary: vi.fn(),
    getItemsByKey: vi.fn(),
  };
});

/** One rendered section, as a Markdown post-processor receives it. */
function section(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

interface Harness {
  process: MarkdownPostProcessor;
  citationRequests: { citations: readonly string[] }[];
  dispose: () => Promise<void>;
}

async function makeHarness({
  body,
  cited = [citation("alpha", ALPHA_KEY)],
  formats = true,
  overrides = {},
}: {
  body: string;
  cited?: Citation[];
  /** Whether an engine is installed, which is what the cache answers for. */
  formats?: boolean;
  overrides?: Partial<Settings>;
}): Promise<Harness> {
  const citationRequests: { citations: readonly string[] }[] = [];
  const occurrences = literalOccurrences(body);
  let process: MarkdownPostProcessor | undefined;

  const citationText = new CitationText({
    app: {
      vault: { cachedRead: () => Promise.resolve(body) },
      metadataCache: {
        on: () => ({ e: { offref: () => undefined } }),
        getFileCache: () => ({}),
      },
    },
    db: { state: "ready", client: {} },
    citationIndex: {
      getDocumentCitationSet: () =>
        Promise.resolve({ occurrences, citations: cited }),
      citekeyOf: () => null,
      whenResolved: () => Promise.resolve(),
      on: () => () => undefined,
    },
    noteIndex: {
      on: () => () => undefined,
      whenIndexed: () => Promise.resolve(),
    },
    bibliographyRender: {
      renderCitations: (citations: readonly string[]) => {
        citationRequests.push({ citations });
        return Promise.resolve(
          formats ? citations.map((source) => fragment(`«${source}»`)) : null,
        );
      },
      on: () => () => undefined,
    },
    settings: {
      ready: Promise.resolve(),
      subscribe: (cb: (next: Readonly<Settings>) => void) => {
        cb(defaults);
        return () => undefined;
      },
    },
  } as never);
  await citationText.ready;

  const service = new CitekeyReading({
    app: {
      vault: { getFileByPath: (path: string) => ({ path }) as TFile },
      workspace: { getLeavesOfType: () => [] },
    },
    plugin: {
      registerMarkdownPostProcessor: (postProcessor: MarkdownPostProcessor) => {
        process = postProcessor;
        return postProcessor;
      },
    },
    citationText,
    citekeyEditor: {
      openCitekey: () => Promise.resolve(),
      hoverNotePath: () => null,
    },
    settings: settingsStub(overrides),
  } as never);
  await service.ready;

  return {
    process: process!,
    citationRequests,
    dispose: async () => {
      await service[Symbol.asyncDispose]();
      await citationText[Symbol.asyncDispose]();
    },
  };
}

beforeEach(() => {
  vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
    libraryID: 1,
    key: "ALPHA123",
  });
  vi.mocked(getItemsByKey).mockReturnValue([ALPHA as never]);
});

describe("CitekeyReading", () => {
  it("puts the engine's formatted citation in the source's place", async () => {
    const { process, dispose } = await makeHarness({
      body: "Blah [see @alpha, p. 3] blah.",
    });
    const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

    await process(el, { sourcePath: "note.md" } as never);

    expect(el.textContent).toBe("Blah «[see @alpha, p. 3]» blah.");
    expect(el.querySelector("span.zt-citation")).not.toBeNull();
    await dispose();
  });

  it("shows the item summary when no engine formats the citation", async () => {
    const { process, dispose } = await makeHarness({
      body: "Blah [see @alpha, p. 3] blah.",
      formats: false,
    });
    const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

    await process(el, { sourcePath: "note.md" } as never);

    expect(el.textContent).toBe("Blah [see Zeta (2020), p. 3] blah.");
    await dispose();
  });

  it("leaves a citekey no Literature Note carries as written", async () => {
    const { process, dispose } = await makeHarness({
      body: "@ghost blah.",
      cited: [citation("ghost", null)],
    });
    const el = section("<p>@ghost blah.</p>");

    await process(el, { sourcePath: "note.md" } as never);

    expect(el.textContent).toBe("@ghost blah.");
    await dispose();
  });

  it("exposes the literal theme hooks for each literal Citation resolution state", async () => {
    const cases = [
      {
        body: "[@alpha]",
        cited: [citation("alpha", ALPHA_KEY)],
        classes: ["zt-citation", "zt-citation-key"],
      },
      {
        body: "[@alpha; @ghost]",
        cited: [citation("alpha", ALPHA_KEY), citation("ghost", null)],
        classes: [
          "zt-citation",
          "zt-citation-key",
          "zt-citation-key-partially-unresolved",
        ],
      },
      {
        body: "[@ghost]",
        cited: [citation("ghost", null)],
        classes: [
          "zt-citation",
          "zt-citation-key",
          "zt-citation-key-unresolved",
        ],
      },
    ];
    for (const { body, cited, classes } of cases) {
      const { process, dispose } = await makeHarness({ body, cited });
      const el = section(`<p>${body}</p>`);

      await process(el, { sourcePath: "note.md" } as never);

      const rendered = el.querySelector("span");
      for (const className of classes) {
        expect(rendered?.classList.contains(className)).toBe(true);
      }
      await dispose();
    }
  });

  it("leaves the reading view alone while the treatment is off", async () => {
    for (const overrides of [
      { "citation.citekey-editor": false },
      { "citation.citekey-indexing": false },
    ]) {
      const { process, dispose } = await makeHarness({
        body: "Blah [@alpha].",
        overrides,
      });
      const el = section("<p>Blah [@alpha].</p>");

      await process(el, { sourcePath: "note.md" } as never);

      expect(el.textContent).toBe("Blah [@alpha].");
      expect(el.querySelector(".zt-citation-key")).toBeNull();
      await dispose();
    }
  });

  // Sidebar occurrence navigation flashes the block element the line sits in,
  // so the swap has to stay inside that element and leave it in place.
  it("keeps the block element a reading-view flash targets", async () => {
    const { process, dispose } = await makeHarness({
      body: "Blah [@alpha] blah.",
    });
    const el = section("<p>Blah [@alpha] blah.</p>");
    const block = el.firstElementChild!;

    await process(el, { sourcePath: "note.md" } as never);

    expect(el.children).toHaveLength(1);
    expect(el.firstElementChild).toBe(block);
    expect(block.querySelector("span.zt-citation")).not.toBeNull();
    await dispose();
  });

  it("formats a document once for every section that asks", async () => {
    const { process, citationRequests, dispose } = await makeHarness({
      body: "One [@alpha].\n\nTwo [@alpha].",
    });

    await process(section("<p>One [@alpha].</p>"), {
      sourcePath: "note.md",
    } as never);
    await process(section("<p>Two [@alpha].</p>"), {
      sourcePath: "note.md",
    } as never);

    expect(citationRequests).toHaveLength(1);
    await dispose();
  });
});

/** Hands out one settings snapshot, the way the service reads its toggles. */
function settingsStub(overrides: Partial<Settings>): {
  ready: Promise<void>;
  subscribe: (listener: (settings: Readonly<Settings>) => void) => () => void;
} {
  const current: Readonly<Settings> = { ...defaults, ...overrides };
  return {
    ready: Promise.resolve(),
    subscribe: (listener) => {
      listener(current);
      return () => undefined;
    },
  };
}
