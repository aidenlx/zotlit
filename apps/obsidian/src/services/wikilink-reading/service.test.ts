// @vitest-environment happy-dom
import { MarkdownView } from "obsidian";
import type { MarkdownPostProcessor } from "obsidian";
import { describe, expect, it } from "vitest";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { internalLink, section } from "./__fixtures__/internal-link";
import { WikilinkReading } from "./service";

/** The one Literature Note the metadata-cache stand-in knows. */
const WANG = "literatures/wangMutationalClinicalSpectrum2020a";

interface Harness extends AsyncDisposable {
  settings: SettingsStub;
  noteIndex: NoteIndexStub;
  citationText: CitationTextStub;
  citationIndex: CitationIndexStub;
  /** Runs the registered post-processor over one link and reads its display. */
  render: (linktext: string) => Promise<string>;
  rerenders: () => number;
}

async function harness({
  formatted,
  citekeys,
  ...overrides
}: Partial<Settings> & {
  /** The formatted citation the shared text holds, by its Pandoc source. */
  formatted?: Record<string, string>;
  /** The citekey resolution snapshot's answer for each Indexed Key. */
  citekeys?: Record<string, string>;
} = {}): Promise<Harness> {
  const settings = new SettingsStub(overrides);
  const noteIndex = new NoteIndexStub();
  const citationText = new CitationTextStub(formatted ?? {});
  const citationIndex = new CitationIndexStub(
    citekeys ?? { ABCD2345: "wang2020" },
  );
  let rerenders = 0;
  let process: MarkdownPostProcessor | undefined;
  const view = Object.assign(Object.create(MarkdownView.prototype) as object, {
    previewMode: { rerender: () => rerenders++ },
  });
  const service = new WikilinkReading({
    app: {
      workspace: { getLeavesOfType: () => [{ view }] },
      vault: { getFileByPath: (path: string) => ({ path }) },
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) =>
          linkpath === WANG ? { path: `${WANG}.md` } : null,
        getFileCache: () => ({
          frontmatter: { "zotero-key": "ABCD2345" },
        }),
      },
    },
    plugin: {
      registerMarkdownPostProcessor: (postProcessor: MarkdownPostProcessor) => {
        process = postProcessor;
      },
    },
    noteIndex,
    citationText,
    citationIndex,
    settings,
  } as never);
  await service.ready;
  return {
    settings,
    noteIndex,
    citationText,
    citationIndex,
    render: async (linktext) => {
      const root = section(`<p>${internalLink(linktext)}</p>`);
      await process?.(root, { sourcePath: "note.md" } as never);
      return root.textContent ?? "";
    },
    rerenders: () => rerenders,
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

describe("WikilinkReading rendering", () => {
  it("shows a fragment-carrying link as its Citation Display Text", async () => {
    await using harnessed = await harness();

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      "[@wang2020, p. 7]",
    );
  });

  it("shows a fragment-less link under both wikilink toggles", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
    });

    expect(await harnessed.render(WANG)).toBe("@wang2020");
  });

  it("leaves a fragment-less link raw while Wikilink Citations is off", async () => {
    await using harnessed = await harness();

    expect(await harnessed.render(WANG)).toBe(WANG);
  });

  it("shows a fragment-carrying link whatever the toggles say", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
      "citation.wikilink-display": false,
    });

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      "[@wang2020, p. 7]",
    );
  });

  it("falls back to the filename when the Item carries no native citation key", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      citekeys: {},
    });

    expect(await harnessed.render(WANG)).toBe(
      "@wangMutationalClinicalSpectrum2020a",
    );
  });

  it("shows the citation a style formatted once the shared text holds one", async () => {
    await using harnessed = await harness({
      formatted: { "[@wang2020, p. 7]": "(Wang et al. 2020, p. 7)" },
    });

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      "(Wang et al. 2020, p. 7)",
    );
  });

  it("leaves a link that names no Literature Note alone", async () => {
    await using harnessed = await harness();

    expect(await harnessed.render("notes/plain")).toBe("notes/plain");
  });

  it("leaves the reading views alone once the treatment is retired", async () => {
    const harnessed = await harness();
    await harnessed[Symbol.asyncDispose]();

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      `${WANG} > cite:locator=7`,
    );
  });
});

describe("WikilinkReading rerender", () => {
  it("renders every reading view again when a Literature Note changes", async () => {
    await using harnessed = await harness();
    const { noteIndex, rerenders } = harnessed;

    noteIndex.emit("changed");
    expect(rerenders()).toBe(1);

    noteIndex.emit("rebuilt");
    expect(rerenders()).toBe(2);
  });

  it("renders again when a gating setting changes", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
    });
    const { settings, rerenders } = harnessed;

    settings.update({ "citation.wikilink-citations": true });
    expect(rerenders()).toBe(1);

    settings.update({ "citation.wikilink-display": false });
    expect(rerenders()).toBe(2);
  });

  it("renders every reading view again when the citekey resolution snapshot rebuilds", async () => {
    await using harnessed = await harness();
    const { citationIndex, rerenders } = harnessed;

    citationIndex.emit();
    expect(rerenders()).toBe(1);
  });

  it("renders again when the shared citation text goes stale", async () => {
    await using harnessed = await harness();

    harnessed.citationText.emit();
    expect(harnessed.rerenders()).toBe(1);
  });

  it("leaves the reading views alone when an unrelated setting changes", async () => {
    await using harnessed = await harness();

    harnessed.settings.update({ "citation.citekey-editor": false });
    expect(harnessed.rerenders()).toBe(0);
  });

  it("renders again on disposal, which drops the treatment's own text", async () => {
    const harnessed = await harness();
    await harnessed[Symbol.asyncDispose]();

    expect(harnessed.rerenders()).toBe(1);
  });
});

class CitationTextStub {
  readonly #formatted: Record<string, string>;
  readonly #listeners = new Set<() => void>();

  constructor(formatted: Record<string, string>) {
    this.#formatted = formatted;
  }

  load(): Promise<{
    formatted: Map<string, DocumentFragment>;
    summaries: Map<string, string>;
  }> {
    const formatted = new Map<string, DocumentFragment>();
    for (const [source, text] of Object.entries(this.#formatted)) {
      const content = document.createDocumentFragment();
      content.append(text);
      formatted.set(source, content);
    }
    return Promise.resolve({ formatted, summaries: new Map() });
  }

  on(_event: "invalidated", cb: () => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  emit(): void {
    for (const cb of this.#listeners) cb();
  }
}

class NoteIndexStub {
  readonly #listeners: Record<"changed" | "rebuilt", Set<() => void>> = {
    changed: new Set(),
    rebuilt: new Set(),
  };

  on(event: "changed" | "rebuilt", cb: () => void): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  emit(event: "changed" | "rebuilt"): void {
    for (const cb of this.#listeners[event]) cb();
  }
}

class CitationIndexStub {
  readonly #citekeys: Record<string, string>;
  readonly #listeners = new Set<() => void>();

  constructor(citekeys: Record<string, string>) {
    this.#citekeys = citekeys;
  }

  citekeyOf(indexedKey: string): string | null {
    return this.#citekeys[indexedKey] ?? null;
  }

  on(_event: "resolution-changed", cb: () => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  emit(): void {
    for (const cb of this.#listeners) cb();
  }
}

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
