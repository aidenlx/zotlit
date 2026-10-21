// @vitest-environment happy-dom
import { Component, MarkdownView } from "obsidian";
import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
} from "obsidian";
import { describe, expect, it } from "vitest";

import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { AnnotationLinkReading } from "./reading";
import type { AnnotationHoverRequest } from "./service";

const HREF = "zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1";

/** One rendered reading-view section holding `html`, inside a Markdown view. */
async function harness(
  stack: AsyncDisposableStack,
  html: string,
  overrides: Partial<Settings> = {},
) {
  let process: MarkdownPostProcessor | undefined;
  const shown: AnnotationHoverRequest[] = [];
  const container = document.createElement("div");
  const view = Object.assign(
    Object.create(MarkdownView.prototype) as MarkdownView,
    { containerEl: container },
  );
  const service = stack.use(
    new AnnotationLinkReading({
      app: { workspace: { getLeavesOfType: () => [{ view }] } } as never,
      plugin: {
        registerMarkdownPostProcessor: (postProcessor) => {
          process = postProcessor;
          return postProcessor;
        },
      },
      settings: {
        ready: Promise.resolve(),
        subscribe: (listener) => {
          listener({ ...defaults, ...overrides });
          return () => undefined;
        },
      },
      annotationPopover: {
        show: async (request) => {
          shown.push(request);
        },
      },
    }),
  );
  await service.ready;
  const el = container.appendChild(document.createElement("div"));
  el.innerHTML = html;
  // The children Obsidian hangs on the section, unloaded with it.
  const section = new Component();
  section.load();
  stack.defer(() => section.unload());
  await process!(el, {
    sourcePath: "drafts/chapter.md",
    addChild: (child: Component) => section.addChild(child),
  } as unknown as MarkdownPostProcessorContext);
  return { el, view, shown, service, section };
}

const hover = (anchor: Element): void => {
  anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
};

describe("AnnotationLinkReading", () => {
  it("shows the annotation a rendered Durable Annotation Link names", async () => {
    await using stack = new AsyncDisposableStack();
    const { el, view, shown } = await harness(
      stack,
      `<p>Quoted <a class="external-link" href="${HREF}">p. 1</a>.</p>`,
    );
    const anchor = el.querySelector("a")!;

    hover(anchor);

    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      hoverParent: view,
      targetEl: anchor,
      sourcePath: "drafts/chapter.md",
      link: {
        attachmentKey: "RGRPDF24",
        annotationKey: "PUPR5FG5",
        pageLabel: "1",
        groupID: null,
      },
    });
  });

  it("hovers once while the pointer moves inside one link", async () => {
    await using stack = new AsyncDisposableStack();
    const { el, shown } = await harness(
      stack,
      `<p><a class="external-link" href="${HREF}"><strong>p. 1</strong></a></p>`,
    );
    const anchor = el.querySelector("a")!;

    anchor.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: anchor.querySelector("strong"),
      }),
    );

    expect(shown).toEqual([]);
  });

  it("shows nothing while the Hover action is off", async () => {
    await using stack = new AsyncDisposableStack();
    const { el, shown } = await harness(
      stack,
      `<p><a class="external-link" href="${HREF}">p. 1</a></p>`,
      { "citation.hover-action": "off" },
    );

    hover(el.querySelector("a")!);

    expect(shown).toEqual([]);
  });

  it("stops answering hovers once the service is gone, though the section stays rendered", async () => {
    await using stack = new AsyncDisposableStack();
    const { el, shown, service } = await harness(
      stack,
      `<p><a class="external-link" href="${HREF}">p. 1</a></p>`,
    );

    await service[Symbol.asyncDispose]();
    hover(el.querySelector("a")!);

    expect(shown).toEqual([]);
  });

  it("stops answering hovers once Obsidian unloads the section", async () => {
    await using stack = new AsyncDisposableStack();
    const { el, shown, section } = await harness(
      stack,
      `<p><a class="external-link" href="${HREF}">p. 1</a></p>`,
    );

    section.unload();
    hover(el.querySelector("a")!);

    expect(shown).toEqual([]);
  });

  it("leaves a Zotero link that names no annotation alone", async () => {
    await using stack = new AsyncDisposableStack();
    const { el, shown } = await harness(
      stack,
      `<p><a class="external-link" href="zotero://select/library/items/RGRPDF24">item</a></p>`,
    );

    hover(el.querySelector("a")!);

    expect(shown).toEqual([]);
  });
});
