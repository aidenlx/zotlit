import { MarkdownRenderChild } from "obsidian";
import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";
// The reading-mode surface of annotation hover: a rendered Durable Annotation
// Link shows the Annotation it names, as the Hover Action asks.

import { parseAnnotationOpenUri } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { subscribe } from "@/lib/effect-stream";
import { getLogger } from "@/lib/log";
import { isDraftMarkdown, markdownViewOf } from "@/lib/reading-view";
import {
  annotationHoverIntent,
  hoverGesture,
  hoverPreferences,
  pagePreviewRequiresMod,
} from "@/services/citekey-navigation";
import type { HoverPreferences } from "@/services/citekey-navigation";
import { Service } from "@/services/service-base";
import type { PlainPluginSettings } from "@/services/settings/plain";
import { defaults } from "@/services/settings/schema";

import type { AnnotationPopover } from "./service";

const logger = getLogger("annotation-popover");

/** Obsidian renders a link to another scheme as an external link. */
const LINK_SELECTOR = 'a.external-link[href^="zotero://open/"]';

export interface AnnotationLinkReadingDeps {
  runtime: SubscriptionRuntime;
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  settings: Pick<PlainPluginSettings, "current" | "changes">;
  /** What a hovered Durable Annotation Link shows. */
  annotationPopover: Pick<AnnotationPopover, "show">;
}

/**
 * Gives every Durable Annotation Link a reading view renders the hover the
 * Hover Action names.
 *
 * Obsidian raises no `hover-link` for an external link, so a post-processor
 * puts the listener on the link itself. A render child of the section owns
 * the listener: Obsidian unloads it with the section, and this service
 * unloads every child it still holds when it goes, so a section that stays
 * rendered no longer reaches the service. The Hover Action and
 * `citation.annotation-links` are read per hover, so a settings change needs
 * no render.
 */
export class AnnotationLinkReading extends Service<void> {
  readonly #deps;
  #hover: HoverPreferences = hoverPreferences(defaults);
  /** `citation.annotation-links`: whether ZotLit treats these links at all. */
  #enabled = defaults["citation.annotation-links"];
  /** The render children holding a section's hover listeners. */
  readonly #sections = new Set<MarkdownRenderChild>();
  /** Set once the service goes; the post-processor stays registered after. */
  #disposed = false;
  ready: Promise<void>;

  constructor(deps: AnnotationLinkReadingDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const { settings, plugin } = this.#deps;

    stack.defer(
      subscribe(this.#deps.runtime, settings.changes, (current) => {
        if (!current) return;
        this.#hover = hoverPreferences(current);
        this.#enabled = current["citation.annotation-links"];
      }),
    );
    plugin.registerMarkdownPostProcessor((el, ctx) => this.#process(el, ctx));
    stack.defer(() => {
      this.#disposed = true;
      for (const section of [...this.#sections]) section.unload();
    });
    this.commit(stack.move());
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
    // Off, the link is Zotero's alone. A section already rendered keeps its
    // listener, which answers nothing, so the change needs no render.
    if (!this.#enabled) {
      logger.trace("Annotation link hover suppressed", {
        annotationKey: link.annotationKey,
        reason: "annotation-links-off",
      });
      return;
    }
    const intent = annotationHoverIntent(
      hoverGesture(event, { surface: "reading" }),
      this.#hover,
      () => pagePreviewRequiresMod(this.#deps.app),
    );
    if (intent.kind === "nothing") {
      logger.trace("Annotation link hover suppressed", {
        annotationKey: link.annotationKey,
        reason: intent.reason,
      });
      return;
    }
    const hoverParent = markdownViewOf(this.#deps.app, anchor);
    if (hoverParent === null) {
      logger.trace("Annotation link hover suppressed", {
        annotationKey: link.annotationKey,
        reason: "no-view",
      });
      return;
    }
    logger.trace("Annotation link shows its annotation", {
      annotationKey: link.annotationKey,
    });
    void this.#deps.annotationPopover.show({
      event,
      hoverParent,
      targetEl: anchor,
      sourcePath,
      link,
    });
  }
}
