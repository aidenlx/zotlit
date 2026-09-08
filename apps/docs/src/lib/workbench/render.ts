// The web's binding of the host adapter's render, run on the page's own thread
// so a Profile draft is exposed to what a real note creation is exposed to.

import { renderProfile } from "@zotlit/workbench/render";
import type {
  ProfileRenderResult,
  RenderRequest,
} from "@zotlit/workbench/render";

import { ensureTemporal } from "./temporal";

/**
 * The page loads the polyfill in an effect, so a render awaits it here rather
 * than reading a date the runtime has no `Temporal` for.
 */
export async function renderInThread(
  request: RenderRequest,
): Promise<ProfileRenderResult> {
  await ensureTemporal();
  return renderProfile(request.source, request.snapshot, request);
}
