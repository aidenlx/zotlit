// Per-render orchestration: one debounce and a revision stamp that keeps a
// late result from replacing a newer one.

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

export interface RenderSchedulerOptions {
  /** Renders one request on the calling thread. */
  readonly render: (request: RenderRequest) => Promise<ProfileRenderResult>;
  readonly onResult: (result: ProfileRenderResult) => void;
  readonly onBusy?: (busy: boolean) => void;
  /** Quiet time after the last edit before a render starts. @default 300 */
  readonly debounceMs?: number;
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
  render,
  onResult,
  onBusy,
  debounceMs = 300,
}: RenderSchedulerOptions): RenderScheduler {
  let pending: ReturnType<typeof setTimeout> | undefined;
  let current: RenderIdentity | undefined;

  function stop(): void {
    clearTimeout(pending);
    pending = undefined;
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
    // The stamp doubles as this start's token: `stop()` clears it, so a render
    // the reader has replaced answers into a scheduler that no longer knows it.
    const identity = renderIdentity(request);
    current = identity;
    pending = undefined;
    onBusy?.(true);
    void render(request).then(
      (result) => {
        if (current === identity) settle(result);
      },
      // A template that throws stops this render, not the host around it.
      (error: unknown) => {
        if (current === identity)
          settle(
            failedRender(identity, {
              code: "render-error",
              message: error instanceof Error ? error.message : String(error),
              part: "render",
            }),
          );
      },
    );
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
