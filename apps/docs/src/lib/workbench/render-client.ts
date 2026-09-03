// Browser side of the render Worker, handed to the core's scheduler as its
// Worker factory.

import { failedRender, profileSourceRevision } from "@zotlit/workbench/render";
import type {
  ProfileRenderResult,
  RenderRequest,
} from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

export function startRenderWorker(
  request: RenderRequest,
  deliver: (result: ProfileRenderResult) => void,
): { terminate(): void } {
  const worker = new Worker(new URL("./render-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener(
    "message",
    ({ data }: MessageEvent<ProfileRenderResult>) => deliver(data),
  );
  // A Worker that fails to boot, throws, or answers with something structured
  // clone cannot read delivers nothing; reported here it keeps the scheduler's
  // deadline for the one cause it names.
  const fail = (message: string) =>
    deliver(
      failedRender(
        {
          sourceRevision: profileSourceRevision(request.source),
          snapshotRevision: request.snapshot.revision,
        },
        { code: "render-error", message, part: "render" },
      ),
    );
  worker.addEventListener("error", (event) =>
    fail(event.message || m.workbench_render_worker_failed()),
  );
  worker.addEventListener("messageerror", () =>
    fail(m.workbench_render_worker_failed()),
  );
  worker.postMessage(request);
  return { terminate: () => worker.terminate() };
}
