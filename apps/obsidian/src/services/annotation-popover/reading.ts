import { Effect, Layer } from "effect";
import { MarkdownRenderChild } from "obsidian";
// The reading-mode surface of annotation hover: a rendered Durable Annotation
// Link shows the Annotation it names, and an Annotation Citation shows the
// citation it is where the settings ask for it.
import type { MarkdownPostProcessorContext, MarkdownView } from "obsidian";

import { parseAnnotationOpenUri } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import { scopedBridge } from "@/lib/effect-bridge";
import { forkEach } from "@/lib/effect-stream";
import { Workspace } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import type { PluginHostShape } from "@/lib/plugin-host";
import {
  rerenderReadingViewsIn,
  retireReadingSurface,
} from "@/lib/reading-surface";
import {
  isDraftMarkdown,
  markdownViewOf,
  sectionRange,
} from "@/lib/reading-view";
import type { SectionRange } from "@/lib/reading-view";
import { themeHook } from "@/lib/theme-hooks";
import { heldCitekeyOf } from "@/services/citation-index/lookup";
import { showCitation } from "@/services/citation-text/present";
import type {
  DocumentCitations,
  FormattedOccurrence,
} from "@/services/citation-text/present";
import { CitationText } from "@/services/citation-text/service";
import {
  CitekeyEditor,
  citekeyTreatment,
} from "@/services/citekey-editor/service";
import type { NavigationPane } from "@/services/citekey-navigation";
import { PluginSettings } from "@/services/settings/service";

import { AnnotationPopover } from "./service";
import type { AnnotationHoverRequest, AnnotationReference } from "./service";
import "./style.css";

/** Obsidian renders a link to another scheme as an external link. */
const LINK_SELECTOR = 'a.external-link[href^="zotero://open/"]';

/** The anchor an Annotation Citation shows its formatted text in. */
const CITATION_CLASS = "zt-annotation-citation";

export interface AnnotationLinkReadingDeps {
  host: Pick<PluginHostShape, "registerMarkdownPostProcessor">;
  /** The open Markdown views, which a hovered link's popover hangs off. */
  markdownViews: () => readonly MarkdownView[];
  /** What a hovered Durable Annotation Link shows. */
  show: (request: AnnotationHoverRequest) => void;
  /**
   * The citations held for the note at `path` while its Annotation Citations
   * show as citations, or null while they show as the links they are: the
   * settings ask for no citation, or no text is held yet.
   */
  citations: (path: string) => DocumentCitations | null;
  /** Opens the Literature Note of the Item `indexedKey`. */
  openItem: (indexedKey: string, pane: NavigationPane) => void;
}

/** One Durable Annotation Link a section renders. */
interface RenderedLink {
  anchor: HTMLAnchorElement;
  link: AnnotationOpenUriOptions;
  /** What its hover adds, once the anchor shows the citation it is. */
  reference?: AnnotationReference;
}

/** One rendered section this surface holds, and how to rewrite it. */
interface HeldSection {
  path: string;
  rewrite: () => void;
}

/**
 * Gives every Durable Annotation Link a reading view renders the Annotation
 * hover, and shows each Annotation Citation as the text a style formatted for
 * it once that text is held.
 *
 * Obsidian raises no `hover-link` for an external link, so a post-processor
 * puts the listener on the link itself. A render child of the section owns
 * the listener: Obsidian unloads it with the section, and this service
 * unloads every child it still holds when it goes, so a section that stays
 * rendered no longer reaches the service.
 *
 * An Annotation Citation keeps Obsidian's anchor, and with it the click that
 * follows the link; only its empty text gives way to the citation. A held
 * section rewrites that text in place when its document's citations change.
 */
export class AnnotationLinkReadingCore implements Disposable {
  readonly #deps;
  /** The render children holding a section's hover listeners. */
  readonly #sections = new Map<MarkdownRenderChild, HeldSection>();
  /** Set once the service goes; the post-processor stays registered after. */
  #disposed = false;

  constructor(deps: AnnotationLinkReadingDeps) {
    this.#deps = deps;
    deps.host.registerMarkdownPostProcessor((el, ctx) =>
      this.#process(el, ctx),
    );
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    for (const section of [...this.#sections.keys()]) section.unload();
  }

  /** Rewrites the held sections of one document, or of every document. */
  refresh(path?: string): void {
    for (const section of this.#sections.values()) {
      if (path === undefined || section.path === path) section.rewrite();
    }
  }

  #process(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (this.#disposed || isDraftMarkdown(el)) return;
    const links: RenderedLink[] = [];
    for (const anchor of el.querySelectorAll<HTMLAnchorElement>(
      LINK_SELECTOR,
    )) {
      const link = parseAnnotationOpenUri(anchor.getAttribute("href") ?? "");
      if (link !== null) links.push({ anchor, link });
    }
    if (links.length === 0) return;
    const rewrite = () => {
      const citations = this.#deps.citations(ctx.sourcePath);
      if (citations !== null)
        this.#showCitations(links, citations, sectionRange(ctx, el));
    };
    const section = this.#hold(el, ctx, rewrite);
    for (const rendered of links) {
      section.registerDomEvent(rendered.anchor, "mouseover", (event) => {
        this.#hoverAt(event, rendered, ctx.sourcePath);
      });
    }
    rewrite();
  }

  /**
   * Shows each Annotation Citation among `links` as its formatted text.
   *
   * The anchors carry no source position, so each one is matched to the next
   * Annotation Citation of the section, in document order, that names the
   * same Annotation. A section Obsidian places nowhere matches against the
   * whole document.
   */
  #showCitations(
    links: readonly RenderedLink[],
    citations: DocumentCitations,
    range: SectionRange | null,
  ): void {
    const occurrences = annotationOccurrences(citations, range);
    let next = 0;
    for (const rendered of links) {
      // A link with text of its own is no Annotation Citation.
      if (rendered.reference === undefined && rendered.anchor.hasChildNodes())
        continue;
      const index = occurrences.findIndex(
        ({ link }, at) => at >= next && sameAnnotation(link, rendered.link),
      );
      if (index === -1) continue;
      next = index + 1;
      const { source, occurrence } = occurrences[index]!;
      const indexedKey = occurrence.text.citations[0]?.id;
      if (indexedKey === undefined) continue;
      showCitation(rendered.anchor, occurrence, "suppress");
      rendered.anchor.classList.add(themeHook.citation, CITATION_CLASS);
      rendered.reference = {
        work: {
          // An Item with no Citation Key, or one the answer does not cover,
          // is named by its Indexed Key, which the popover shows only where
          // the Item cannot be read.
          citekey: heldCitekeyOf(citations.lookup, indexedKey) ?? indexedKey,
          indexedKey,
        },
        shown: {
          citation: { source, keys: [] },
          at: { kind: "offset", start: occurrence.start },
        },
        open: (pane) => this.#deps.openItem(indexedKey, pane),
      };
    }
  }

