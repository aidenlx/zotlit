// The render Worker's entry: one render per Worker, terminated by the scheduler
// on its deadline, so a runaway template cannot freeze the page.

import { renderProfile } from "@zotlit/workbench/render";
import type {
  ProfileRenderResult,
  RenderRequest,
} from "@zotlit/workbench/render";

import { ensureTemporal } from "./temporal";

// The app's lib set is DOM, where `self` is a `Window`; this names the parts of
// the dedicated Worker scope this file uses.
const scope = globalThis as unknown as {
  addEventListener(
    type: "message",
    handler: (event: MessageEvent<RenderRequest>) => void,
  ): void;
  postMessage(result: ProfileRenderResult): void;
};

// Messages queue until the module finishes evaluating, so the polyfill is in
// place before the first render reads a date.
await ensureTemporal();

scope.addEventListener("message", ({ data }) => {
  scope.postMessage(renderProfile(data.source, data.snapshot, data));
});
