// The Annotation Popover as an Effect service.
import { Context, Effect, Layer } from "effect";

import { formatIndexedKey } from "@zotlit/db";

import { scopedBridge, valueOr } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { ObsidianApp } from "@/lib/obsidian-app";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import type {
  AnnotationLibraryUnresolved,
  AnnotationList,
  DatabaseRowsError,
} from "@/services/annotation-repository/service";
import { CitationPopover } from "@/services/citation-popover/service";
import { ExcerptDisplays } from "@/services/excerpt-image/display";
import { savedExcerptRequestOver } from "@/services/excerpt-image/request";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { createCommentRenderer } from "@/views/annot-view/comment-render";

import { AnnotationPopoverCore } from "./popover";
import type { AnnotationHoverRequest } from "./popover";

export type { AnnotationHoverRequest } from "./popover";

export class AnnotationPopover extends Context.Service<
  AnnotationPopover,
  {
    /**
     * Opens the Citation Popover of the Item a hovered link's Annotation
     * belongs to, with the Annotation drawn above the Item's reference.
     *
     * @returns settles once the reference's first read has drawn, or has been
     *   dropped because a newer read or a hide superseded it. A hover needs
     *   not wait on it.
     */
    show(request: AnnotationHoverRequest): Effect.Effect<void>;
  }
>()("zotlit/annotation-popover/AnnotationPopover") {}

export const layerAnnotationPopover: Layer.Layer<
  AnnotationPopover,
  never,
  | AnnotationRepository
  | ExcerptDisplays
  | ZoteroReads
  | ZoteroPref
  | ObsidianApp
  | CitationPopover
> = Layer.effect(
  AnnotationPopover,
  Effect.gen(function* () {
    const repository = yield* AnnotationRepository;
    const excerptDisplay = yield* ExcerptDisplays;
    const reads = yield* ZoteroReads;
    const pref = yield* ZoteroPref;
    const app = yield* ObsidianApp;
    const citationPopover = yield* CitationPopover;
    const bridge = yield* scopedBridge;
    const core = yield* Effect.acquireDisposable(
      Effect.sync(
        () =>
          new AnnotationPopoverCore({
            annotations: repository,
            read: (attachmentKey) =>
              bridge
                .runPromiseExit(repository.read(attachmentKey))
                .then((exit) =>
                  valueOr<
                    AnnotationList | null | undefined,
                    AnnotationLibraryUnresolved | DatabaseRowsError
                  >(exit, undefined),
                ),
            bridge,
            excerptDisplay,
            excerptRequest: savedExcerptRequestOver({ reads, pref, bridge }),
            commentRenderer: (owner, sourcePath) =>
              createCommentRenderer({
                app,
                component: owner,
                getSourcePath: () => sourcePath,
              }),
          }),
      ),
    );
    return AnnotationPopover.of({
      show: (request) =>
        citationPopover.showWork({
          event: request.event,
          hoverParent: request.hoverParent,
          targetEl: request.targetEl,
          work: {
            kind: "annotation",
            annotationKey: formatIndexedKey(
              request.link.annotationKey,
              request.link.groupID,
            ),
          },
          open: request.open,
          // The core catches read failures.
          lead: (part) => {
            void core.follow(part, request);
          },
        }),
    });
  }).pipe(withLogCategory("annotation-popover")),
);
