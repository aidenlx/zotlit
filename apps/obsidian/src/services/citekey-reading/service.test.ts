import { Layer, Stream } from "effect";
import { Effect } from "effect";
import { Keymap, MarkdownView, TFile } from "obsidian";
import type {
  App,
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { testEvent } from "@/lib/__fixtures__/event-stream";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { OpenDocumentsStub } from "@/lib/__fixtures__/open-documents";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { buildRuntime } from "@/lib/effect-layer";
import * as m from "@/lib/i18n/generated/messages";
import { themeHook } from "@/lib/theme-hooks";
import { CitationLookupStub } from "@/services/citation-index/__fixtures__/citation-lookup";
import { lookupAnswerFor } from "@/services/citation-index/__fixtures__/lookup";
import type { CitationLookupAnswer } from "@/services/citation-index/lookup";
// @vitest-environment happy-dom
import { ParsedNote } from "@/services/citation-index/parsed-note";
import type { Citation } from "@/services/citation-index/service";
import { readReferenceSources } from "@/services/citation-index/sources";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import {
  ALPHA_KEY,
  citation,
  literalOccurrences,
  rendered,
} from "@/services/citation-text/__fixtures__";
import { citationTextFixture } from "@/services/citation-text/__fixtures__";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { queryClientsFixture } from "@/services/query-client/__fixtures__";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import {
  citedWorkSeed,
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { CitekeyReading } from "./service";
import type { CitekeyReadingDeps } from "./service";

/** A typed facade over a test source, so its methods keep the source as `this`. */
function capability<T extends object>(name: string, source: object): T {
  const typed = stubService<T>(name, {});
  return new Proxy(typed, {
    get(_target, key) {
      const value = Reflect.get(source, key, source);
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
}

function appWith(
  sources: {
    vault?: object;
    metadataCache?: object;
    workspace?: object;
  } = {},
): App {
  return stubService<App>("App", {
    vault: capability<App["vault"]>(
      "Vault",
      sources.vault ?? new MemoryVault(),
    ),
    metadataCache: capability<App["metadataCache"]>(
      "MetadataCache",
      sources.metadataCache ?? new MemoryMetadataCache(),
    ),
    workspace: capability<App["workspace"]>(
      "Workspace",
      sources.workspace ?? new MemoryWorkspace(),
    ),
  });
}

/** A Citekey Reading over only the dependencies one case reads. */
function readingDeps(
  runtime: CitekeyReadingDeps["runtime"],
  overrides: Partial<Omit<CitekeyReadingDeps, "runtime">> = {},
): CitekeyReadingDeps {
  return {
    runtime,
    app: appWith(),
    plugin: stubService<CitekeyReadingDeps["plugin"]>("Plugin", {}),
    citationText: stubService<CitekeyReadingDeps["citationText"]>(
      "CitationText",
      {},
    ),
    citationLookup: stubService<CitekeyReadingDeps["citationLookup"]>(
      "CitationLookup",
      {},
    ),
    citekeyEditor: stubService<CitekeyReadingDeps["citekeyEditor"]>(
      "CitekeyEditor",
      {},
    ),
    citationPopover: stubService<CitekeyReadingDeps["citationPopover"]>(
      "CitationPopover",
      {},
    ),
    bridge: stubService<CitekeyReadingDeps["bridge"]>("EffectBridge", {}),
    settings: stubService<CitekeyReadingDeps["settings"]>("PluginSettings", {}),
    ...overrides,
  };
}

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
    Object.assign(
      new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
      {
        containerEl: el,
        previewMode: {
          rerender: () => {
            harness.rerendered();
          },
        },
      },
    ),
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
  /** How often the reading views were asked to render again. */
  rerenders: () => number;
  /** Counts one render-again request from a view. */
  rerendered: () => void;
  /** Replaces what the render answers from here on. */
  renderAs: (renderText: (source: string, index: number) => string) => void;
  /** Reports one file changed, the way the metadata cache does after an edit. */
  changeFile: (path: string) => void;
  /** Replaces the Ambiguous keys and reports a citekey resolution snapshot rebuild. */
  rebuildResolution: (ambiguous: readonly string[]) => void;
  /** Tears every rendered section down, the way Obsidian does on a re-render. */
  unloadSections: () => void;
  activeLookups: () => number;
  switchRequests: string[];
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
  resolutionPending = false,
}: {
  body: string;
  cited?: Citation[];
  /** The citekeys the resolution snapshot answers with several candidates for. */
  ambiguousKeys?: readonly string[];
  /** Whether the citation-key snapshot has no first answer yet. */
  resolutionPending?: boolean;
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
  const switchRequests: string[] = [];
  const occurrences = literalOccurrences(body);
  let process: MarkdownPostProcessor | undefined;
  let rerenders = 0;
  let render = renderText;
  const metadataListeners = new Map<string, (file: { path: string }) => void>();
  const children: MarkdownRenderChild[] = [];
  let ambiguous = ambiguousKeys;
  let resolutionReady = !resolutionPending;
  const answer = (requested: readonly string[]): CitationLookupAnswer =>
    lookupAnswerFor(
      requested,
      Object.fromEntries(
        ambiguous.map((citekey) => [
          citekey,
          { kind: "ambiguous" as const, candidates: [] },
        ]),
      ),
      JSON.stringify(ambiguous),
    );

  const citationLookup = new CitationLookupStub(({ citekeys = [] }) =>
    resolutionReady ? answer(citekeys) : null,
  );

  const reads = stack.use(
    inProcessReadsService(memoryOpener(() => citedWorkSeed([ALPHA_KEY])).open),
  );
  const citationText = stack.use(
    citationTextFixture({
      openDocuments: new OpenDocumentsStub(),
      citationLookup,
      profile: profileReader(defaults, {
        getFileCache: () => ({ frontmatter }),
      }),
      app: appWith({
        vault: MemoryVault.with({
          cachedRead: () => Promise.resolve(body),
          getFileByPath: (path: string) => Object.assign(new TFile(), { path }),
        }),
        metadataCache: {
          offref: () => {},
          on: (event: string, cb: (file: { path: string }) => void) => {
            metadataListeners.set(event, cb);
            return { e: { offref: () => undefined } };
          },
          getFileCache: () => ({ frontmatter }),
        },
      }),
      citationIndex: {
        getParsedDocument: async () => ({
          facts: new ParsedNote(
            body,
            (
              await Effect.runPromise(
                inProcessParseClient.parse({
                  path: "note.md",
                  generation: 0,
                  text: body,
                }),
              )
            ).record,
          ),
          set: {
            occurrences,
            citations: cited,
            errors: [],
            lookup: answer(occurrences.map((o) => o.raw)),
            ...(await readReferenceSources(reads, cited)),
            syntaxes: {
              citekey: "included",
              wikilink: "excluded",
              annotation: "included",
            },
            omittedSyntaxes: [],
            coverage: "complete",
          },
        }),
        changed: Stream.empty,
        "membership-changed": Stream.empty,
      },
      noteIndex: {
        changed: Stream.empty,
        indexed: Stream.empty,
        whenIndexed: () => Promise.resolve(),
      },
      bibliographyRender: {
        vaultPresentation: { styleId: null, locale: null },
        readCitations: async (citations: readonly string[]) => {
          citationRequests.push({ citations });
          return formatCitations
            ? await formatCitations(citations)
            : formats
              ? citations.map((source, index) =>
                  rendered(render(source, index)),
                )
              : null;
        },
        readBibliography: async () => ({
          entries: [],
          hasEntryMarkers: false,
        }),
        invalidated: Stream.empty,
      },
      queryClient: stack.use(queryClientsFixture()),
    }),
  );
  if (!formatCitations) {
    citationText.peek("note.md");
    await vi.waitFor(() => {
      if (citationText.peek("note.md") === null)
        throw new Error("citation text for note.md is not settled");
    });
  }

  const service = stack.use(
    new CitekeyReading(
      readingDeps(citationText.runtime, {
        app: appWith({
          vault: {
            getFileByPath: (path: string) =>
              Object.assign(new TFile(), { path }),
          },
          workspace: {
            getLeavesOfType: () => views.map((view) => ({ view })),
            trigger: (_name: string, request: { path: string }) =>
              switchRequests.push(request.path),
          },
        }),
        plugin: {
          registerMarkdownPostProcessor: (
            postProcessor: MarkdownPostProcessor,
          ) => {
            process = postProcessor;
            return postProcessor;
          },
        },
        citationText,
        citationLookup,
        citekeyEditor: capability<CitekeyReadingDeps["citekeyEditor"]>(
          "CitekeyEditor",
          {
            openCitekey: (citekey: string, pane: unknown) =>
              Effect.sync(() => {
                opened.push([citekey, pane]);
              }),
          },
        ),
        citationPopover: {
          show: (request: CitationHoverRequest) => {
            popoverRequests.push(request);
            return Effect.void;
          },
        },
        bridge: stack.use(openTestBridge()),
        settings: settingsStub(overrides),
      }),
    ),
  );
  await service.ready;
  const resources = stack.move();

  const sectionCtx = (
    lines: { from: number; to: number } | null,
  ): MarkdownPostProcessorContext =>
    stubService<MarkdownPostProcessorContext>("MarkdownPostProcessorContext", {
      sourcePath: "note.md",
      getSectionInfo: () =>
        lines && { text: body, lineStart: lines.from, lineEnd: lines.to },
      addChild: (child: MarkdownRenderChild) => {
        children.push(child);
        child.load();
      },
    });

  return {
    process: process!,
    sectionCtx,
    ctx: sectionCtx({ from: 0, to: body.split("\n").length - 1 }),
    citationRequests,
    views,
    popoverRequests,
    opened,
    rerenders: () => rerenders,
    rerendered: () => {
      rerenders += 1;
    },
    renderAs: (renderText) => {
      render = renderText;
    },
    changeFile: (path) => metadataListeners.get("changed")?.({ path }),
    rebuildResolution: (keys) => {
      ambiguous = keys;
      resolutionReady = true;
      citationLookup.refresh();
    },
    unloadSections: () => {
      for (const child of children.splice(0)) child.unload();
    },
    activeLookups: () => citationLookup.activeObservations,
    switchRequests,
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
}

describe("CitekeyReading", () => {
  it("rerenders open reading views when Pandoc navigation changes", async () => {
    const settingsChanged = testEvent<Readonly<Settings>>();
    const notify = (value: Readonly<Settings>) => settingsChanged.emit(value);
    const rerender = vi.fn();
    const view = Object.assign(
      new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
      { previewMode: { rerender } },
    );
    await using stack = new AsyncDisposableStack();
    await using service = new CitekeyReading(
      readingDeps(buildRuntime(Layer.empty, stack), {
        app: appWith({ workspace: { getLeavesOfType: () => [{ view }] } }),
        plugin: {
          registerMarkdownPostProcessor: (postProcessor) => postProcessor,
        },
        citationText: capability<CitekeyReadingDeps["citationText"]>(
          "CitationText",
          { changed: Stream.empty, invalidated: Stream.empty },
        ),
        citekeyEditor: capability<CitekeyReadingDeps["citekeyEditor"]>(
          "CitekeyEditor",
          {},
        ),
        settings: {
          current: Effect.succeed(defaults),
          changes: settingsChanged.stream.pipe(Stream.prepend([defaults])),
        },
        bridge: { runSync: Effect.runSync, runPromise: Effect.runPromise },
      }),
    );
    await service.ready;
    expect(rerender).not.toHaveBeenCalled();

    notify?.({ ...defaults, "citation.open-as-links": true });

    expect(rerender).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("renders the reading views again on disposal, which drops its citations", async () => {
    const harnessed = await makeHarness({ body: "Blah [@alpha]." });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));
    expect(harnessed.rerenders()).toBe(0);

    await harnessed[Symbol.asyncDispose]();

    expect(harnessed.rerenders()).toBe(1);
    const late = section("<p>Blah [@alpha].</p>");
    await harnessed.process(late, harnessed.ctx);
    expect(late.textContent).toBe("Blah [@alpha].");
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
    expect(citation?.getAttribute("aria-label")).toBe(
      m.notice_imported_note_profile_unknown({
        stamp: "deleted-profile",
        target: "note.md",
      }),
    );
    const recovery = el.querySelector<HTMLButtonElement>(
      "[data-profile-recovery]",
    );
    expect(recovery?.textContent).toBe(m.profile_switch_recovery());
    recovery?.click();
    expect(harnessed.switchRequests).toEqual(["note.md"]);
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

  it("marks source as neutral while citation-key resolution is pending", async () => {
    const pending = new Promise<readonly RenderedCitation[]>(() => undefined);
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      formatCitations: () => pending,
      resolutionPending: true,
    });
    const el = section("<p>Blah [@alpha].</p>");

    await harnessed.process(el, harnessed.ctx);

    expect(el.textContent).toBe("Blah [@alpha].");
    expect(el.querySelector(`.${themeHook.citationKeyPending}`)).not.toBeNull();
    expect(el.querySelector(`.${themeHook.citationKeyUnresolved}`)).toBeNull();
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
      Object.assign(
        new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
        {
          containerEl: el,
          previewMode: { rerender: () => undefined },
        },
      ),
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

describe("CitekeyReading refresh", () => {
  /** Waits for the replacement read a change starts to commit. */
  const settled = () => vi.waitFor(() => undefined, { timeout: 1000 });

  it("refreshes a rendered citation in place when its document's text changes", async () => {
    await using harnessed = await makeHarness({ body: "Blah [@alpha]." });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));
    const block = el.firstElementChild;
    expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);

    harnessed.renderAs((source) => `‹${source}›`);
    harnessed.changeFile("note.md");
    // The stale text stays while the replacement read runs.
    expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
    await vi.waitFor(() =>
      expect(el.textContent).toBe(`Blah ‹[@${ALPHA_KEY}]›.`),
    );

    expect(el.firstElementChild).toBe(block);
    expect(el.querySelectorAll(".zt-citation")).toHaveLength(1);
    expect(harnessed.rerenders()).toBe(0);
  });

  it("leaves another document's sections alone", async () => {
    await using harnessed = await makeHarness({ body: "Blah [@alpha]." });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));

    harnessed.renderAs((source) => `‹${source}›`);
    harnessed.changeFile("other.md");
    await settled();

    expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
    expect(harnessed.rerenders()).toBe(0);
  });

  it("fills a section in that rendered while its text was pending", async () => {
    let settle: ((value: readonly RenderedCitation[]) => void) | undefined;
    const pending = new Promise<readonly RenderedCitation[]>((resolve) => {
      settle = resolve;
    });
    await using harnessed = await makeHarness({
      body: "Blah [@alpha].",
      formatCitations: () => pending,
    });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));
    expect(el.textContent).toBe("Blah [@alpha].");

    settle?.([rendered("«[@alpha]»")]);
    await vi.waitFor(() => expect(el.textContent).toBe("Blah «[@alpha]»."));

    expect(el.querySelector(".zt-citation")).not.toBeNull();
    expect(harnessed.rerenders()).toBe(0);
  });

  it("keeps the current text when the fresh text holds nothing for a citation", async () => {
    await using harnessed = await makeHarness({ body: "Blah [@alpha]." });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));

    harnessed.renderAs(() => "");
    harnessed.changeFile("note.md");
    await settled();

    expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
  });

  it("keeps key state with the held document until its fresh read arrives", async () => {
    await using harnessed = await makeHarness({
      body: "[@twin]",
      cited: [citation("twin", null)],
    });
    const el = section("<p>[@twin]</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));
    expect(
      el.querySelector(`.${themeHook.citationKeyUnresolved}`),
    ).not.toBeNull();

    harnessed.rebuildResolution(["twin"]);

    expect(
      el.querySelector(`.${themeHook.citationKeyUnresolved}`),
    ).not.toBeNull();
    await vi.waitFor(() =>
      expect(
        el.querySelector(`.${themeHook.citationKeyAmbiguous}`),
      ).not.toBeNull(),
    );
    expect(el.querySelector(`.${themeHook.citationKeyUnresolved}`)).toBeNull();
    expect(harnessed.rerenders()).toBe(0);
  });

  it("keeps a placed element across a refresh whose answer is equal", async () => {
    await using harnessed = await makeHarness({ body: "Blah [@alpha]." });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));
    const element = el.querySelector<HTMLElement>(".zt-citation")!;

    // Every text goes stale at once, and the rebuilt snapshot answers the same.
    harnessed.rebuildResolution([]);
    await settled();
    harnessed.changeFile("note.md");
    await settled();

    expect(el.querySelector(".zt-citation")).toBe(element);
    expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(harnessed.popoverRequests).toHaveLength(1);
  });

  it("answers one hover with one popover after a refresh", async () => {
    await using harnessed = await makeHarness({ body: "Blah [@alpha]." });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));

    harnessed.renderAs((source) => `‹${source}›`);
    harnessed.changeFile("note.md");
    await vi.waitFor(() =>
      expect(el.textContent).toBe(`Blah ‹[@${ALPHA_KEY}]›.`),
    );
    el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true }),
    );

    expect(harnessed.popoverRequests).toHaveLength(1);
  });

  it("leaves a section Obsidian tore down alone", async () => {
    await using harnessed = await makeHarness({ body: "Blah [@alpha]." });
    const el = section("<p>Blah [@alpha].</p>");
    await harnessed.process(el, viewedCtx(harnessed, el));
    expect(harnessed.activeLookups()).toBe(1);
    harnessed.unloadSections();
    expect(harnessed.activeLookups()).toBe(0);

    harnessed.renderAs((source) => `‹${source}›`);
    harnessed.changeFile("note.md");
    await settled();

    expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
  });
});

/** Hands out one settings snapshot, the way the service reads its toggles. */
function settingsStub(overrides: Partial<Settings>) {
  const current: Readonly<Settings> = { ...defaults, ...overrides };
  return { current: Effect.succeed(current), changes: Stream.succeed(current) };
}
