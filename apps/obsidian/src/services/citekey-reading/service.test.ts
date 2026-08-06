// @vitest-environment happy-dom
import { type MarkdownPostProcessor, type TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import { type Citation } from "@/services/citation-index/service";
import { defaults, type Settings } from "@/services/settings/schema";

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

const ALPHA_KEY = "1/ALPHA123";

/** The one Item the stubbed database answers with. */
const ALPHA = {
  key: "ALPHA123",
  itemID: 1,
  groupID: null,
  indexedKey: ALPHA_KEY,
  creators: [{ creatorType: "author", lastName: "Zeta", firstName: "Ann" }],
  primaryCreatorType: "author",
  customFields: [],
  fields: {
    itemType: "book",
    title: "A study of nothing",
    date: "2020",
  },
};

function citation(citekey: string, indexedKey: string | null): Citation {
  return {
    indexedKey,
    linkpath: indexedKey === null ? null : "Zeta 2020",
    refNumber: 1,
    occurrences: [
      {
        kind: "citekey",
        raw: citekey,
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 0, offset: 0 },
        },
      },
    ],
  };
}

/** One rendered section, as a Markdown post-processor receives it. */
function section(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

function fragment(text: string): DocumentFragment {
  const content = document.createDocumentFragment();
  content.append(text);
  return content;
}

interface Harness {
  process: MarkdownPostProcessor;
  citationRequests: { citations: readonly string[] }[];
  settings: SettingsStub;
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
  const settings = new SettingsStub(overrides);
  let process: MarkdownPostProcessor | undefined;

  const service = new CitekeyReading({
    app: {
      vault: {
        getFileByPath: (path: string) => ({ path }) as TFile,
        cachedRead: () => Promise.resolve(body),
      },
      metadataCache: { on: () => ({ e: { offref: () => undefined } }) },
      workspace: { getLeavesOfType: () => [] },
    },
    plugin: {
      registerMarkdownPostProcessor: (postProcessor: MarkdownPostProcessor) => {
        process = postProcessor;
        return postProcessor;
      },
    },
    db: { state: "ready", client: {} },
    citationIndex: {
      getCitations: () => Promise.resolve(cited),
      on: () => () => undefined,
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
    settings,
  } as never);
  await service.ready;

  return {
    process: process!,
    citationRequests,
    settings,
    dispose: () => service[Symbol.asyncDispose](),
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

  it("formats every citation of the document, not only the section's", async () => {
    const { process, citationRequests, dispose } = await makeHarness({
      body: "First @alpha.\n\nThen [@alpha].",
    });

    await process(section("<p>Then [@alpha].</p>"), {
      sourcePath: "note.md",
    } as never);

    expect(citationRequests).toEqual([{ citations: ["@alpha", "[@alpha]"] }]);
    await dispose();
  });

  it("reads no citation out of a code block", async () => {
    const { process, citationRequests, dispose } = await makeHarness({
      body: "```\n[@alpha]\n```\n\nReal [@alpha] here.",
    });

    await process(section("<p>Real [@alpha] here.</p>"), {
      sourcePath: "note.md",
    } as never);

    expect(citationRequests).toEqual([{ citations: ["[@alpha]"] }]);
    await dispose();
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
      await dispose();
    }
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

class SettingsStub {
  current: Readonly<Settings>;
  readonly ready = Promise.resolve();
  readonly #listeners = new Set<
    (settings: Readonly<Settings> | null) => void
  >();

  constructor(overrides: Partial<Settings> = {}) {
    this.current = { ...defaults, ...overrides };
  }

  subscribe(
    listener: (settings: Readonly<Settings> | null) => void,
  ): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  update(overrides: Partial<Settings>): void {
    this.current = { ...this.current, ...overrides };
    for (const listener of this.#listeners) listener(this.current);
  }
}
