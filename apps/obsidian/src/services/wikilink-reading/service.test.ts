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
  /** Runs the registered post-processor and returns the rendered section. */
  renderSection: (linktext: string, alias?: string) => Promise<HTMLElement>;
  /** Runs the registered post-processor over an arbitrary rendered section. */
  renderHtml: (html: string) => Promise<HTMLElement>;
  /** Starts a post-processor pass without waiting for citation text. */
  beginRender: (linktext: string) => {
    root: HTMLElement;
    completion: Promise<void>;
  };
  rerenders: () => number;
}

async function harness({
  formatted,
  citekeys,
  sourcePath = "note.md",
  pending,
  ...overrides
}: Partial<Settings> & {
  /** The formatted citation the shared text holds, by its Pandoc source. */
  formatted?: Record<string, string>;
  /** Keep the citation-text read pending. */
  pending?: boolean;
  /** The citekey resolution snapshot's answer for each Indexed Key. */
  citekeys?: Record<string, string>;
  /** The file that owns each rendered section. */
  sourcePath?: string;
} = {}): Promise<Harness> {
  const settings = new SettingsStub(overrides);
  const noteIndex = new NoteIndexStub();
  const citationText = new CitationTextStub(formatted ?? {}, pending);
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
        getFirstLinkpathDest: (linkpath: string, origin: string) =>
          linkpath === WANG || (linkpath === "" && origin === `${WANG}.md`)
            ? { path: `${WANG}.md` }
            : null,
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
      await process?.(root, { sourcePath } as never);
      return root.textContent ?? "";
    },
    renderSection: async (linktext, alias) => {
      const root = section(`<p>${internalLink(linktext, alias)}</p>`);
      await process?.(root, { sourcePath } as never);
      return root;
    },
    renderHtml: async (html) => {
      const root = section(html);
      await process?.(root, { sourcePath } as never);
      return root;
    },
    beginRender: (linktext) => {
      const root = section(`<p>${internalLink(linktext)}</p>`);
      return {
        root,
        completion: Promise.resolve(process?.(root, { sourcePath } as never)),
      };
    },
    rerenders: () => rerenders,
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

describe("WikilinkReading rendering", () => {
  it("exposes the literal Literature Note hook independently of display settings", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
      "citation.show-formatted": false,
    });

    for (const [linktext, alias] of [
      [WANG, undefined],
      [`${WANG}#Heading`, undefined],
      [`${WANG}#^block-id`, undefined],
      [WANG, "A literature note"],
    ] as const) {
      const root = await harnessed.renderSection(linktext, alias);
      expect(
        root.querySelector("a")?.classList.contains("zt-literature-note-link"),
      ).toBe(true);
    }
  });

  it("does not expose the Literature Note hook for an unresolved link", async () => {
    await using harnessed = await harness();

    const root = await harnessed.renderSection("notes/missing");

    expect(
      root.querySelector("a")?.classList.contains("zt-literature-note-link"),
    ).toBe(false);
  });

  it("classifies a self subpath only inside a Literature Note", async () => {
    await using inside = await harness({ sourcePath: `${WANG}.md` });
    await using outside = await harness({ sourcePath: "note.md" });

    expect(
      (await inside.renderSection("#Heading"))
        .querySelector("a")
        ?.classList.contains("zt-literature-note-link"),
    ).toBe(true);
    expect(
      (await outside.renderSection("#Heading"))
        .querySelector("a")
        ?.classList.contains("zt-literature-note-link"),
    ).toBe(false);
  });

  it("exposes both literal hooks when it renders a Literature Note Citation", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      formatted: { "[@wang2020, p. 7]": "(Wang et al. 2020, p. 7)" },
    });

    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);
    const rendered = root.querySelector("a");

    expect(rendered?.classList.contains("zt-citation")).toBe(true);
    expect(rendered?.classList.contains("zt-literature-note-link")).toBe(true);
  });

  it("exposes the combined literal hooks once on a rendered Citation Run", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      formatted: {
        "[@wang2020, p. 7; @wang2020, p. 9]": "(Wang et al. 2020, pp. 7, 9)",
      },
    });
    const root = await harnessed.renderHtml(
      `<p>${internalLink(`${WANG}#cite:locator=7`)}; ${internalLink(`${WANG}#cite:locator=9`)}</p>`,
    );

    const rendered = root.querySelectorAll("a");
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.classList.contains("zt-citation")).toBe(true);
    expect(rendered[0]?.classList.contains("zt-literature-note-link")).toBe(
      true,
    );
  });

  it("keeps a fragment-carrying link native without a formatted result", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
    });

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      `${WANG} > cite:locator=7`,
    );
  });

  it("keeps a fragment-less link native without a formatted result", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
    });

    expect(await harnessed.render(WANG)).toBe(WANG);
  });

  it("leaves a fragment-less link raw while Wikilink Citations is off", async () => {
    await using harnessed = await harness();

    expect(await harnessed.render(WANG)).toBe(WANG);
  });

  it("leaves a fragment-carrying link native while Wikilink Citations is off", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": false,
      "citation.show-formatted": false,
    });

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      `${WANG} > cite:locator=7`,
    );
  });

  it("keeps a native link when the Item carries no native citation key", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      citekeys: {},
    });

    expect(await harnessed.render(WANG)).toBe(WANG);
  });

  it("shows the citation a style formatted once the shared text holds one", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      formatted: { "[@wang2020, p. 7]": "(Wang et al. 2020, p. 7)" },
    });

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      "(Wang et al. 2020, p. 7)",
    );
  });

  it("keeps the native link while formatted citation presentation is off", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      "citation.show-formatted": false,
      formatted: { "[@wang2020, p. 7]": "(Wang et al. 2020, p. 7)" },
    });

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      `${WANG} > cite:locator=7`,
    );
  });

  it("keeps the native link visible while citation text is pending", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      pending: true,
    });

    const { root, completion } = harnessed.beginRender(
      `${WANG}#cite:locator=7`,
    );
    let completed = false;
    void completion.then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(true);
    expect(root.textContent).toBe(`${WANG} > cite:locator=7`);
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

    settings.update({ "citation.show-formatted": false });
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

  it("renders again when pending citation text settles", async () => {
    await using harnessed = await harness();

    harnessed.citationText.emit("changed");
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
  readonly #pending: boolean;
  readonly #listeners: Record<"changed" | "invalidated", Set<() => void>> = {
    changed: new Set(),
    invalidated: new Set(),
  };

  constructor(formatted: Record<string, string>, pending = false) {
    this.#formatted = formatted;
    this.#pending = pending;
  }

  load(): Promise<{
    formatted: Map<string, DocumentFragment>;
    summaries: Map<string, string>;
  }> {
    if (this.#pending) return new Promise(() => undefined);
    return Promise.resolve(this.#text());
  }

  peek(): {
    formatted: Map<string, DocumentFragment>;
    summaries: Map<string, string>;
  } | null {
    return this.#pending ? null : this.#text();
  }

  #text(): {
    formatted: Map<string, DocumentFragment>;
    summaries: Map<string, string>;
  } {
    const formatted = new Map<string, DocumentFragment>();
    for (const [source, text] of Object.entries(this.#formatted)) {
      const content = document.createDocumentFragment();
      content.append(text);
      formatted.set(source, content);
    }
    return { formatted, summaries: new Map() };
  }

  on(event: "changed" | "invalidated", cb: () => void): () => void {
    this.#listeners[event].add(cb);
    return () => this.#listeners[event].delete(cb);
  }

  emit(event: "changed" | "invalidated" = "invalidated"): void {
    for (const cb of this.#listeners[event]) cb();
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
