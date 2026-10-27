// The plugin's excerpt store and the background sweep of stale CLI files.
import { Effect, Layer } from "effect";

import type { ExcerptReaderDocuments } from "./reader-borrow";
import { reapExcerptTemps } from "./reap-temps";
import { layerExcerptImage } from "./service";
import type { ExcerptStore } from "./store";

export function layerExcerptImages(options: {
  openStore: () => Promise<ExcerptStore>;
  readers: ExcerptReaderDocuments;
}) {
  return layerExcerptImage(options).pipe(
    Layer.merge(
      Layer.effectDiscard(reapExcerptTemps().pipe(Effect.forkScoped)),
    ),
  );
}
