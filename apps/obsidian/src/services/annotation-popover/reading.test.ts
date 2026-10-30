// @vitest-environment happy-dom
// What a hovered link in reading view shows is proven in the running app
// (`packages/e2e/src/annotation-links.e2e.ts`). These cases cover the hover
// listener's lifecycle, which the End-to-end Run cannot reach: the pointer
// moving within one link, a section Obsidian unloads, and a service that is
// gone while its sections stay rendered.
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer, Scope, Stream } from "effect";
import { Component, MarkdownView } from "obsidian";
import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownSectionInformation,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect } from "vitest";

import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { testPluginHost } from "@/lib/__fixtures__/plugin-host";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import { presented } from "@/services/citation-text/__fixtures__";
import type { DocumentCitations } from "@/services/citation-text/present";
import { CitationText } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import {
  AnnotationLinkReadingCore,
  layerAnnotationLinkReading,
} from "./reading";
import type { AnnotationLinkReadingDeps } from "./reading";
import { AnnotationPopover } from "./service";
import type { AnnotationHoverRequest } from "./service";

const HREF = "zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1";

/**
 * One rendered reading-view section holding a Durable Annotation Link, inside
 * a Markdown view, with the hovers it sends recorded. Obsidian's post-processor registry and its workspace stand outside the
 * test; the section is a real component Obsidian would unload.
 */
async function harness(
  stack: AsyncDisposableStack,
  {
    html = `<p><a class="external-link" href="${HREF}"><strong>p. 1</strong></a></p>`,
    citations = () => null,
    show,
    section: sectionInfo = null,
  }: {
    html?: string;
    citations?: AnnotationLinkReadingDeps["citations"];
    show?: AnnotationLinkReadingDeps["show"];
    /** Where Obsidian places the section in its note. */
    section?: MarkdownSectionInformation | null;
  } = {},
) {
  const hovers: AnnotationHoverRequest[] = [];
  let process: MarkdownPostProcessor | undefined;
  const container = document.body.appendChild(document.createElement("div"));
  stack.defer(() => container.remove());
  const view: MarkdownView = Object.assign(
    new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
    {
      containerEl: container,
      hoverPopover: null,
    },
  );
  const service = stack.use(
    new AnnotationLinkReadingCore({
      markdownViews: () => [view],
      host: {
        registerMarkdownPostProcessor: (
          postProcessor: MarkdownPostProcessor,
        ) => {
          process = postProcessor;
          return postProcessor;
        },
      },
      show: show ?? ((request) => hovers.push(request)),
      citations,
      openItem: () => {
        throw new Error("Nothing opens a Literature Note here");
      },
    }),
  );
  const el = container.appendChild(document.createElement("div"));
  el.innerHTML = html;
  const section = new Component();
  section.load();
  stack.defer(() => section.unload());
  await process!(
    el,
    stubService<MarkdownPostProcessorContext>("MarkdownPostProcessorContext", {
      sourcePath: "drafts/chapter.md",
      addChild: (child: MarkdownRenderChild) => section.addChild(child),
      getSectionInfo: () => sectionInfo,
    }),
  );
  const anchor = el.querySelector("a")!;
  return {
    anchor,
    el,
    service,
    section,
    /** Whether a hover reached the popover. */
    opened: () => hovers.length > 0,
  };
}

const enter = (anchor: Element, from: Element | null = null): void => {
  anchor.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }),
  );
};

