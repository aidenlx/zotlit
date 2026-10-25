// The Excerpt Image capability as a tag in the plugin's Layer graph. It lives
// apart from the legacy Service class, which keeps its LogTape logger until it
// converts: a file that imports Effect logs through Effect (policies/logging.md).
import { Context, Effect } from "effect";

import { serviceLayer } from "@/services/service-layer";

import type { ExcerptReaderDocuments } from "./reader-borrow";
import { reapExcerptTemps } from "./reap-temps";
import { ExcerptImageService } from "./service";
import type { ExcerptStore } from "./store";

/** The Excerpt Image capability: one PDF render queue and its device store. */
export class ExcerptImages extends Context.Service<
  ExcerptImages,
  ExcerptImageService
>()("zotlit/excerpt-image/ExcerptImages") {}

/**
 * Building the layer also starts evicting the stale excerpt PNGs earlier runs
 * published, on the layer's Scope: the launch never waits on the sweep, and
 * unload interrupts it.
 */
export function layerExcerptImages(options: {
  openStore: () => Promise<ExcerptStore>;
  readers: ExcerptReaderDocuments;
}) {
  return serviceLayer(ExcerptImages, {
    key: "excerptImage",
    make: Effect.gen(function* () {
      yield* reapExcerptTemps().pipe(Effect.forkScoped);
      return new ExcerptImageService(options);
    }),
  });
}
