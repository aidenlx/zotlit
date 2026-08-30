// @vitest-environment happy-dom
import { Keymap, MarkdownView } from "obsidian";
import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  TFile,
} from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import type { Citation } from "@/services/citation-index/service";
import {
  ALPHA,
  ALPHA_KEY,
  citation,
  literalOccurrences,
  rendered,
} from "@/services/citation-text/__fixtures__";
import { CitationText } from "@/services/citation-text/service";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { profileReader } from "@/services/profile/__fixtures__/reader";
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

/**
 * Places one rendered section in a Markdown view, which is what a popover hangs
 * in, and answers with the context that section is processed under.
 */
function viewedCtx(
  harness: Harness,
  el: HTMLElement,
): MarkdownPostProcessorContext {
  harness.views.push(
    Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
      containerEl: el,
      previewMode: { rerender: () => undefined },
    }),
  );
  return harness.ctx;
}

interface Harness extends AsyncDisposable {
  process: MarkdownPostProcessor;
  /**
   * The context Obsidian hands a post-processor for the body lines `lines`
   * covers, or for a section it places nowhere — an embed, a popover.
   */
  sectionCtx: (
    lines: { from: number; to: number } | null,
  ) => MarkdownPostProcessorContext;
  /** {@link sectionCtx} over the whole body, which is one section for most suites. */
  ctx: MarkdownPostProcessorContext;
  citationRequests: { citations: readonly string[] }[];
  /** The Markdown views the workspace holds, which a hover result hangs in. */
  views: MarkdownView[];
  /** Every popover the rendered citations of this harness asked for. */
  popoverRequests: CitationHoverRequest[];
  /** Every note the rendered citations of this harness asked to open. */
  opened: [citekey: string, pane: unknown][];
}

