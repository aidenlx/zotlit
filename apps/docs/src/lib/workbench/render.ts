// The web's binding of the host adapter's render, run on the page's own thread
// so a Profile draft is exposed to what a real note creation is exposed to.

import { Effect } from "effect";

import { renderProfile } from "@zotlit/workbench/render";
import type {
  TemplateRenderResult,
  RenderRequest,
} from "@zotlit/workbench/render";
import { WorkbenchHostError } from "@zotlit/workbench/ui";

/**
 * Renders `request` on the page's thread. The caller has `Temporal` in place:
 * the Rendering service loads it before each render.
 */
export const renderInThread = (
  request: RenderRequest,
): Effect.Effect<TemplateRenderResult, WorkbenchHostError> =>
  Effect.try({
    try: () => renderProfile(request.source, request.snapshot, request),
    catch: (cause) => new WorkbenchHostError({ cause }),
  });
