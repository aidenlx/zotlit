// @vitest-environment happy-dom
import { Keymap, MarkdownView } from "obsidian";
import type { MarkdownPostProcessor } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { occurrences, rendered } from "@/services/citation-text/__fixtures__";
import { citationKey } from "@/services/citation-text/present";
import type { FormattedOccurrence } from "@/services/citation-text/present";
import type {
  CitationHoverRequest,
  NavigationPane,
} from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { internalLink, section } from "./__fixtures__/internal-link";
import { WikilinkReading } from "./service";

/** The one Literature Note the metadata-cache stand-in knows. */
const WANG = "literatures/wangMutationalClinicalSpectrum2020a";
/** The Indexed Key that note carries, which the shared text holds its Citations under. */
const WANG_KEY = "ABCD2345";

/** One Citation as the shared text holds it: its Pandoc source, and the works it names. */
function held(source: string, works: string[] = [WANG_KEY]): string {
  return citationKey({ source, works });
}

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
  /** Every Citation Popover the surface asked for. */
  requests: CitationHoverRequest[];
  /** Every Literature Note the popover's own open action reached for. */
  opened: [citekey: string, pane: NavigationPane][];
  /** Every gesture Obsidian's own delegated listeners would have answered. */
  native: MouseEvent[];
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
  /** The formatted citation the shared text holds, by its {@link held} identity. */
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
    citekeys ?? { [WANG_KEY]: "wang2020" },
  );
  const requests: CitationHoverRequest[] = [];
  const opened: [citekey: string, pane: NavigationPane][] = [];
  const native: MouseEvent[] = [];
  let rerenders = 0;
  let process: MarkdownPostProcessor | undefined;
  // The reading view a rendered section sits in, which Obsidian hangs both the
  // popover and its own delegated hover and click off.
  const containerEl = document.createElement("div");
  containerEl.addEventListener("mouseover", (event) => native.push(event));
  containerEl.addEventListener("click", (event) => native.push(event));
  // Obsidian places a section of this stubbed document nowhere, which is the
  // degraded tier: every Citation shows its source's first-occurrence text.
  const ctx = { sourcePath, getSectionInfo: () => null } as never;
  const view = Object.assign(Object.create(MarkdownView.prototype) as object, {
    previewMode: { rerender: () => rerenders++ },
    containerEl,
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
          frontmatter: { "zotero-key": WANG_KEY },
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
    citekeyEditor: {
      openCitekey: (citekey: string, pane: NavigationPane) =>
        opened.push([citekey, pane]),
    },
    citationPopover: {
      show: (request: CitationHoverRequest) => requests.push(request),
    },
    citationIndex,
    settings,
  } as never);
  await service.ready;
  return {
    settings,
    noteIndex,
    citationText,
    citationIndex,
    requests,
    opened,
    native,
    render: async (linktext) => {
      const root = containerEl.appendChild(
        section(`<p>${internalLink(linktext)}</p>`),
      );
      await process?.(root, ctx);
      return root.textContent ?? "";
    },
    renderSection: async (linktext, alias) => {
      const root = containerEl.appendChild(
        section(`<p>${internalLink(linktext, alias)}</p>`),
      );
      await process?.(root, ctx);
      return root;
    },
    renderHtml: async (html) => {
      const root = containerEl.appendChild(section(html));
      await process?.(root, ctx);
      return root;
    },
    beginRender: (linktext) => {
      const root = section(`<p>${internalLink(linktext)}</p>`);
      return {
        root,
        completion: Promise.resolve(process?.(root, ctx)),
      };
    },
    rerenders: () => rerenders,
    [Symbol.asyncDispose]: () => service[Symbol.asyncDispose](),
  };
}