async function makeHarness({
  body,
  cited = [citation("alpha", ALPHA_KEY)],
  formats = true,
  formatCitations,
  renderText = (source) => `«${source}»`,
  overrides = {},
  frontmatter = {},
  ambiguousKeys = [],
}: {
  body: string;
  cited?: Citation[];
  /** The citekeys the resolution snapshot answers with several candidates for. */
  ambiguousKeys?: readonly string[];
  /** Whether an engine is installed, which is what the cache answers for. */
  formats?: boolean;
  /** Custom render answer for pending-generation tests. */
  formatCitations?: (
    citations: readonly string[],
  ) => Promise<readonly RenderedCitation[] | null>;
  /** The text the render answers for each source, by its place in the request. */
  renderText?: (source: string, index: number) => string;
  overrides?: Partial<Settings>;
  frontmatter?: Record<string, unknown>;
}): Promise<Harness> {
  await using stack = new AsyncDisposableStack();
  const citationRequests: { citations: readonly string[] }[] = [];
  const views: MarkdownView[] = [];
  const popoverRequests: CitationHoverRequest[] = [];
  const opened: [citekey: string, pane: unknown][] = [];
  const occurrences = literalOccurrences(body);
  let process: MarkdownPostProcessor | undefined;

  const citationText = stack.use(
    new CitationText({
      profile: profileReader(defaults, {
        getFileCache: () => ({ frontmatter }),
      }),
      app: {
        vault: { cachedRead: () => Promise.resolve(body) },
        metadataCache: {
          on: () => ({ e: { offref: () => undefined } }),
          getFileCache: () => ({ frontmatter }),
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
        vaultPresentation: { styleId: null, locale: null },
        renderCitations: (citations: readonly string[]) => {
          citationRequests.push({ citations });
          return formatCitations
            ? formatCitations(citations)
            : Promise.resolve(
                formats
                  ? citations.map((source, index) =>
                      rendered(renderText(source, index)),
                    )
                  : null,
              );
        },
        on: () => () => undefined,
      },
      settings: {
        current: { ...defaults, ...overrides },
      },
    } as never),
  );
  await citationText.ready;
  if (!formatCitations) {
    await citationText.load({ path: "note.md" } as TFile);
  }

  const service = stack.use(
    new CitekeyReading({
      app: {
        vault: { getFileByPath: (path: string) => ({ path }) as TFile },
        workspace: {
          getLeavesOfType: () => views.map((view) => ({ view })),
        },
      },
      plugin: {
        registerMarkdownPostProcessor: (
          postProcessor: MarkdownPostProcessor,
        ) => {
          process = postProcessor;
          return postProcessor;
        },
      },
      citationText,
      citationIndex: {
        resolveCitekey: (citekey: string) =>
          ambiguousKeys.includes(citekey)
            ? { kind: "ambiguous", candidates: [] }
            : { kind: "missing" },
      },
      citekeyEditor: {
        openCitekey: (citekey: string, pane: unknown) => {
          opened.push([citekey, pane]);
          return Promise.resolve();
        },
      },
      citationPopover: {
        show: (request: CitationHoverRequest) => popoverRequests.push(request),
      },
      settings: settingsStub(overrides),
    } as never),
  );
  await service.ready;
  const resources = stack.move();

  const sectionCtx = (
    lines: { from: number; to: number } | null,
  ): MarkdownPostProcessorContext =>
    ({
      sourcePath: "note.md",
      getSectionInfo: () =>
        lines && { text: body, lineStart: lines.from, lineEnd: lines.to },
    }) as never;

  return {
    process: process!,
    sectionCtx,
    ctx: sectionCtx({ from: 0, to: body.split("\n").length - 1 }),
    citationRequests,
    views,
    popoverRequests,
    opened,
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
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
  it("rerenders open reading views when Pandoc navigation changes", async () => {
    let notify: ((settings: Readonly<Settings>) => void) | undefined;
    const rerender = vi.fn();
    const view = Object.assign(
      Object.create(MarkdownView.prototype) as MarkdownView,
      { previewMode: { rerender } },
    );
    await using service = new CitekeyReading({
      app: {
        workspace: { getLeavesOfType: () => [{ view }] },
      },
      plugin: { registerMarkdownPostProcessor: () => undefined },
      citationText: {
        on: () => () => undefined,
      },
      citekeyEditor: {},
      settings: {
        ready: Promise.resolve(),
        subscribe: (listener: (settings: Readonly<Settings>) => void) => {
          notify = listener;
          listener(defaults);
          return () => undefined;
        },
      },
    } as never);
    await service.ready;
    expect(rerender).not.toHaveBeenCalled();

    notify?.({ ...defaults, "citation.open-as-links": true });

    expect(rerender).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("puts the engine's formatted citation in the source's place", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [see @alpha, p. 3] blah.",
    });
    const { process, ctx } = harnessed;
    const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

    await process(el, ctx);

    expect(el.textContent).toBe(`Blah «[see @${ALPHA_KEY}, p. 3]» blah.`);
    expect(el.querySelector("span.zt-citation")).not.toBeNull();
  });

  it("names an unavailable Imported Note Profile on its raw citation", async () => {
    await using harnessed = await makeHarness({
      body: "Cited @alpha.",
      frontmatter: {
        "zotero-note-key": "1/NOTE1234",
        "zotlit-profile": "deleted-profile",
      },
    });
    const el = section("<p>Cited @alpha.</p>");

    await harnessed.process(el, harnessed.ctx);

    const citation = el.querySelector<HTMLElement>(
      '[data-citation-presentation-error="profile"]',
    );
    expect(citation?.textContent).toBe("@alpha");
    expect(citation?.getAttribute("aria-label")).toContain("deleted-profile");
    expect(citation?.getAttribute("aria-label")).toContain("Re-stamp the note");
    expect(citation?.title).toBe("");
  });

  // Stands in for a position-dependent style, whose second occurrence of one
  // source reads as the subsequent form.
  const IBID = (source: string, index: number): string =>
    index === 0 ? `«${source}»` : "ibid";

  it("shows each occurrence the text rendered for its own place in the document", async () => {
    await using harnessed = await makeHarness({
      body: "One [@alpha].\n\nTwo [@alpha].",
      renderText: IBID,
    });
    const { process, sectionCtx } = harnessed;
    const first = section("<p>One [@alpha].</p>");
    const second = section("<p>Two [@alpha].</p>");

    await process(first, sectionCtx({ from: 0, to: 0 }));
    await process(second, sectionCtx({ from: 2, to: 2 }));

    expect(first.textContent).toBe(`One «[@${ALPHA_KEY}]».`);
    expect(second.textContent).toBe("Two ibid.");
  });

  it("shows first-occurrence text in a section Obsidian places nowhere", async () => {
    await using harnessed = await makeHarness({
      body: "One [@alpha].\n\nTwo [@alpha].",
      renderText: IBID,
    });
    const { process, sectionCtx } = harnessed;
    const el = section("<p>Two [@alpha].</p>");

    await process(el, sectionCtx(null));

    expect(el.textContent).toBe(`Two «[@${ALPHA_KEY}]».`);
  });

  it("keeps source when no engine formats the citation", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [see @alpha, p. 3] blah.",
      formats: false,
    });
    const { process, ctx } = harnessed;
    const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

    await process(el, ctx);

    expect(el.textContent).toBe("Blah [see @alpha, p. 3] blah.");
  });

  it("keeps source while formatted citation presentation is off", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [see @alpha, p. 3] blah.",
      overrides: { "citation.show-formatted": false },
    });
    const { process, ctx } = harnessed;
    const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

    await process(el, ctx);

    expect(el.textContent).toBe("Blah [see @alpha, p. 3] blah.");
  });

  it("keeps source visible while citation text is pending", async () => {
    let settle: ((value: readonly RenderedCitation[]) => void) | undefined;
    const pending = new Promise<readonly RenderedCitation[]>((resolve) => {
      settle = resolve;
    });
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      formatCitations: () => pending,
    });
    const { process, ctx } = harnessed;
    const el = section("<p>Blah [@alpha].</p>");

    const completion = Promise.resolve(process(el, ctx));
    let completed = false;
    void completion.then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(true);
    expect(el.textContent).toBe("Blah [@alpha].");

    settle?.([rendered("«[@alpha]»")]);
    await pending;
  });

  it("leaves a citekey no Literature Note carries as written", async () => {
    await using harnessed = await makeHarness({
      body: "@ghost blah.",
      cited: [citation("ghost", null)],
    });
    const { process, ctx } = harnessed;
    const el = section("<p>@ghost blah.</p>");

    await process(el, ctx);

    expect(el.textContent).toBe("@ghost blah.");
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
      // An Ambiguous Citation Key reads as its own state, and a missing key
      // outranks it wherever a cluster writes both.
      {
        body: "[@twin]",
        cited: [citation("twin", null)],
        ambiguousKeys: ["twin"],
        classes: [
          "zt-citation",
          "zt-citation-key",
          "zt-citation-key-ambiguous",
        ],
        absent: ["zt-citation-key-unresolved"],
      },
      {
        body: "[@twin; @ghost]",
        cited: [citation("twin", null), citation("ghost", null)],
        ambiguousKeys: ["twin"],
        classes: [
          "zt-citation",
          "zt-citation-key",
          "zt-citation-key-unresolved",
        ],
        absent: ["zt-citation-key-ambiguous"],
      },
    ];
    for (const { body, cited, classes, ambiguousKeys, absent } of cases) {
      await using harnessed = await makeHarness({ body, cited, ambiguousKeys });
      const { process, ctx } = harnessed;
      const el = section(`<p>${body}</p>`);

      await process(el, ctx);

      const rendered = el.querySelector("span");
      for (const className of classes) {
        expect(rendered?.classList.contains(className)).toBe(true);
      }
      for (const className of absent ?? []) {
        expect(rendered?.classList.contains(className)).toBe(false);
      }
    }
  });

  it("shows the rendered citation's popover while navigation is off", async () => {
    // The Hover Action owns hover on its own, so a rendered citation answers
    // with the popover while Citekey Navigation is off.
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      overrides: { "citation.open-as-links": false },
    });
    const { process, ctx, views, popoverRequests } = harnessed;
    const el = section("<p>Blah [@alpha].</p>");
    views.push(
      Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
        containerEl: el,
        previewMode: { rerender: () => undefined },
      }),
    );

    await process(el, ctx);
    const citationEl = el.querySelector<HTMLElement>(".zt-citation")!;
    citationEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(popoverRequests).toHaveLength(1);
    expect(popoverRequests[0]).toMatchObject({
      targetEl: citationEl,
      works: [{ citekey: "alpha" }],
      sourcePath: "note.md",
    });
  });

  it("leaves the rendered citation's plain click inert while navigation is off", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      overrides: {
        "citation.open-as-links": false,
        "citation.hover-action": "off",
      },
    });
    const { process, popoverRequests, opened } = harnessed;
    const el = section("<p>Blah [@alpha].</p>");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    await process(el, viewedCtx(harnessed, el));
    const citationEl = el.querySelector<HTMLElement>(".zt-citation")!;
    citationEl.dispatchEvent(event);

    expect(opened).toEqual([]);
    expect(popoverRequests).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    // The citation says as much: nothing to click, so it reads as static text.
    expect(citationEl.dataset.ztClick).toBe("none");
  });

  it("states that a rendered citation opens while navigation is on", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      overrides: { "citation.open-as-links": true },
    });
    const { process } = harnessed;
    const el = section("<p>Blah [@alpha].</p>");

    await process(el, viewedCtx(harnessed, el));

    expect(el.querySelector<HTMLElement>(".zt-citation")!.dataset.ztClick).toBe(
      "open",
    );
  });

  it("opens the work a Mod-click names while navigation is off", async () => {
    vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      overrides: { "citation.open-as-links": false },
    });
    const { process, popoverRequests, opened } = harnessed;
    const el = section("<p>Blah [@alpha].</p>");

    await process(el, viewedCtx(harnessed, el));
    el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(popoverRequests).toEqual([]);
    expect(opened).toEqual([["alpha", "tab"]]);
    vi.restoreAllMocks();
  });

  it("opens the work a plain click names while Citations open as links", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      overrides: { "citation.open-as-links": true },
    });
    const { process, popoverRequests, opened } = harnessed;
    const el = section("<p>Blah [@alpha].</p>");

    await process(el, viewedCtx(harnessed, el));
    el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(popoverRequests).toEqual([]);
    expect(opened).toEqual([["alpha", false]]);
  });

  it("keeps an unrendered citation opening as a link", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      overrides: {
        "citation.show-formatted": false,
        "citation.open-as-links": true,
      },
    });
    const { process, popoverRequests, opened } = harnessed;
    const el = section("<p>Blah [@alpha].</p>");

    // Citations open as links here, so the rendering is off but the citation
    // is still wrapped; turning navigation off as well retires the treatment.
    await process(el, viewedCtx(harnessed, el));
    el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(popoverRequests).toEqual([]);
    expect(opened).toEqual([["alpha", false]]);
  });

  it("leaves the reading view alone while the treatment is off", async () => {
    for (const overrides of [
      {
        "citation.show-formatted": false,
        "citation.open-as-links": false,
      },
      { "citation.pandoc-citations": false },
    ]) {
      await using harnessed = await makeHarness({
        body: "Blah [@alpha].",
        overrides,
      });
      const { process, ctx } = harnessed;
      const el = section("<p>Blah [@alpha].</p>");

      await process(el, ctx);

      expect(el.textContent).toBe("Blah [@alpha].");
      expect(el.querySelector(".zt-citation-key")).toBeNull();
    }
  });

  // Sidebar occurrence navigation flashes the block element the line sits in,
  // so the swap has to stay inside that element and leave it in place.
  it("keeps the block element a reading-view flash targets", async () => {
    await using harnessed = await makeHarness({
      body: "Blah [@alpha] blah.",
    });
    const { process, ctx } = harnessed;
    const el = section("<p>Blah [@alpha] blah.</p>");
    const block = el.firstElementChild!;

    await process(el, ctx);

    expect(el.children).toHaveLength(1);
    expect(el.firstElementChild).toBe(block);
    expect(block.querySelector("span.zt-citation")).not.toBeNull();
  });

  it("formats a document once for every section that asks", async () => {
    await using harnessed = await makeHarness({
      body: "One [@alpha].\n\nTwo [@alpha].",
    });
    const { process, ctx, citationRequests } = harnessed;

    await process(section("<p>One [@alpha].</p>"), ctx);
    await process(section("<p>Two [@alpha].</p>"), ctx);

    expect(citationRequests).toHaveLength(1);
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
