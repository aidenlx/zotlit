// The reading-mode surface of annotation hover: a rendered Durable Annotation
// Link shows the Annotation it names, as the Hover Action asks.

import type { App, MarkdownPostProcessorContext, Plugin } from "obsidian";

import { parseAnnotationOpenUri } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { isDraftMarkdown, markdownViewOf } from "@/lib/reading-view";
import {
  annotationHoverIntent,
  hoverGesture,
  hoverPreferences,
} from "@/services/citekey-navigation";
import type { HoverPreferences } from "@/services/citekey-navigation";
import { Service } from "@/services/service-base";
import { defaults } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import type { AnnotationPopover } from "./service";

const logger = getLogger("annotation-popover");

/** Obsidian renders a link to another scheme as an external link. */
const LINK_SELECTOR = 'a.external-link[href^="zotero://open/"]';

export interface AnnotationLinkReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  settings: Pick<SettingsService, "ready" | "subscribe">;
  /** What a hovered Durable Annotation Link shows. */
  annotationPopover: Pick<AnnotationPopover, "show">;
}

/**
 * Gives every Durable Annotation Link a reading view renders the hover the
 * Hover Action names.
 *
 * Obsidian raises no `hover-link` for an external link, so a post-processor
 * puts the listener on the link itself, where it goes with the link when the
 * section renders again. The Hover Action is read per hover, so a settings
 * change needs no render.
 */
export class AnnotationLinkReading extends Service<void> {
  readonly #deps;
  #hover: HoverPreferences = hoverPreferences(defaults);
  ready: Promise<void>;

  constructor(deps: AnnotationLinkReadingDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const { settings, plugin } = this.#deps;
    await settings.ready;
    stack.defer(
      settings.subscribe((current) => {
        if (current) this.#hover = hoverPreferences(current);
      }),
    );
    plugin.registerMarkdownPostProcessor((el, ctx) => this.#process(el, ctx));
    this.commit(stack.move());
  }

  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (isDraftMarkdown(el)) return;
    for (const anchor of el.querySelectorAll<HTMLAnchorElement>(
      LINK_SELECTOR,
    )) {
      const link = parseAnnotationOpenUri(anchor.getAttribute("href") ?? "");
      if (link === null) continue;
      anchor.addEventListener("mouseover", (event) => {
        this.#hoverAt(event, anchor, { link, sourcePath: ctx.sourcePath });
      });
    }
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
    const intent = annotationHoverIntent(
      hoverGesture(event, { surface: "reading" }),
      this.#hover,
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
    this.#deps.annotationPopover.show({
      event,
      hoverParent,
      targetEl: anchor,
      sourcePath,
      link,
    });
  }
}
