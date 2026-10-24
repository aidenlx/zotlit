// The Annotation Popover as an Effect service.
import { Context, Effect, Layer } from "@/lib/effect";
import { scopedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { acquireDisposable } from "@/lib/effect-scope";
import { ObsidianApp } from "@/lib/obsidian-app";
import { AnnotationRepository } from "@/services/annotation-repository/service";
import type { ExcerptDisplayService } from "@/services/excerpt-image/display";
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

export function layerAnnotationPopover(options: {
  /** The Excerpt Image display, once the container has built it. */
  readonly excerptDisplay: () => Pick<ExcerptDisplayService, "open"> | null;
}): Layer.Layer<
  AnnotationPopover,
  never,
  AnnotationRepository | ZoteroReads | ZoteroPref | ObsidianApp
> {
  return Layer.effect(
    AnnotationPopover,
    Effect.gen(function* () {
      const repository = yield* AnnotationRepository;
      const reads = yield* ZoteroReads;
      const pref = yield* ZoteroPref;
      const app = yield* ObsidianApp;
      const bridge = yield* scopedBridge;
      const core = yield* acquireDisposable(
        () =>
          new AnnotationPopoverCore({
            annotations: repository,
            bridge,
            excerptDisplay: options.excerptDisplay,
            excerptRequest: savedExcerptRequestOver({ reads, pref, bridge }),
            commentRenderer: (owner, sourcePath) =>
              createCommentRenderer({
                app,
                component: owner,
                getSourcePath: () => sourcePath,
              }),
          }),
      );
      return AnnotationPopover.of({
        // The core catches read failures, and this starts its first read now.
        show: (request) => Effect.promise(() => core.show(request)),
      });
    }).pipe(withLogCategory("annotation-popover")),
  );
}
