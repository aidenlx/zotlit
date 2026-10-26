// The Annotation Popover as an Effect service.
import { Context, Effect, Layer } from "effect";

import { scopedBridge, valueOr } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { ObsidianApp } from "@/lib/obsidian-app";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import type { AnnotationList } from "@/services/annotation-repository/service";
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
     * Opens the popover for one hovered link and reads what it names.
     *
     * @returns settles once that first read has drawn, or has been dropped
     *   because a newer read or a hide superseded it. A hover needs not wait
     *   on it.
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
> = Layer.effect(
  AnnotationPopover,
  Effect.gen(function* () {
    const repository = yield* AnnotationRepository;
    const excerptDisplay = yield* ExcerptDisplays;
    const reads = yield* ZoteroReads;
    const pref = yield* ZoteroPref;
    const app = yield* ObsidianApp;
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
                  valueOr<AnnotationList | null | undefined, never>(
                    exit,
                    undefined,
                  ),
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
      // The core catches read failures, and this starts its first read now.
      show: Effect.fn("AnnotationPopover.show")((request) =>
        Effect.promise(() => core.show(request)),
      ),
    });
  }).pipe(withLogCategory("annotation-popover")),
);
