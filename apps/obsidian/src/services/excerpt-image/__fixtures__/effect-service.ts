import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Context, Effect, Exit, Layer, Scope } from "effect";

import { ExcerptImageService, layerExcerptImage } from "@/services/excerpt-image/service";
import type { ExcerptDeps } from "@/services/excerpt-image/service";

/** One real layer, with a child scope a shutdown test can close itself. */
export const excerptImageFixture = Effect.fnUntraced(function* (deps: ExcerptDeps = {}) {
  const scope = yield* Scope.fork(yield* Scope.Scope);
  const context = yield* Layer.buildWithScope(layerExcerptImage(deps).pipe(Layer.provide(NodeFileSystem.layer)), scope);
  const service = Context.get(context, ExcerptImageService);
  return {
    ...service,
    get queueDiagnostics() { return service.queueDiagnostics; },
    close: Scope.close(scope, Exit.void),
  };
});
