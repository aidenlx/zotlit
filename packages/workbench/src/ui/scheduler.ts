// One Render Scheduler per editor instance, which both hosts drive live
// rendering through: a quiet time after the last edit, Run to render now, Stop
// to pause while a render already running finishes, On demand to hold until
// Run, and a stamp that drops a result the reader has already typed or chosen
// past. It follows the document controller and the view store on its own; a
// host adds only what a render reads that this package cannot know — the paper,
// the annotation example, and its own bundle.

import type { WorkbenchDocumentController } from "#/document/controller";
import type { RenderRequest, RenderResources } from "#/render/request";
import type {
  ProfileRenderResult,
  RenderDiagnostic,
  RenderIdentity,
} from "#/render/result";
import type { AnnotationExample } from "#/render/sample-annotations";
import type { ItemSnapshot } from "#/snapshot/index";

import type { WorkbenchStore } from "./store";

import {
  failedRender,
  profileSourceRevision,
  renderIdentity,
} from "#/render/result";

export interface RenderSchedulerInput {
  /** The paper a render is shown against; `null` while the host loads one. */
  readonly snapshot: ItemSnapshot | null;
  readonly annotation?: AnnotationExample | null;
  readonly resources?: RenderResources;
  /**
   * Holds rendering while the host cannot answer for this draft — a Profile it
   * refuses, or a dependency bundle read for another one. Unlike Stop, a render
   * in flight is dropped, and the result still shown reads as stale.
   */
  readonly hold?: boolean;
}

export interface RenderSchedulerState<
  R extends ProfileRenderResult = ProfileRenderResult,
> {
  readonly result: R | null;
  /** Set from the moment a render starts until its result lands or is dropped. */
  readonly busy: boolean;
  /** Whether `result` describes a draft, paper, or mode the reader has left. */
  readonly stale: boolean;
}

export interface RenderSchedulerOptions<R extends ProfileRenderResult> {
  /** Renders one request on the calling thread. */
  readonly render: (request: RenderRequest) => Promise<R>;
  /**
   * The host's own shape for a result this scheduler composed itself, so a
   * failure reads like every other result the host publishes.
   */
  readonly failed: (result: ProfileRenderResult) => R;
  readonly controller: WorkbenchDocumentController;
  readonly store: WorkbenchStore;
  /** Quiet time after the last edit before a render starts. @default 300 */
  readonly debounceMs?: number;
}

export interface RenderScheduler<
  R extends ProfileRenderResult = ProfileRenderResult,
> extends Disposable {
  readonly getState: () => RenderSchedulerState<R>;
  readonly subscribe: (listener: () => void) => () => void;
  /** What the host supplies for every render from here on. */
  setInput(input: RenderSchedulerInput): void;
  /** Something a render reads changed outside the document. */
  invalidate(): void;
  /** Run: renders now, whatever the refresh setting says. */
  run(): void;
  /** Stop: no new render starts; one already running finishes. */
  pause(): void;
  /** Shows `diagnostic` where the host could not supply what a render reads. */
  fail(diagnostic: RenderDiagnostic): void;
  /**
   * Swaps the document authority — one editor instance keeps its scheduler
   * across the controllers a reopened file brings.
   */
  attach(controller: WorkbenchDocumentController): void;
}

export function createRenderScheduler<R extends ProfileRenderResult>({
  render,
  failed,
  controller: attached,
  store,
  debounceMs = 300,
}: RenderSchedulerOptions<R>): RenderScheduler<R> {
  let controller = attached;
  let input: RenderSchedulerInput = { snapshot: null };
  let state: RenderSchedulerState<R> = {
    result: null,
    busy: false,
    stale: false,
  };
  let pending: ReturnType<typeof setTimeout> | undefined;
  let current: RenderIdentity | undefined;
  const listeners = new Set<() => void>();

  function follow(next: WorkbenchDocumentController): () => void {
    return next.subscribe(({ docChanged }) => {
      if (docChanged) changed();
    });
  }
  let unfollow = follow(attached);
  const unsubscribe = store.subscribe((next, previous) => {
    if (next.preview.mode !== previous.preview.mode) changed();
    else if (next.preview.live !== previous.preview.live) {
      if (next.preview.live) changed();
      else pause();
    }
  });

  function publish(next: { result?: R | null; busy?: boolean }): void {
    const result = next.result === undefined ? state.result : next.result;
    const busy = next.busy ?? state.busy;
    const stale =
      input.hold === true ||
      (result !== null &&
        (result.sourceRevision !== profileSourceRevision(controller.source) ||
          (input.snapshot !== null &&
            result.snapshotRevision !== input.snapshot.revision) ||
          result.previewMode !== store.getState().preview.mode));
    if (
      result === state.result &&
      busy === state.busy &&
      stale === state.stale
    ) {
      return;
    }
    state = { result, busy, stale };
    for (const listener of listeners) listener();
  }

  /** What a render would be asked for now, or `null` while nothing may run. */
  function nextRequest(): RenderRequest | null {
    const { snapshot, annotation, resources, hold } = input;
    if (hold === true || snapshot === null) return null;
    return {
      mode: store.getState().preview.mode,
      source: controller.source,
      snapshot,
      ...(annotation ? { annotation } : {}),
      ...(resources ? { resources } : {}),
    };
  }

  /** Drops queued and running work alike, which Stop deliberately does not. */
  function abandon(): void {
    clearTimeout(pending);
    pending = undefined;
    current = undefined;
  }

  function pause(): void {
    clearTimeout(pending);
    pending = undefined;
  }

  function start(request: RenderRequest): void {
    // The stamp doubles as this start's token: whatever replaces it leaves the
    // render it belonged to answering into a scheduler that has moved on.
    const identity = renderIdentity(request);
    current = identity;
    pending = undefined;
    publish({ busy: true });
    void render(request).then(
      (result) => {
        if (current !== identity) return;
        current = undefined;
        publish({ result, busy: false });
      },
      // A template that throws stops this render, not the host around it.
      (error: unknown) => {
        if (current !== identity) return;
        current = undefined;
        publish({
          result: failed(
            failedRender(identity, {
              code: "render-error",
              message: error instanceof Error ? error.message : String(error),
              part: "render",
            }),
          ),
          busy: false,
        });
      },
    );
  }

  function changed(): void {
    // A render in flight would answer for a source, paper, example, or mode the
    // reader has moved past, so it is dropped whatever the refresh setting says;
    // only Stop, which leaves the input alone, lets one land.
    abandon();
    const request = nextRequest();
    if (request !== null && store.getState().preview.live) {
      pending = setTimeout(() => start(request), debounceMs);
    }
    publish({ busy: false });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setInput(next) {
      input = next;
      // No paper, nothing to render: whatever is shown describes another one.
      if (next.snapshot === null) {
        abandon();
        publish({ result: null, busy: false });
        return;
      }
      changed();
    },
    invalidate: changed,
    run() {
      const request = nextRequest();
      if (request === null) return;
      abandon();
      start(request);
    },
    pause,
    fail(diagnostic) {
      abandon();
      publish({
        result: failed(
          failedRender(
            {
              previewMode: store.getState().preview.mode,
              sourceRevision: profileSourceRevision(controller.source),
              snapshotRevision: input.snapshot?.revision ?? "",
            },
            diagnostic,
          ),
        ),
        busy: false,
      });
    },
    attach(next) {
      unfollow();
      controller = next;
      unfollow = follow(next);
      changed();
    },
    [Symbol.dispose]() {
      abandon();
      unfollow();
      unsubscribe();
      listeners.clear();
    },
  };
}
