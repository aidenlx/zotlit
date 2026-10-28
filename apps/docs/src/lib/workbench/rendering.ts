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
import { ensureTemporal } from "./temporal";

export class Rendering extends Context.Service<
  Rendering,
  {
    /**
     * Loads `Temporal` where the runtime has none. The module loader keeps the
     * polyfill, so the page downloads it once.
     */
    readonly temporal: Effect.Effect<void, WorkbenchHostError>;
    render(
      request: RenderRequest,
    ): Effect.Effect<TemplateRenderResult, WorkbenchHostError>;
  }
>()("zotlit/docs/workbench/Rendering") {}

export const layerRendering = Layer.succeed(
  Rendering,
  Rendering.of({
    temporal: Effect.tryPromise({
      try: () => ensureTemporal(),
      catch: (cause) => new WorkbenchHostError({ cause }),
    }).pipe(Effect.withSpan("Rendering.temporal")),
    render: Effect.fn("Rendering.render")((request: RenderRequest) =>
      Effect.tryPromise({
        try: () => renderInThread(request),
        catch: (cause) => new WorkbenchHostError({ cause }),
      }),
    ),
  }),
);
