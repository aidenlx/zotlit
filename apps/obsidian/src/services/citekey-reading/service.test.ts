// @vitest-environment happy-dom
import { MarkdownView } from "obsidian";
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
import type { RenderedCitation } from "@/services/pandoc/engine";
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
}

async function makeHarness({
  body,
  cited = [citation("alpha", ALPHA_KEY)],
  formats = true,
  formatCitations,
  renderText = (source) => `«${source}»`,
  overrides = {},
}: {
  body: string;
  cited?: Citation[];
  /** Whether an engine is installed, which is what the cache answers for. */
  formats?: boolean;
  /** Custom render answer for pending-generation tests. */
  formatCitations?: (
    citations: readonly string[],
  ) => Promise<readonly RenderedCitation[] | null>;
  /** The text the render answers for each source, by its place in the request. */
  renderText?: (source: string, index: number) => string;
  overrides?: Partial<Settings>;
}): Promise<Harness> {
  await using stack = new AsyncDisposableStack();
  const citationRequests: { citations: readonly string[] }[] = [];
  const occurrences = literalOccurrences(body);
  let process: MarkdownPostProcessor | undefined;

  const citationText = stack.use(
    new CitationText({
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
        ready: Promise.resolve(),
        subscribe: (cb: (next: Readonly<Settings>) => void) => {
          cb(defaults);
          return () => undefined;
        },
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
        workspace: { getLeavesOfType: () => [] },
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
      citekeyEditor: {
        openCitekey: () => Promise.resolve(),
        hoverNotePath: () => null,
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

    notify?.({ ...defaults, "citation.open-pandoc-links": false });

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
    ];
    for (const { body, cited, classes } of cases) {
      await using harnessed = await makeHarness({ body, cited });
      const { process, ctx } = harnessed;
      const el = section(`<p>${body}</p>`);

      await process(el, ctx);

      const rendered = el.querySelector("span");
      for (const className of classes) {
        expect(rendered?.classList.contains(className)).toBe(true);
      }
    }
  });

  it("leaves the reading view alone while the treatment is off", async () => {
    for (const overrides of [
      {
        "citation.show-formatted": false,
        "citation.open-pandoc-links": false,
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