describe("WikilinkReading rendering", () => {
  it("keeps inactive and excluded Literature Note links outside the hook", async () => {
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
      ).toBe(false);
    }
  });

  it("does not expose the Literature Note hook for an unresolved link", async () => {
    await using harnessed = await harness();

    const root = await harnessed.renderSection("notes/missing");

    expect(
      root.querySelector("a")?.classList.contains("zt-literature-note-link"),
    ).toBe(false);
  });

  it("keeps self subpaths outside the hook", async () => {
    await using inside = await harness({ sourcePath: `${WANG}.md` });
    await using outside = await harness({ sourcePath: "note.md" });

    expect(
      (await inside.renderSection("#Heading"))
        .querySelector("a")
        ?.classList.contains("zt-literature-note-link"),
    ).toBe(false);
    expect(
      (await outside.renderSection("#Heading"))
        .querySelector("a")
        ?.classList.contains("zt-literature-note-link"),
    ).toBe(false);
  });

  it("exposes both literal hooks when it renders a Literature Note Citation", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      formatted: { [held("[@wang2020, p. 7]")]: "(Wang et al. 2020, p. 7)" },
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
        [held("[@wang2020, p. 7; @wang2020, p. 9]", [WANG_KEY, WANG_KEY])]:
          "(Wang et al. 2020, pp. 7, 9)",
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

    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    expect(root.textContent).toBe(`${WANG} > cite:locator=7`);
    expect(root.querySelector(".zt-literature-note-link")).toBeNull();
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
      formatted: { [held("[@wang2020, p. 7]")]: "(Wang et al. 2020, p. 7)" },
    });

    expect(await harnessed.render(`${WANG}#cite:locator=7`)).toBe(
      "(Wang et al. 2020, p. 7)",
    );
  });

  it("keeps the native link while formatted citation presentation is off", async () => {
    await using harnessed = await harness({
      "citation.wikilink-citations": true,
      "citation.show-formatted": false,
      formatted: { [held("[@wang2020, p. 7]")]: "(Wang et al. 2020, p. 7)" },
    });

    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    expect(root.textContent).toBe(`${WANG} > cite:locator=7`);
    expect(root.querySelector(".zt-literature-note-link")).toBeNull();
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
    expect(root.querySelector(".zt-literature-note-link")).toBeNull();
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

describe("WikilinkReading hover", () => {
  /** One rendered Citation of a document whose text the style formatted. */
  const rendering = (overrides: Parameters<typeof harness>[0] = {}) =>
    harness({
      "citation.wikilink-citations": true,
      formatted: { [held("[@wang2020, p. 7]")]: "(Wang et al. 2020, p. 7)" },
      ...overrides,
    });

  /** Hovers the rendered Citation, as the pointer entering it does. */
  const hover = (root: HTMLElement) => {
    root
      .querySelector("a")
      ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  };

  it("shows the Citation Popover of the work a rendered Citation names", async () => {
    await using harnessed = await rendering();
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    hover(root);

    expect(harnessed.requests).toHaveLength(1);
    expect(harnessed.requests[0]).toMatchObject({
      targetEl: root.querySelector("a"),
      sourcePath: "note.md",
      works: [{ citekey: "wang2020", indexedKey: WANG_KEY }],
    });
  });

  it("keeps Obsidian's own hover out of a Citation the popover answers", async () => {
    await using harnessed = await rendering();
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    hover(root);

    expect(harnessed.native).toEqual([]);
  });

  it("leaves the hover to Obsidian under Page preview and Off", async () => {
    for (const action of ["page-preview", "off"] as const) {
      await using harnessed = await rendering({
        "citation.hover-action": action,
      });
      const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

      hover(root);

      expect(harnessed.requests).toEqual([]);
      expect(harnessed.native).toHaveLength(1);
    }
  });

  it("holds the hover back until Mod is held where Reading view asks for it", async () => {
    await using harnessed = await rendering({
      "citation.hover-require-mod-reading": true,
    });
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    hover(root);
    expect(harnessed.requests).toEqual([]);

    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    hover(root);
    expect(harnessed.requests).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("keeps Obsidian's own hover out while Require Mod holds the popover back", async () => {
    // Popover mode owns the gesture whole, so a bare hover it answers with
    // nothing shows nothing — never the page preview instead.
    await using harnessed = await rendering({
      "citation.hover-require-mod-reading": true,
    });
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    hover(root);

    expect(harnessed.requests).toEqual([]);
    expect(harnessed.native).toEqual([]);
  });

  it("leaves a link it rendered no Citation for hovering as Obsidian's own", async () => {
    await using harnessed = await rendering({ formatted: {} });
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    hover(root);

    expect(harnessed.requests).toEqual([]);
    expect(harnessed.native).toHaveLength(1);
  });
});

describe("WikilinkReading click", () => {
  /** One rendered Citation of a document whose text the style formatted. */
  const rendering = (overrides: Parameters<typeof harness>[0] = {}) =>
    harness({
      "citation.wikilink-citations": true,
      formatted: { [held("[@wang2020, p. 7]")]: "(Wang et al. 2020, p. 7)" },
      ...overrides,
    });

  /** Clicks the rendered Citation, and answers with the event it sent. */
  const click = (root: HTMLElement, init: MouseEventInit = {}) => {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    root.querySelector("a")?.dispatchEvent(event);
    return event;
  };

  it("swallows a plain click, and stops there", async () => {
    await using harnessed = await rendering();
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    const event = click(root);

    expect(harnessed.requests).toEqual([]);
    expect(harnessed.opened).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(harnessed.native).toEqual([]);
    // The anchor says as much, which is what neutralizes Obsidian's own link
    // cursor and hover colour on it.
    expect(root.querySelector("a")?.dataset.ztClick).toBe("none");
  });

  it("swallows a plain click under Page preview and Off", async () => {
    for (const action of ["page-preview", "off"] as const) {
      await using harnessed = await rendering({
        "citation.hover-action": action,
      });
      const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

      const event = click(root);

      expect(harnessed.requests).toEqual([]);
      expect(event.defaultPrevented).toBe(true);
      expect(harnessed.native).toEqual([]);
    }
  });

  it("leaves a Mod-click to Obsidian, which opens the note the link names", async () => {
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    await using harnessed = await rendering();
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    const event = click(root, { ctrlKey: true });

    expect(harnessed.requests).toEqual([]);
    expect(harnessed.opened).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(harnessed.native).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("leaves every click to Obsidian while Citations open as links", async () => {
    await using harnessed = await rendering({
      "citation.open-as-links": true,
    });
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    const event = click(root);

    expect(harnessed.requests).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(harnessed.native).toHaveLength(1);
    // Obsidian's own link styling stands untouched.
    expect(root.querySelector("a")?.dataset.ztClick).toBeUndefined();
  });

  it("leaves a link it rendered no Citation for clicking as Obsidian's own", async () => {
    await using harnessed = await rendering({ formatted: {} });
    const root = await harnessed.renderSection(`${WANG}#cite:locator=7`);

    click(root);

    expect(harnessed.requests).toEqual([]);
    expect(harnessed.native).toHaveLength(1);
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

  it("renders again when a setting changes who answers a gesture", async () => {
    await using harnessed = await harness();
    const { settings, rerenders } = harnessed;

    settings.update({ "citation.hover-action": "off" });
    expect(rerenders()).toBe(1);

    settings.update({ "citation.open-as-links": true });
    expect(rerenders()).toBe(2);
    settings.update({ "citation.open-as-links": false });
    expect(rerenders()).toBe(3);

    // Which mode holds a hover back for a modifier is read at hover time, so
    // nothing rendered depends on it.
    settings.update({ "citation.hover-require-mod-reading": true });
    expect(rerenders()).toBe(3);
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

    harnessed.settings.update({ "citation.open-as-links": false });
    expect(harnessed.rerenders()).toBe(0);
  });

  it("renders again on disposal, which drops the treatment's own text", async () => {
    const harnessed = await harness();
    await harnessed[Symbol.asyncDispose]();

    expect(harnessed.rerenders()).toBe(1);
  });
});

/** What the stub holds for one document, as a surface reads it. */
interface HeldText {
  formatted: Map<string, FormattedOccurrence[]>;
  summaries: Map<string, string>;
}

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

  load(): Promise<HeldText> {
    if (this.#pending) return new Promise(() => undefined);
    return Promise.resolve(this.#text());
  }

  peek(): HeldText | null {
    return this.#pending ? null : this.#text();
  }

  #text(): HeldText {
    const formatted = new Map<string, FormattedOccurrence[]>();
    for (const [source, text] of Object.entries(this.#formatted)) {
      formatted.set(source, occurrences(rendered(text)));
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
