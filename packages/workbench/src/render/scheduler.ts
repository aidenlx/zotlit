// Per-render Worker orchestration: one debounce, one deadline, and a revision
// stamp that keeps a late result from replacing a newer one.

import type {
  SelectedCitationStyleResponse,
  TemplateDependenciesResponse,
} from "@/bridge/contracts";
import type { ItemSnapshot } from "@/snapshot/index";

import { failedRender, profileSourceRevision } from "./result";
import type { ProfileRenderResult, RenderIdentity } from "./result";

export interface RenderRequest {
  readonly source: string;
  readonly snapshot: ItemSnapshot;
  readonly resources?: RenderResources;
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
  /** Quiet time after the last edit before a render starts. @default 300 */
  readonly debounceMs?: number;
  /** Time a render may take before its Worker is terminated. @default 2000 */
  readonly deadlineMs?: number;
}

export interface RenderScheduler extends Disposable {
  /** Queues a render of `request`, replacing any render still in flight. */
  request(request: RenderRequest): void;
}

export function createRenderScheduler({
  startWorker,
  onResult,
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
  }

  function settle(result: ProfileRenderResult): void {
    // The identity stamp is the whole staleness check: a result that names a
    // revision pair the reader has already moved past is dropped unread.
    if (
      result.sourceRevision !== current?.sourceRevision ||
      result.snapshotRevision !== current.snapshotRevision
    ) {
      return;
    }
    stop();
    onResult(result);
  }

  function start(request: RenderRequest): void {
    const identity: RenderIdentity = {
      sourceRevision: profileSourceRevision(request.source),
      snapshotRevision: request.snapshot.revision,
    };
    current = identity;
    worker = startWorker(request, settle);
    deadline = setTimeout(() => {
      settle(
        failedRender(identity, {
          code: "render-timeout",
          message: `Rendering took longer than ${deadlineMs} ms and was stopped.`,
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
    [Symbol.dispose]: stop,
  };
}
