// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { Keymap, MarkdownView } from "obsidian";
import type {
  App,
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect, vi } from "vitest";

import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { OpenDocumentsStub } from "@/lib/__fixtures__/open-documents";
import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { layerVaultFrom } from "@/lib/obsidian-vault";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { themeHook } from "@/lib/theme-hooks";
import { CitationLookupStub } from "@/services/citation-index/__fixtures__/citation-lookup";
import { lookupAnswerFor } from "@/services/citation-index/__fixtures__/lookup";
import type { CitationLookupAnswer } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { ParsedNote } from "@/services/citation-index/parsed-note";
import type { Citation } from "@/services/citation-index/service";
import { readReferenceSources } from "@/services/citation-index/sources";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { CitationPopover } from "@/services/citation-popover/service";
import {
  ALPHA_KEY,
  citation,
  literalOccurrences,
  rendered,
} from "@/services/citation-text/__fixtures__";
import { citationTextFixture } from "@/services/citation-text/__fixtures__";
import { CitationText } from "@/services/citation-text/service";
import type { CitationTextEvent } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import type { CitationHoverRequest } from "@/services/citekey-navigation";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { queryClientsFixture } from "@/services/query-client/__fixtures__";
import { settingsFeed } from "@/services/settings/__fixtures__";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";
import {
  citedWorkSeed,
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { layerCitekeyReading } from "./service";

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

/** The fakes Citekey Reading reads its tags from; a member a case leaves out fails when read. */
interface ReadingFakes {
  workspace: MemoryWorkspace;
  vault?: MemoryVault;
  citationText: Layer.Layer<CitationText>;
  citationLookup?: Layer.PartialEffectful<CitationLookup["Service"]>;
  citekeyEditor?: Layer.PartialEffectful<CitekeyEditor["Service"]>;
  citationPopover?: Layer.PartialEffectful<CitationPopover["Service"]>;
  settings: Layer.Layer<PluginSettings>;
}

/**
 * Citekey Reading over `fakes`, built as the plugin layer builds it, and the
 * post-processor it registers. `unload` closes the layer, which is the
 * plugin's unload.
 */
const openReading = Effect.fnUntraced(function* ({
  workspace,
  vault = new MemoryVault(),
  ...fakes
}: ReadingFakes) {
  let process: MarkdownPostProcessor | undefined;
  const host = testPluginHost({
    registerMarkdownPostProcessor: (postProcessor) => {
      process = postProcessor;
      return postProcessor;
    },
  });
  const scope = yield* Scope.fork(yield* Scope.Scope);
  yield* Layer.buildWithScope(
    layerCitekeyReading.pipe(
      Layer.provide(
        Layer.mergeAll(
          host.layer,
          layerVaultFrom(vault),
          layerWorkspaceFrom(workspace),
          fakes.citationText,
          Layer.mock(CitationLookup, fakes.citationLookup ?? {}),
          Layer.mock(CitekeyEditor, fakes.citekeyEditor ?? {}),
          Layer.mock(CitationPopover, fakes.citationPopover ?? {}),
          fakes.settings,
        ),
      ),
    ),
    scope,
  );
  const postProcessor = process!;
  return {
    /** The registered post-processor, and what it returns. */
    postProcessor,
    /** The registered post-processor over one section. */
    process: (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
      void postProcessor(el, ctx);
    },
    unload: Scope.close(scope, Exit.void),
  };
});

/** One rendered section, as a Markdown post-processor receives it. */
function section(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

/** A reading view showing `containerEl`; each render-again request calls `rerender`. */
function readingView(
  containerEl: HTMLElement,
  rerender: (scroll: boolean) => void,
): MarkdownView {
  return Object.assign(
    new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
    { containerEl, previewMode: { rerender } },
  );
}

const makeHarness = Effect.fnUntraced(function* ({
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
}) {
  const citationRequests: { citations: readonly string[] }[] = [];
  const popoverRequests: CitationHoverRequest[] = [];
  const opened: [citekey: string, pane: unknown][] = [];
  const switchRequests: string[] = [];
  const occurrences = literalOccurrences(body);
  let rerenders = 0;
  let render = renderText;
  let formatting = formats;
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
  const vault = new MemoryVault();
  const metadata = new MemoryMetadataCache();
  for (const path of ["note.md", "other.md"]) {
    vault.add(path, body);
    metadata.setCache(path, { frontmatter });
  }
  const workspace = new MemoryWorkspace();
  workspace.on("zotlit:switch-profile", (request) => {
    switchRequests.push((request as { path: string }).path);
  });

  const reads = yield* Effect.acquireDisposable(
    Effect.sync(() =>
      inProcessReadsService(
        memoryOpener(() => citedWorkSeed([ALPHA_KEY])).open,
      ),
    ),
  );
  const queryClient = yield* Effect.acquireDisposable(
    Effect.sync(() => queryClientsFixture()),
  );
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const fixture = yield* Effect.acquireDisposable(
    Effect.sync(() =>
      citationTextFixture({
        openDocuments: new OpenDocumentsStub(),
        citationLookup,
        profile: profileReader(defaults, {
          getFileCache: () => ({ frontmatter }),
        }),
        // The CitationText layer still reads the host's `app`.
        app: stubService<App>("App", {
          vault: capability<App["vault"]>("Vault", vault),
          metadataCache: capability<App["metadataCache"]>(
            "MetadataCache",
            metadata,
          ),
        }),
        citationIndex: {
          getParsedDocument: async () => ({
            facts: new ParsedNote(
              body,
              (
                await runPromise(
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
              : formatting
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
        queryClient,
      }),
    ),
  );
  const text = fixture.runtime.runSync(CitationText);
  // A pending render settles only when the case lets it.
  if (!formatCitations) yield* text.read("note.md").pipe(Effect.orDie);

  const reading = yield* openReading({
    workspace,
    vault,
    citationText: Layer.succeed(CitationText, text),
    citationLookup: {
      observe: (changed) => Effect.sync(() => citationLookup.observe(changed)),
    },
    citekeyEditor: {
      openCitekey: (citekey, pane) =>
        Effect.sync(() => {
          opened.push([citekey, pane]);
        }),
    },
    citationPopover: {
      show: (request) =>
        Effect.sync(() => {
          popoverRequests.push(request);
        }),
    },
    settings: settingsFeed(overrides).layer,
  });

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
  const ctx = sectionCtx({ from: 0, to: body.split("\n").length - 1 });

  /**
   * Starts a wait for the next citation text event `matches` accepts, and
   * answers the Effect that joins it: start it before the trigger and join it
   * after. The layer subscribed to the events first, so it has handled every
   * event up to that one when the join completes.
   */
  const nextEvent = (matches: (event: CitationTextEvent) => boolean) =>
    Stream.runHead(Stream.filter(text.events, (event) => matches(event))).pipe(
      Effect.forkScoped({ startImmediately: true }),
      Effect.map((fiber) => Fiber.join(fiber)),
    );

  return {
    postProcessor: reading.postProcessor,
    process: reading.process,
    /**
     * The context Obsidian hands a post-processor for the body lines `lines`
     * covers, or for a section it places nowhere — an embed, a popover.
     */
    sectionCtx,
    /** {@link sectionCtx} over the whole body, which is one section for most suites. */
    ctx,
    /**
     * Places one rendered section in a reading view, which is what a popover
     * hangs in, and answers with the context that section is processed under.
     */
    viewedCtx: (el: HTMLElement): MarkdownPostProcessorContext => {
      workspace.openLeaf(
        "markdown",
        readingView(el, () => {
          rerenders += 1;
        }),
      );
      return ctx;
    },
    citationRequests,
    /** Every popover the rendered citations of this harness asked for. */
    popoverRequests,
    /** Every note the rendered citations of this harness asked to open. */
    opened,
    /** How often the reading views were asked to render again. */
    rerenders: () => rerenders,
    /** Replaces what the render answers from here on. */
    renderAs: (renderText: (source: string, index: number) => string) => {
      render = renderText;
    },
    /** From here on, the render formats nothing, the way it does with no engine. */
    stopFormatting: () => {
      formatting = false;
    },
    /** Reports one file changed, the way the metadata cache does after an edit. */
    changeFile: (path: string) => {
      metadata.change(vault.getFileByPath(path)!, { frontmatter });
    },
    /** Replaces the Ambiguous keys and reports a citekey resolution snapshot rebuild. */
    rebuildResolution: (keys: readonly string[]) => {
      ambiguous = keys;
      resolutionReady = true;
      citationLookup.refresh();
    },
    /** Tears every rendered section down, the way Obsidian does on a re-render. */
    unloadSections: () => {
      for (const child of children.splice(0)) child.unload();
    },
    activeLookups: () => citationLookup.activeObservations,
    switchRequests,
    /** Reads the text of `path` and waits until it stands. */
    read: (path: string) => text.read(path).pipe(Effect.orDie),
    /** Starts a wait for the next read of `path` to commit; see {@link nextEvent}. */
    settles: (path: string) =>
      nextEvent((event) => event.type === "settled" && event.path === path),
    /** Starts a wait for the next change to `path`; see {@link nextEvent}. */
    changes: (path: string) =>
      nextEvent((event) => event.type === "changed" && event.path === path),
    unload: reading.unload,
  };
});

/** A render whose answer waits until the case settles it. */
function pendingRender() {
  let settle: ((value: readonly RenderedCitation[]) => void) | undefined;
  const pending = new Promise<readonly RenderedCitation[]>((resolve) => {
    settle = resolve;
  });
  return {
    pending,
    settle: (value: readonly RenderedCitation[]) => settle!(value),
  };
}

describe("CitekeyReading", () => {
  it.effect("rerenders open reading views when Pandoc navigation changes", () =>
    Effect.gen(function* () {
      const settings = settingsFeed();
      const rerender = vi.fn<(scroll: boolean) => void>();
      const workspace = new MemoryWorkspace();
      workspace.openLeaf(
        "markdown",
        readingView(document.createElement("div"), rerender),
      );
      yield* openReading({
        workspace,
        citationText: Layer.mock(CitationText, { events: Stream.empty }),
        settings: settings.layer,
      });
      expect(rerender).not.toHaveBeenCalled();

      settings.update({ "citation.open-as-links": true });

      expect(rerender).toHaveBeenCalledExactlyOnceWith(true);
    }),
  );

  it.live(
    "renders the reading views again on disposal, which drops its citations",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ body: "Blah [@alpha]." });
        const el = section("<p>Blah [@alpha].</p>");
        h.process(el, h.viewedCtx(el));
        expect(h.rerenders()).toBe(0);

        yield* h.unload;

        expect(h.rerenders()).toBe(1);
        const late = section("<p>Blah [@alpha].</p>");
        h.process(late, h.ctx);
        expect(late.textContent).toBe("Blah [@alpha].");
      }),
  );

  it.live("puts the engine's formatted citation in the source's place", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [see @alpha, p. 3] blah.",
      });
      const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe(`Blah «[see @${ALPHA_KEY}, p. 3]» blah.`);
      expect(el.querySelector("span.zt-citation")).not.toBeNull();
    }),
  );

  it.live(
    "names an unavailable Imported Note Profile on its raw citation",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "Cited @alpha.",
          frontmatter: {
            "zotero-note-key": "1/NOTE1234",
            "zotlit-profile": "deleted-profile",
          },
        });
        const el = section("<p>Cited @alpha.</p>");

        h.process(el, h.ctx);

        const citation = el.querySelector<HTMLElement>(
          '[data-citation-presentation-error="profile"]',
        );
        expect(citation?.textContent).toBe("@alpha");
        expect(citation?.getAttribute("aria-label")).toContain(
          "deleted-profile",
        );
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
        expect(h.switchRequests).toEqual(["note.md"]);
        expect(citation?.title).toBe("");
      }),
  );

  // Stands in for a position-dependent style, whose second occurrence of one
  // source reads as the subsequent form.
  const IBID = (source: string, index: number): string =>
    index === 0 ? `«${source}»` : "ibid";

  it.live(
    "shows each occurrence the text rendered for its own place in the document",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "One [@alpha].\n\nTwo [@alpha].",
          renderText: IBID,
        });
        const first = section("<p>One [@alpha].</p>");
        const second = section("<p>Two [@alpha].</p>");

        h.process(first, h.sectionCtx({ from: 0, to: 0 }));
        h.process(second, h.sectionCtx({ from: 2, to: 2 }));

        expect(first.textContent).toBe(`One «[@${ALPHA_KEY}]».`);
        expect(second.textContent).toBe("Two ibid.");
      }),
  );

  it.live(
    "shows first-occurrence text in a section Obsidian places nowhere",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "One [@alpha].\n\nTwo [@alpha].",
          renderText: IBID,
        });
        const el = section("<p>Two [@alpha].</p>");

        h.process(el, h.sectionCtx(null));

        expect(el.textContent).toBe(`Two «[@${ALPHA_KEY}]».`);
      }),
  );

  it.live("keeps source when no engine formats the citation", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [see @alpha, p. 3] blah.",
        formats: false,
      });
      const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe("Blah [see @alpha, p. 3] blah.");
    }),
  );

  it.live("keeps source while formatted citation presentation is off", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [see @alpha, p. 3] blah.",
        overrides: { "citation.show-formatted": false },
      });
      const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe("Blah [see @alpha, p. 3] blah.");
    }),
  );

  it.live("keeps source visible while citation text is pending", () =>
    Effect.gen(function* () {
      const render = pendingRender();
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        formatCitations: () => render.pending,
      });
      const el = section("<p>Blah [@alpha].</p>");
      const settled = yield* h.settles("note.md");

      // The post-processor returns without waiting for the read it starts.
      expect(h.postProcessor(el, h.ctx)).toBeUndefined();
      expect(el.textContent).toBe("Blah [@alpha].");

      render.settle([rendered("«[@alpha]»")]);
      yield* settled;
    }),
  );

  it.live(
    "marks source as neutral while citation-key resolution is pending",
    () =>
      Effect.gen(function* () {
        const pending = new Promise<readonly RenderedCitation[]>(
          () => undefined,
        );
        const h = yield* makeHarness({
          body: "Blah [@alpha].",
          formatCitations: () => pending,
          resolutionPending: true,
        });
        const el = section("<p>Blah [@alpha].</p>");

        h.process(el, h.ctx);

        expect(el.textContent).toBe("Blah [@alpha].");
        expect(
          el.querySelector(`.${themeHook.citationKeyPending}`),
        ).not.toBeNull();
        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).toBeNull();
      }),
  );

  it.live("leaves a citekey no Literature Note carries as written", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "@ghost blah.",
        cited: [citation("ghost", null)],
      });
      const el = section("<p>@ghost blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe("@ghost blah.");
    }),
  );

  it.live(
    "exposes the literal theme hooks for each literal Citation resolution state",
    () =>
      Effect.gen(function* () {
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
          yield* Effect.scoped(
            Effect.gen(function* () {
              const h = yield* makeHarness({ body, cited, ambiguousKeys });
              const el = section(`<p>${body}</p>`);

              h.process(el, h.ctx);

              const rendered = el.querySelector("span");
              for (const className of classes) {
                expect(rendered?.classList.contains(className)).toBe(true);
              }
              for (const className of absent ?? []) {
                expect(rendered?.classList.contains(className)).toBe(false);
              }
            }),
          );
        }
      }),
  );

  it.live("shows the rendered citation's popover while navigation is off", () =>
    Effect.gen(function* () {
      // The Hover Action owns hover on its own, so a rendered citation answers
      // with the popover while Citekey Navigation is off.
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: { "citation.open-as-links": false },
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));
      const citationEl = el.querySelector<HTMLElement>(".zt-citation")!;
      citationEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

      expect(h.popoverRequests).toHaveLength(1);
      expect(h.popoverRequests[0]).toMatchObject({
        targetEl: citationEl,
        works: [{ citekey: "alpha" }],
        sourcePath: "note.md",
      });
    }),
  );

  it.live(
    "leaves the rendered citation's plain click inert while navigation is off",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "Blah [@alpha].",
          overrides: {
            "citation.open-as-links": false,
            "citation.hover-action": "off",
          },
        });
        const el = section("<p>Blah [@alpha].</p>");
        const event = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        });

        h.process(el, h.viewedCtx(el));
        const citationEl = el.querySelector<HTMLElement>(".zt-citation")!;
        citationEl.dispatchEvent(event);

        expect(h.opened).toEqual([]);
        expect(h.popoverRequests).toEqual([]);
        expect(event.defaultPrevented).toBe(false);
        // The citation says as much: nothing to click, so it reads as static text.
        expect(citationEl.dataset.ztClick).toBe("none");
      }),
  );

  it.live("states that a rendered citation opens while navigation is on", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: { "citation.open-as-links": true },
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));

      expect(
        el.querySelector<HTMLElement>(".zt-citation")!.dataset.ztClick,
      ).toBe("open");
    }),
  );

  it.live("opens the work a Mod-click names while navigation is off", () =>
    Effect.gen(function* () {
      vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
      vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
      yield* Effect.addFinalizer(() => Effect.sync(() => vi.restoreAllMocks()));
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: { "citation.open-as-links": false },
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));
      el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

      expect(h.popoverRequests).toEqual([]);
      expect(h.opened).toEqual([["alpha", "tab"]]);
    }),
  );

  it.live(
    "opens the work a plain click names while Citations open as links",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "Blah [@alpha].",
          overrides: { "citation.open-as-links": true },
        });
        const el = section("<p>Blah [@alpha].</p>");

        h.process(el, h.viewedCtx(el));
        el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );

        expect(h.popoverRequests).toEqual([]);
        expect(h.opened).toEqual([["alpha", false]]);
      }),
  );

  it.live("keeps an unrendered citation opening as a link", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: {
          "citation.show-formatted": false,
          "citation.open-as-links": true,
        },
      });
      const el = section("<p>Blah [@alpha].</p>");

      // Citations open as links here, so the rendering is off but the citation
      // is still wrapped; turning navigation off as well retires the treatment.
      h.process(el, h.viewedCtx(el));
      el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

      expect(h.popoverRequests).toEqual([]);
      expect(h.opened).toEqual([["alpha", false]]);
    }),
  );

  it.live("leaves the reading view alone while the treatment is off", () =>
    Effect.gen(function* () {
      for (const overrides of [
        {
          "citation.show-formatted": false,
          "citation.open-as-links": false,
        },
        { "citation.pandoc-citations": false },
      ]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const h = yield* makeHarness({
              body: "Blah [@alpha].",
              overrides,
            });
            const el = section("<p>Blah [@alpha].</p>");

            h.process(el, h.ctx);

            expect(el.textContent).toBe("Blah [@alpha].");
            expect(el.querySelector(".zt-citation-key")).toBeNull();
          }),
        );
      }
    }),
  );

  // Sidebar occurrence navigation flashes the block element the line sits in,
  // so the swap has to stay inside that element and leave it in place.
  it.live("keeps the block element a reading-view flash targets", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [@alpha] blah.",
      });
      const el = section("<p>Blah [@alpha] blah.</p>");
      const block = el.firstElementChild!;

      h.process(el, h.ctx);

      expect(el.children).toHaveLength(1);
      expect(el.firstElementChild).toBe(block);
      expect(block.querySelector("span.zt-citation")).not.toBeNull();
    }),
  );

  it.live("formats a document once for every section that asks", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "One [@alpha].\n\nTwo [@alpha].",
      });

      h.process(section("<p>One [@alpha].</p>"), h.ctx);
      h.process(section("<p>Two [@alpha].</p>"), h.ctx);

      expect(h.citationRequests).toHaveLength(1);
    }),
  );
});

