import { MarkdownRenderChild } from "obsidian";
import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";
// The reading-mode surface of annotation hover: a rendered Durable Annotation
// Link shows the Annotation it names.

import { parseAnnotationOpenUri } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import { Effect, Layer } from "@/lib/effect";
import { scopedBridge } from "@/lib/effect-bridge";
import { acquireDisposable } from "@/lib/effect-scope";
import { PluginHost } from "@/lib/plugin-host";
import { isDraftMarkdown, markdownViewOf } from "@/lib/reading-view";

import { AnnotationPopover } from "./service";
import type { AnnotationHoverRequest } from "./service";

/** Obsidian renders a link to another scheme as an external link. */
const LINK_SELECTOR = 'a.external-link[href^="zotero://open/"]';

export interface AnnotationLinkReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  /** What a hovered Durable Annotation Link shows. */
  show: (request: AnnotationHoverRequest) => void;
}

/**
 * Gives every Durable Annotation Link a reading view renders the Annotation
 * hover.
 *
 * Obsidian raises no `hover-link` for an external link, so a post-processor
 * puts the listener on the link itself. A render child of the section owns
 * the listener: Obsidian unloads it with the section, and this service
 * unloads every child it still holds when it goes, so a section that stays
 * rendered no longer reaches the service.
 */
export class AnnotationLinkReadingCore implements Disposable {
  readonly #deps;
  /** The render children holding a section's hover listeners. */
  readonly #sections = new Set<MarkdownRenderChild>();
  /** Set once the service goes; the post-processor stays registered after. */
  #disposed = false;

  constructor(deps: AnnotationLinkReadingDeps) {
    this.#deps = deps;
    deps.plugin.registerMarkdownPostProcessor((el, ctx) =>
      this.#process(el, ctx),
    );
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    for (const section of [...this.#sections]) section.unload();
  }

  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (this.#disposed || isDraftMarkdown(el)) return;
    let section: MarkdownRenderChild | null = null;
    for (const anchor of el.querySelectorAll<HTMLAnchorElement>(
      LINK_SELECTOR,
    )) {
      const link = parseAnnotationOpenUri(anchor.getAttribute("href") ?? "");
      if (link === null) continue;
      section ??= this.#hold(el, ctx);
      section.registerDomEvent(anchor, "mouseover", (event) => {
        this.#hoverAt(event, anchor, { link, sourcePath: ctx.sourcePath });
      });
    }
  }

  /** A render child on the section, which its listeners go with. */
  #hold(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): MarkdownRenderChild {
    const section = new MarkdownRenderChild(el);
    section.register(() => this.#sections.delete(section));
    this.#sections.add(section);
    ctx.addChild(section);
    return section;
  }

  #hoverAt(
    event: MouseEvent,
    anchor: HTMLElement,
    {
      link,
      sourcePath,
    }: { link: AnnotationOpenUriOptions; sourcePath: string },
  ): void {
    // The re-entry guard Obsidian runs before its own `hover-link`: moving
    // within one link hovers it once.
    const related = event.relatedTarget as Node | null;
    if (related?.instanceOf(Node) && anchor.contains(related)) return;
    const hoverParent = markdownViewOf(this.#deps.app, anchor);
    if (hoverParent === null) return;
    this.#deps.show({
      event,
      hoverParent,
      targetEl: anchor,
      sourcePath,
      link,
    });
  }
}

/** Annotation hover on every Durable Annotation Link a reading view renders. */
export const layerAnnotationLinkReading = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const popover = yield* AnnotationPopover;
    const bridge = yield* scopedBridge;
    yield* acquireDisposable(
      () =>
        new AnnotationLinkReadingCore({
          app: host.app,
          plugin: host,
          show: (request) => void bridge.runPromise(popover.show(request)),
        }),
    );
  }),
);
