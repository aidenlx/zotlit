// Per-render Worker orchestration: one debounce, one deadline, and a revision
// stamp that keeps a late result from replacing a newer one.

import type {
  SelectedCitationStyleResponse,
  TemplateDependenciesResponse,
} from "#/bridge/contracts";
import type { ItemSnapshot } from "#/snapshot/index";

import { failedRender, renderIdentity } from "./result";
import type { ProfileRenderResult, RenderIdentity } from "./result";
import type { AnnotationExample } from "./sample-annotations";

export interface RenderOptions {
  /** Update uses a synthesized note when the host has no existing note. */
  readonly mode?: "create" | "update";
  readonly annotation?: AnnotationExample;
  readonly resources?: RenderResources;
}

export interface RenderRequest extends RenderOptions {
  readonly source: string;
  readonly snapshot: ItemSnapshot;
}

export interface RenderResources {
  readonly dependencies: TemplateDependenciesResponse;
  readonly citationStyle: SelectedCitationStyleResponse;
}

/** One render's Worker, which the scheduler owns and terminates. */
export interface RenderWorkerHandle {
  terminate(): void;
}

export interface RenderSchedulerOptions {
  /** Starts a fresh Worker for one request; `deliver` is called at most once. */
  readonly startWorker: (
    request: RenderRequest,
    deliver: (result: ProfileRenderResult) => void,
  ) => RenderWorkerHandle;
  readonly onResult: (result: ProfileRenderResult) => void;
  readonly onBusy?: (busy: boolean) => void;
  /** Quiet time after the last edit before a render starts. @default 300 */
  readonly debounceMs?: number;
  /** Time a render may take before its Worker is terminated. @default 2000 */
  readonly deadlineMs?: number;
}

export interface RenderScheduler extends Disposable {
  /** Queues a render of `request`, replacing any render still in flight. */
  request(request: RenderRequest): void;
  /** Starts now, replacing queued or running work. */
  run(request: RenderRequest): void;
  /** Pauses queued work; a render already in flight can finish. */
  pause(): void;
}

export function createRenderScheduler({
  startWorker,
  onResult,
  onBusy,
  debounceMs = 300,
  deadlineMs = 2000,
}: RenderSchedulerOptions): RenderScheduler {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let worker: RenderWorkerHandle | undefined;
  let current: RenderIdentity | undefined;

  function stop(): void {
    clearTimeout(pending);
    clearTimeout(deadline);
    pending = undefined;
    deadline = undefined;
    worker?.terminate();
    worker = undefined;
    current = undefined;
    onBusy?.(false);
  }

  function settle(result: ProfileRenderResult): void {
    // The identity stamp is the whole staleness check: a result that names a
    // source, paper, or annotation the reader has moved past is dropped unread.
    if (
      result.sourceRevision !== current?.sourceRevision ||
      result.snapshotRevision !== current.snapshotRevision ||
      result.annotationId !== current.annotationId ||
      result.annotationRevision !== current.annotationRevision ||
      result.previewMode !== current.previewMode
    ) {
      return;
    }
    stop();
    onResult(result);
  }

  function start(request: RenderRequest): void {
    const identity = renderIdentity(request);
    current = identity;
    pending = undefined;
    onBusy?.(true);
    const started = startWorker(request, (result) => {
      if (current === identity) settle(result);
    });
    // A host may answer synchronously, before it returns the worker handle.
    if (current !== identity) {
      started.terminate();
      return;
    }
    worker = started;
    deadline = setTimeout(() => {
      settle(
        failedRender(identity, {
          code: "render-timeout",
          params: { deadlineMs },
          part: "render",
        }),
      );
    }, deadlineMs);
  }

  return {
    request(request) {
      stop();
      pending = setTimeout(() => start(request), debounceMs);
    },
    run(request) {
      stop();
      start(request);
    },
    pause() {
      clearTimeout(pending);
      pending = undefined;
    },
    [Symbol.dispose]: stop,
  };
}