  /** A render child on the section, which its listeners go with. */
  #hold(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    rewrite: () => void,
  ): MarkdownRenderChild {
    const section = new MarkdownRenderChild(el);
    section.register(() => this.#sections.delete(section));
    this.#sections.set(section, { path: ctx.sourcePath, rewrite });
    ctx.addChild(section);
    return section;
  }

  #hoverAt(
    event: MouseEvent,
    { anchor, link, reference }: RenderedLink,
    sourcePath: string,
  ): void {
    // The re-entry guard Obsidian runs before its own `hover-link`: moving
    // within one link hovers it once.
    const related = event.relatedTarget as Node | null;
    if (related?.instanceOf(Node) && anchor.contains(related)) return;
    const hoverParent = markdownViewOf(this.#deps.markdownViews(), anchor);
    if (hoverParent === null) return;
    this.#deps.show({
      event,
      hoverParent,
      targetEl: anchor,
      sourcePath,
      link,
      // Read at the hover: the settings may have turned the citation off
      // since the anchor last showed it.
      reference:
        this.#deps.citations(sourcePath) === null ? undefined : reference,
    });
  }
}

/** One Annotation Citation of a document, with the text formatted for it. */
interface AnnotationOccurrence {
  /** The link as the document writes it, `[` to `)`. */
  source: string;
  link: AnnotationOpenUriOptions;
  occurrence: FormattedOccurrence;
}

/**
 * The Annotation Citations `citations` formatted inside `range`, or anywhere
 * in the document for no range, in document order.
 */
function annotationOccurrences(
  citations: DocumentCitations,
  range: SectionRange | null,
): AnnotationOccurrence[] {
  const found: AnnotationOccurrence[] = [];
  for (const [source, occurrences] of citations.formatted) {
    // Every other Citation is held under a source that never opens on `[](`.
    if (!source.startsWith("[](") || !source.endsWith(")")) continue;
    const link = parseAnnotationOpenUri(source.slice(3, -1));
    if (link === null) continue;
    for (const occurrence of occurrences) {
      if (
        range === null ||
        (occurrence.start >= range.from && occurrence.start < range.to)
      )
        found.push({ source, link, occurrence });
    }
  }
  return found.sort((a, b) => a.occurrence.start - b.occurrence.start);
}

function sameAnnotation(
  a: AnnotationOpenUriOptions,
  b: AnnotationOpenUriOptions,
): boolean {
  return (
    a.annotationKey === b.annotationKey &&
    a.attachmentKey === b.attachmentKey &&
    a.groupID === b.groupID
  );
}

/**
 * Annotation hover on every Durable Annotation Link a reading view renders,
 * and the Annotation Citations those views show as citations.
 */
export const layerAnnotationLinkReading = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const popover = yield* AnnotationPopover;
    const workspace = yield* Workspace;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const editor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    let showCitations = citekeyTreatment(
      yield* settings.current,
    ).annotationCitations;
    const core = yield* Effect.acquireDisposable(
      Effect.sync(
        () =>
          new AnnotationLinkReadingCore({
            host,
            markdownViews: () => bridge.runSync(workspace.markdownViews),
            // Unload interrupts a pending popover.
            show: (request) => bridge.runAndForget(popover.show(request)),
            citations: (path) =>
              showCitations
                ? (run(citationText.peek(path))?.value ?? null)
                : null,
            // Unload interrupts a pending open.
            openItem: (indexedKey, pane) =>
              bridge.runAndForget(editor.openIndexedKey(indexedKey, pane)),
          }),
      ),
    );
    // Turning the citations off has to bring Obsidian's own links back, which
    // only a new render does.
    yield* forkEach(settings.changes, (next) => {
      const wanted = citekeyTreatment(next).annotationCitations;
      if (wanted === showCitations) return Effect.void;
      showCitations = wanted;
      return rerenderReadingViewsIn(workspace);
    });
    yield* forkEach(citationText.events, (event) =>
      Effect.sync(() => {
        if (event.type === "changed") core.refresh(event.path);
        else if (event.type === "invalidated") core.refresh();
      }),
    );
    // A reading view holds the citations this layer wrote, so the views
    // render again without them once it is gone.
    yield* retireReadingSurface(workspace, () => {
      showCitations = false;
    });
  }),
);