describe("CitekeyReading refresh", () => {
  it.live(
    "refreshes a rendered citation in place when its document's text changes",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ body: "Blah [@alpha]." });
        const el = section("<p>Blah [@alpha].</p>");
        h.process(el, h.viewedCtx(el));
        const block = el.firstElementChild;
        expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);

        h.renderAs((source) => `‹${source}›`);
        const settled = yield* h.settles("note.md");
        h.changeFile("note.md");
        // The stale text stays while the replacement read runs.
        expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
        yield* settled;

        expect(el.textContent).toBe(`Blah ‹[@${ALPHA_KEY}]›.`);
        expect(el.firstElementChild).toBe(block);
        expect(el.querySelectorAll(".zt-citation")).toHaveLength(1);
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.live("leaves another document's sections alone", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      // A document nothing has read stays quiet, so the other one is read first.
      yield* h.read("other.md");
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));

      h.renderAs((source) => `‹${source}›`);
      const changed = yield* h.changes("other.md");
      h.changeFile("other.md");
      yield* changed;

      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
      expect(h.rerenders()).toBe(0);
    }),
  );

  it.live("fills a section in that rendered while its text was pending", () =>
    Effect.gen(function* () {
      const render = pendingRender();
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        formatCitations: () => render.pending,
      });
      const el = section("<p>Blah [@alpha].</p>");
      const settled = yield* h.settles("note.md");
      h.process(el, h.viewedCtx(el));
      expect(el.textContent).toBe("Blah [@alpha].");

      render.settle([rendered("«[@alpha]»")]);
      yield* settled;

      expect(el.textContent).toBe("Blah «[@alpha]».");
      expect(el.querySelector(".zt-citation")).not.toBeNull();
      expect(h.rerenders()).toBe(0);
    }),
  );

  it.live(
    "keeps the current text when the fresh text holds nothing for a citation",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ body: "Blah [@alpha]." });
        const el = section("<p>Blah [@alpha].</p>");
        h.process(el, h.viewedCtx(el));

        h.stopFormatting();
        const settled = yield* h.settles("note.md");
        h.changeFile("note.md");
        yield* settled;

        expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
      }),
  );

  it.live(
    "keeps key state with the held document until its fresh read arrives",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "[@twin]",
          cited: [citation("twin", null)],
        });
        const el = section("<p>[@twin]</p>");
        h.process(el, h.viewedCtx(el));
        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).not.toBeNull();

        const settled = yield* h.settles("note.md");
        h.rebuildResolution(["twin"]);

        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).not.toBeNull();
        yield* settled;
        expect(
          el.querySelector(`.${themeHook.citationKeyAmbiguous}`),
        ).not.toBeNull();
        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).toBeNull();
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.live("keeps a placed element across a refresh whose answer is equal", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));
      const element = el.querySelector<HTMLElement>(".zt-citation")!;

      // Every text goes stale at once, and the rebuilt snapshot answers the same.
      const rebuilt = yield* h.settles("note.md");
      h.rebuildResolution([]);
      yield* rebuilt;
      const changed = yield* h.settles("note.md");
      h.changeFile("note.md");
      yield* changed;

      expect(el.querySelector(".zt-citation")).toBe(element);
      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(h.popoverRequests).toHaveLength(1);
    }),
  );

  it.live("answers one hover with one popover after a refresh", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));

      h.renderAs((source) => `‹${source}›`);
      const settled = yield* h.settles("note.md");
      h.changeFile("note.md");
      yield* settled;
      expect(el.textContent).toBe(`Blah ‹[@${ALPHA_KEY}]›.`);
      el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );

      expect(h.popoverRequests).toHaveLength(1);
    }),
  );

  it.live("leaves a section Obsidian tore down alone", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));
      expect(h.activeLookups()).toBe(1);
      h.unloadSections();
      expect(h.activeLookups()).toBe(0);

      h.renderAs((source) => `‹${source}›`);
      const changed = yield* h.changes("note.md");
      h.changeFile("note.md");
      yield* changed;

      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
    }),
  );
});