describe("AnnotationLinkReading", () => {
  it("hovers once while the pointer moves inside one link", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    enter(run.anchor, run.anchor.querySelector("strong"));
    expect(run.opened()).toBe(false);

    enter(run.anchor);
    expect(run.opened()).toBe(true);
  });

  it("stops answering hovers once Obsidian unloads the section", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.section.unload();
    enter(run.anchor);

    expect(run.opened()).toBe(false);
  });

  it("stops answering hovers once the service is gone, though the section stays rendered", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.service[Symbol.dispose]();
    enter(run.anchor);

    expect(run.opened()).toBe(false);
  });

  it.effect("interrupts a pending hover when the plugin unloads", () =>
    Effect.gen(function* () {
      let interrupted = false;
      const started = yield* Deferred.make<void>();
      let process: MarkdownPostProcessor | undefined;
      const host = testPluginHost({
        registerMarkdownPostProcessor: (postProcessor) => {
          process = postProcessor;
          return postProcessor;
        },
      });
      const container = document.body.appendChild(
        document.createElement("div"),
      );
      yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()));
      const workspace = new MemoryWorkspace();
      workspace.openLeaf(
        "markdown",
        Object.assign(
          new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
          { containerEl: container, hoverPopover: null },
        ),
      );
      const scope = yield* Scope.fork(yield* Scope.Scope);
      yield* Layer.buildWithScope(
        layerAnnotationLinkReading.pipe(
          Layer.provide(
            Layer.mergeAll(
              host.layer,
              layerWorkspaceFrom(workspace),
              Layer.mock(PluginSettings, {
                current: Effect.succeed(defaults),
                changes: Stream.never,
              }),
              Layer.mock(CitationText, { events: Stream.never }),
              Layer.mock(CitekeyEditor, {}),
              Layer.mock(AnnotationPopover, {
                show: () =>
                  Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.onInterrupt(() =>
                      Effect.sync(() => {
                        interrupted = true;
                      }),
                    ),
                  ),
              }),
            ),
          ),
        ),
        scope,
      );
      const el = container.appendChild(document.createElement("div"));
      el.innerHTML = `<p><a class="external-link" href="${HREF}">p. 1</a></p>`;
      const section = new Component();
      section.load();
      yield* Effect.addFinalizer(() => Effect.sync(() => section.unload()));
      void process!(
        el,
        stubService<MarkdownPostProcessorContext>(
          "MarkdownPostProcessorContext",
          {
            sourcePath: "drafts/chapter.md",
            addChild: (child: MarkdownRenderChild) => section.addChild(child),
          },
        ),
      );

      enter(el.querySelector("a")!);
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);

      expect(interrupted).toBe(true);
    }),
  );
});

/** An Annotation Citation: the same link with no text of its own. */
const CITATION = `[](${HREF})`;

/** The note's citations, formatting {@link CITATION} at each of `starts`. */
function citationsOf(starts: readonly number[]): DocumentCitations {
  const text = presented("(Rougier 2014, 1)");
  return {
    lookup: lookupAnswer({}, { RUGIER24: "rougierTenSimpleRules2014" }),
    formatted: new Map([
      [
        CITATION,
        starts.map((start) => ({
          ...text,
          text: {
            ...text.text,
            citations: [{ id: "RUGIER24", mode: "normal" as const }],
          },
          start,
        })),
      ],
    ]),
    entrySerials: false,
    summaries: new Map(),
    literalWorks: new Map(),
  };
}

describe("Annotation Citations in reading view", () => {
  it("shows the formatted citation in an empty link, and its hover names the Annotation", async () => {
    await using stack = new AsyncDisposableStack();
    const shown: AnnotationHoverRequest[] = [];
    const run = await harness(stack, {
      html: `<p>See <a class="external-link" href="${HREF}"></a>.</p>`,
      citations: () => citationsOf([4]),
      show: (request) => shown.push(request),
    });

    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");

    enter(run.anchor);
    expect(shown[0]?.link.annotationKey).toBe("PUPR5FG5");
  });

  it("keeps a link with text", async () => {
    await using stack = new AsyncDisposableStack();
    const shown: AnnotationHoverRequest[] = [];
    const run = await harness(stack, {
      citations: () => citationsOf([4]),
      show: (request) => shown.push(request),
    });

    expect(run.anchor.textContent).toBe("p. 1");
  });

  it("matches each link to the citation its section holds", async () => {
    await using stack = new AsyncDisposableStack();
    const second = "(Rougier 2014, 1) again";
    const run = await harness(stack, {
      html: `<p><a class="external-link" href="${HREF}"></a></p>`,
      // The note writes the link twice; this section is its second line.
      section: { text: `${CITATION}\n${CITATION}`, lineStart: 1, lineEnd: 1 },
      citations: () => {
        const citations = citationsOf([0, CITATION.length + 1]);
        const [first, later] = citations.formatted.get(CITATION)!;
        (citations.formatted as Map<string, unknown>).set(CITATION, [
          first,
          {
            ...later!,
            text: { ...later!.text, content: [{ t: "Str", c: second }] },
          },
        ]);
        return citations;
      },
    });

    expect(run.anchor.textContent).toBe(second);
  });

  it("rewrites the citation in place when its note's citations change", async () => {
    await using stack = new AsyncDisposableStack();
    let citations: DocumentCitations | null = null;
    const run = await harness(stack, {
      html: `<p><a class="external-link" href="${HREF}"></a></p>`,
      citations: () => citations,
    });
    expect(run.anchor.hasChildNodes()).toBe(false);

    citations = citationsOf([0]);
    run.service.refresh("drafts/chapter.md");

    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");
  });
});
