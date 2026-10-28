// Rendering on the page runtime: the render the host hands the Workbench, and
// the `Temporal` polyfill load the render, the Match data and the field list
// share.

import { Context, Effect, Layer } from "effect";

import type {
  RenderRequest,
  TemplateRenderResult,
} from "@zotlit/workbench/render";
import { WorkbenchHostError } from "@zotlit/workbench/ui";

import { renderInThread } from "./render";
import { loadTemporal } from "./temporal";

export class Rendering extends Context.Service<
  Rendering,
  {
    /**
     * Loads `Temporal` where the runtime has none, once for the page: a later
     * read answers the first load's outcome.
     */
    readonly temporal: Effect.Effect<void, WorkbenchHostError>;
    render(
      request: RenderRequest,
    ): Effect.Effect<TemplateRenderResult, WorkbenchHostError>;
  }
>()("zotlit/docs/workbench/Rendering") {}

export const layerRendering = Layer.effect(
  Rendering,
  Effect.gen(function* () {
    const temporal = yield* Effect.cached(
      loadTemporal.pipe(
        Effect.mapError((cause) => new WorkbenchHostError({ cause })),
        Effect.withSpan("Rendering.temporal"),
      ),
    );
    return Rendering.of({
      temporal,
      render: Effect.fn("Rendering.render")((request: RenderRequest) =>
        Effect.andThen(temporal, () => renderInThread(request)),
      ),
    });
  }),
);
