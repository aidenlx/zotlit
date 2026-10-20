// The annotation popover: what a hovered Durable Annotation Link names, read
// from the live Annotation repository.

import type { Component, HoverParent } from "obsidian";

import { formatIndexedKey } from "@zotlit/db";
import type { AnnotationOpenUriOptions } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type {
  AnnotationRecord,
  AnnotationRepository,
  AnnotationSource,
} from "@/services/annotation-repository/service";
import { CitationHoverPopover } from "@/services/citation-popover/popover";
import type {
  ExcerptDisplayDemand,
  ExcerptDisplayService,
} from "@/services/excerpt-image/display";
import type { ExcerptRequest } from "@/services/excerpt-image/service";
import { Service } from "@/services/service-base";
import type { CommentRenderer } from "@/views/annot-view/comment-render";

import { AnnotationPopoverContent } from "./content";

const logger = getLogger("annotation-popover");

/** One hovered Durable Annotation Link. */
export interface AnnotationHoverRequest {
  event: MouseEvent;
  /** What Obsidian hangs the popover off, and hides it with. */
  hoverParent: HoverParent;
  targetEl: HTMLElement;
  /** The note the link is written in, which a comment's own links resolve against. */
  sourcePath: string;
  /** The Annotation the link names, by bare keys. */
  link: AnnotationOpenUriOptions;
}

export interface AnnotationPopoverDeps {
  annotations: Pick<AnnotationRepository, "read" | "hold" | "on">;
  /** The live Excerpt Image display the Annotation View's cards share. */
  excerptDisplay: Pick<ExcerptDisplayService, "open">;
  /** The file inputs one saved Annotation's Excerpt Image resolves through. */
  excerptRequest: (input: {
    annotation: AnnotationRecord;
    source: AnnotationSource;
  }) => Promise<ExcerptRequest | null>;
  /**
   * Renders comments for one popover, which owns what they render.
   *
   * @param owner the popover, unloaded when it hides.
   * @param sourcePath the note a comment's links resolve against.
   */
  commentRenderer: (owner: Component, sourcePath: string) => CommentRenderer;
}

interface Visit {
  popover: CitationHoverPopover;
  window: Window;
  /** What the shown link holds: its list, its change subscription, its image. */
  subscriptions: DisposableStack;
  /** The newest read; an older one draws nothing. */
  generation: number;
}

/**
 * Shows what a hovered Durable Annotation Link names: the Annotation's quoted
 * text, comment, page label and colour, and the Excerpt Image of an image or
 * ink Annotation from ZotLit's own cache and renderer — with no reader open.
 *
 * The popover is the Citation Popover's own chrome, opened on the hover and
 * filled once the Annotation is read. Every hover reads the repository again,
 * and an open popover holds the Attachment's list and redraws on its change,
 * so an edit made in Zotero or in the Annotation View shows without a note
 * refresh. A link to an Annotation the list no longer holds says so briefly.
 */
export class AnnotationPopover extends Service {
  readonly #deps;
  readonly #visits = new Map<HoverParent, Visit>();
  #closed = false;
  ready: Promise<void>;

  constructor(deps: AnnotationPopoverDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(() => {
      this.#closed = true;
      for (const { popover } of this.#visits.values()) popover.hide();
    });
    this.commit(stack.move());
  }

  show(request: AnnotationHoverRequest): void {
    if (this.#closed) return;
    const { hoverParent, targetEl, link } = request;
    let visit = this.#visits.get(hoverParent);
    if (visit && visit.window !== targetEl.win) {
      visit.popover.hide();
      visit = undefined;
    }
    if (!visit) {
      const popover = new CitationHoverPopover(hoverParent, targetEl);
      const opened: Visit = {
        popover,
        window: targetEl.win,
        subscriptions: new DisposableStack(),
        generation: 0,
      };
      this.#visits.set(hoverParent, opened);
      popover.register(() => {
        opened.generation++;
        opened.subscriptions.dispose();
        if (this.#visits.get(hoverParent) === opened) {
          this.#visits.delete(hoverParent);
        }
      });
      visit = opened;
    } else {
      visit.generation++;
      visit.subscriptions.dispose();
      visit.subscriptions = new DisposableStack();
      visit.popover.render(null);
      visit.popover.retarget(targetEl);
    }
    this.#follow(visit, request.sourcePath, link);
  }

  /** Holds the link's list for the visit and draws it now and on every change. */
  #follow(
    visit: Visit,
    sourcePath: string,
    link: AnnotationOpenUriOptions,
  ): void {
    const deps = this.#deps;
    const { popover, subscriptions } = visit;
    const attachmentKey = formatIndexedKey(link.attachmentKey, link.groupID);
    const annotationKey = formatIndexedKey(link.annotationKey, link.groupID);
    const renderComment = deps.commentRenderer(popover, sourcePath);
    let excerpt: ExcerptDisplayDemand | null = null;
    /** Whether this visit drew the link's Annotation, or its absence, yet. */
    let drawn = false;

    // Released last: letting a held list go announces a change, which the
    // subscription below must no longer answer.
    subscriptions.use(deps.annotations.hold([attachmentKey]));
    const draw = (): void => {
      const generation = ++visit.generation;
      const current = (): boolean => visit.generation === generation;
      void deps.annotations
        .read(attachmentKey)
        .then((list) => {
          if (!current()) return;
          // No list stands: the library holds no such Attachment, or a change
          // cancelled this read and draws again — over what is drawn, if any.
          if (list === null && drawn) return;
          const annotation =
            list?.annotations.find(({ key }) => key === annotationKey) ?? null;
          drawn = true;
          if (annotation === null) {
            logger.debug("Hovered annotation link names no annotation", {
              attachmentKey,
              annotationKey,
            });
            popover.render(<AnnotationPopoverContent kind="unavailable" />);
            return;
          }
          if (list !== null && hasExcerptImage(annotation)) {
            if (excerpt === null) {
              const opened = deps.excerptDisplay.open();
              subscriptions.defer(() => opened.release());
              excerpt = opened;
            }
            const demand = excerpt;
            void deps
              .excerptRequest({ annotation, source: list.source })
              .then((request) => {
                if (current()) demand.demand(request);
              });
          }
          const shown = popover.render(
            <AnnotationPopoverContent
              kind="annotation"
              annotation={annotation}
              renderComment={renderComment}
              excerpt={excerpt}
            />,
          );
          logger.debug("Annotation popover drawn", {
            annotationKey,
            type: annotation.type,
            shown,
          });
        })
        .catch((error: unknown) => {
          if (!current()) return;
          logger.warn("Cannot read the annotations of a hovered link", {
            attachmentKey,
            error,
          });
          popover.render(<AnnotationPopoverContent kind="unavailable" />);
        });
    };
    subscriptions.defer(
      deps.annotations.on("annotations-changed", (changed) => {
        if (changed === attachmentKey) draw();
      }),
    );
    draw();
  }
}

/** Only image and ink Annotations have an Excerpt Image. */
function hasExcerptImage(annotation: AnnotationRecord): boolean {
  return annotation.type === "image" || annotation.type === "ink";
}
