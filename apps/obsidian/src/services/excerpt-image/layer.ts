// The Excerpt Image capability as a tag in the plugin's Layer graph. It lives
// apart from the legacy Service class, which keeps its LogTape logger until it
// converts: a file that imports Effect logs through Effect (policies/logging.md).
import { Context, Effect } from "effect";

import { serviceLayer } from "@/services/service-layer";

import type { ExcerptReaderDocuments } from "./reader-borrow";
import { ExcerptImageService } from "./service";
import type { ExcerptStore } from "./store";

/** The Excerpt Image capability: one PDF render queue and its device store. */
export class ExcerptImages extends Context.Service<
  ExcerptImages,
  ExcerptImageService
>()("zotlit/excerpt-image/ExcerptImages") {}

export function layerExcerptImages(options: {
  openStore: () => Promise<ExcerptStore>;
  readers: ExcerptReaderDocuments;
}) {
  return serviceLayer(ExcerptImages, {
    key: "excerptImage",
    make: Effect.sync(() => new ExcerptImageService(options)),
  });
}
