// @vitest-environment happy-dom
// What a hovered link in reading view shows is proven in the running app
// (`packages/e2e/src/annotation-links.e2e.ts`). These cases cover the hover
// listener's lifecycle, which the End-to-end Run cannot reach: the pointer
// moving within one link, a section Obsidian unloads, and a service that is
// gone while its sections stay rendered.
import { Component, MarkdownView } from "obsidian";
import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import {
  setup,
  useFakeTimers,
} from "@/services/annotation-repository/__fixtures__";

import { AnnotationPopoverCore } from "./popover";
import { AnnotationLinkReadingCore } from "./reading";

const HREF = "zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1";

/**
 * One rendered reading-view section holding a Durable Annotation Link, inside
 * a Markdown view, with the real popover over the real repository behind it.
 * Obsidian's post-processor registry and its workspace stand outside the
 * test; the section is a real component Obsidian would unload.
 */
async function harness(stack: AsyncDisposableStack) {
  const { service: repository, bridge } = await setup(stack);
  const popover = stack.use(
    new AnnotationPopoverCore({
      annotations: repository,
      bridge,
      excerptDisplay: {
        open: () => {
          throw new Error("The hovered Annotation has no Excerpt Image");
        },
      },
      excerptRequest: () =>
        Promise.reject(new Error("No Excerpt Image is asked for")),
      commentRenderer: () => () => () => {},
    }),
  );
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
      show: (request) => popover.show(request),
    }),
  );
  const el = container.appendChild(document.createElement("div"));
  el.innerHTML = `<p><a class="external-link" href="${HREF}"><strong>p. 1</strong></a></p>`;
  const section = new Component();
  section.load();
  stack.defer(() => section.unload());
  await process!(
    el,
    stubService<MarkdownPostProcessorContext>("MarkdownPostProcessorContext", {
      sourcePath: "drafts/chapter.md",
      addChild: (child: MarkdownRenderChild) => section.addChild(child),
    }),
  );
  // Obsidian's hover delay runs on a fake clock; the repository's reads do not.
  useFakeTimers();
  stack.defer(() => {
    vi.useRealTimers();
  });
  const anchor = el.querySelector("a")!;
  return {
    anchor,
    service,
    section,
    /** Whether a popover opened on the view once Obsidian's delay passed. */
    opened(): boolean {
      vi.advanceTimersByTime(1000);
      return view.hoverPopover !== null;
    },
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
});
