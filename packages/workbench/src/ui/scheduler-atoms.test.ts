import type { RenderRequest } from "#/render/request";
import type { TemplateRenderResult } from "#/render/result";
import { Deferred, Effect, Exit, Queue } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { TestClock } from "effect/testing";
import { expect, it, vi } from "vitest";

import { WorkbenchHostError } from "./host";
import type { RenderSchedulerInput } from "./scheduler";
import { makeRenderSchedulerAtoms } from "./scheduler-atoms";
import type { RenderSchedulerAtomsOptions } from "./scheduler-atoms";

import {
  failedRender,
  formatRenderReport,
  renderIdentity,
  SAMPLE_ANNOTATIONS,
  SAMPLE_ITEMS,
  templateSourceRevision,
} from "#/render/index";

const PAPER = SAMPLE_ITEMS[0]!;
const OTHER_PAPER = SAMPLE_ITEMS[1]!;
const EXAMPLE = SAMPLE_ANNOTATIONS[0]!;
const OTHER_EXAMPLE = SAMPLE_ANNOTATIONS[1]!;
const CITATION = { variant: "main", example: "one-item" } as const;
const OTHER_CITATION = { variant: "main", example: "two-items" } as const;
const PARTIAL = {
  name: "book-details",
  context: "note",
  profile: null,
} as const;
const OTHER_PARTIAL = { ...PARTIAL, context: "annotation" } as const;

/** A render the scheduler asked for, which the test answers when it chooses. */
interface PendingRender {
  readonly request: RenderRequest;
  answer(result?: Partial<TemplateRenderResult>): void;
  reject(error: unknown): void;
  /** Whether the scheduler interrupted the render before it was answered. */
  readonly interrupted: boolean;
  /** Completes once the scheduler interrupts the render. */
  readonly interruption: Deferred.Deferred<void>;
}

/**
 * A host render held open until the test answers it. It offers each request
 * to `started` and completes each render's `interruption`.
 */
function fakeRender() {
  const renders: PendingRender[] = [];
  const started = Effect.runSync(Queue.unbounded<PendingRender>());
  const render = (request: RenderRequest) =>
    Effect.callback<TemplateRenderResult, WorkbenchHostError>((resume) => {
      let interrupted = false;
      const interruption = Deferred.makeUnsafe<void>();
      const pending: PendingRender = {
        request,
        answer: (result) =>
          resume(
            Effect.succeed({
              ...failedRender(renderIdentity(request), {
                code: "render-error",
              }),
              diagnostics: [],
              ...result,
            }),
          ),
        reject: (error) =>
          resume(Effect.fail(new WorkbenchHostError({ cause: error }))),
        get interrupted() {
          return interrupted;
        },
        interruption,
      };
      renders.push(pending);
      Queue.offerUnsafe(started, pending);
      return Effect.sync(() => {
        interrupted = true;
        Deferred.doneUnsafe(interruption, Exit.void);
      });
    });
  return { renders, started, render };
}

/**
 * One scheduler in a registry of its own, over a writable input the test
 * changes the way a host model does, on a test clock.
 */
function open(
  initial: Partial<RenderSchedulerInput> = {},
  options: Partial<
    Pick<RenderSchedulerAtomsOptions<TemplateRenderResult>, "reportContext">
  > = {},
) {
  const host = fakeRender();
  const input = Atom.make<RenderSchedulerInput>({
    source: "Draft",
    snapshot: PAPER,
    annotation: EXAMPLE,
    mode: "create",
    live: true,
    ...initial,
  });
  const runtime = Atom.runtime(TestClock.layer());
  const scheduler = makeRenderSchedulerAtoms({
    runtime,
    input,
    render: host.render,
    failed: (result) => result,
    ...options,
  });
  const registry = AtomRegistry.make({
    defaultIdleTTL: 0,
    timeoutResolution: 1,
  });
  const release = registry.mount(scheduler.state);
  const context = AsyncResult.getOrThrow(registry.get(runtime));
  const state = () => registry.get(scheduler.state);
  let taken = 0;
  /** Takes the start signal of every render up to the `count`th, then checks no other started. */
  const rendered = async (count: number) => {
    while (taken < count) {
      await Effect.runPromise(Queue.take(host.started));
      taken++;
    }
    expect(host.renders).toHaveLength(count);
  };
  /** Answers a render, then waits for its result to land. */
  const settled = async (
    index: number,
    answer: (render: PendingRender) => void,
  ) => {
    await rendered(Math.max(taken, index + 1));
    const { attempt } = state();
    answer(host.renders[index]!);
    await vi.waitFor(() => expect(state().attempt).toBe(attempt + 1));
  };
  return {
    host,
    registry,
    state,
    rendered,
    interrupted: (index: number) =>
      Effect.runPromise(Deferred.await(host.renders[index]!.interruption)),
    set: (next: Partial<RenderSchedulerInput>) =>
      registry.update(input, (current) => ({ ...current, ...next })),
    run: () => registry.set(scheduler.run, undefined),
    pause: () => registry.set(scheduler.pause, undefined),
    invalidate: () => registry.set(scheduler.invalidate, undefined),
    fail: (message: string) =>
      registry.set(scheduler.fail, { code: "render-error", message }),
    advance: (ms: number) =>
      Effect.runPromise(Effect.provideContext(TestClock.adjust(ms), context)),
    answer: (index: number, result?: Partial<TemplateRenderResult>) =>
      settled(index, (render) => render.answer(result)),
    reject: (index: number, error: unknown) =>
      settled(index, (render) => render.reject(error)),
    [Symbol.dispose]() {
      release();
      registry.dispose();
    },
  };
}

type Opened = ReturnType<typeof open>;

/** Whatever the refresh setting is, the way a reader starts one render. */
const startRender = async (scheduler: Opened, live: boolean) => {
  if (live) await scheduler.advance(300);
  else scheduler.run();
};

it("renders after the quiet time and no sooner, and at once on Run", async () => {
  using scheduler = open();
  const { host } = scheduler;
  // No result has landed yet, so the reason is why one is still on the way.
  expect(scheduler.state().staleReason).toBe("live");
  await scheduler.advance(299);
  expect(host.renders).toHaveLength(0);
  scheduler.set({ source: "Revised" });
  await scheduler.advance(299);
  expect(host.renders).toHaveLength(0);
  expect(scheduler.state().staleReason).toBe("live");
  await scheduler.advance(1);
  await scheduler.rendered(1);
  expect(host.renders[0]!.request.source).toBe("Revised");
  expect(scheduler.state().busy).toBe(true);
  await scheduler.answer(0, { creationBody: "First" });
  expect(scheduler.state().result?.creationBody).toBe("First");
  expect(scheduler.state().busy).toBe(false);
  // The delivered result matches the current input, so nothing is stale.
  expect(scheduler.state().staleReason).toBeNull();
  scheduler.set({ live: false });
  scheduler.run();
  await scheduler.rendered(2);
});

it("lets the render in flight finish after selecting On demand and starts no other", async () => {
  using scheduler = open();
  const { host } = scheduler;
  await scheduler.advance(300);
  await scheduler.rendered(1);
  scheduler.set({ live: false });
  // On demand pauses live rendering; the render already running is still running.
  expect(scheduler.state().busy).toBe(true);
  expect(host.renders[0]!.interrupted).toBe(false);
  // The refresh setting leaves the input alone, so that render still answers for it.
  await scheduler.answer(0, { creationBody: "In flight" });
  expect(scheduler.state().result?.creationBody).toBe("In flight");
  expect(scheduler.state().busy).toBe(false);
  scheduler.set({ source: "Typed while paused" });
  await scheduler.advance(1000);
  await scheduler.rendered(1);
  // On demand and behind an edit no render has started for.
  expect(scheduler.state().staleReason).toBe("demand");
});

it("interrupts the render in flight once the reader types past it", async () => {
  using scheduler = open();
  const { host } = scheduler;
  await scheduler.advance(300);
  await scheduler.rendered(1);
  scheduler.set({ source: "Typed past" });
  await scheduler.interrupted(0);
  await scheduler.advance(300);
  await scheduler.rendered(2);
  expect(host.renders[1]!.interrupted).toBe(false);
});

it("restarts the quiet time while the reader keeps typing", async () => {
  using scheduler = open();
  const { host } = scheduler;
  await scheduler.advance(200);
  scheduler.set({ source: "Typed" });
  await scheduler.advance(200);
  scheduler.set({ source: "Typed on" });
  await scheduler.advance(299);
  expect(host.renders).toHaveLength(0);
  await scheduler.advance(1);
  expect(host.renders.map(({ request }) => request.source)).toEqual([
    "Typed on",
  ]);
});

it("keeps the render in flight running on Stop", async () => {
  using scheduler = open();
  const { host } = scheduler;
  await scheduler.advance(300);
  scheduler.pause();
  scheduler.set({ live: false });
  expect(host.renders[0]!.interrupted).toBe(false);
  await scheduler.answer(0, { creationBody: "Finished" });
  expect(scheduler.state().result?.creationBody).toBe("Finished");
});

it("drops the quiet time on Stop and starts no render", async () => {
  using scheduler = open();
  scheduler.pause();
  await scheduler.advance(1000);
  expect(scheduler.host.renders).toHaveLength(0);
  // The next edit starts the quiet time over.
  scheduler.set({ source: "Edited" });
  await scheduler.advance(300);
  await scheduler.rendered(1);
});

it("interrupts a pending render when the registry is disposed", async () => {
  const scheduler = open();
  await scheduler.advance(300);
  const [pending] = scheduler.host.renders;
  scheduler[Symbol.dispose]();
  await Effect.runPromise(Deferred.await(pending!.interruption));
});

it("interrupts the quiet time when the registry is disposed", async () => {
  const scheduler = open();
  await scheduler.advance(100);
  scheduler[Symbol.dispose]();
  await scheduler.advance(1000);
  expect(scheduler.host.renders).toHaveLength(0);
});

it("drops a queued render on selecting On demand and reports the result as behind", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "First" });
  expect(scheduler.state().staleReason).toBeNull();
  scheduler.set({ source: "Revised" });
  // The quiet time has not passed: the render is queued, not running.
  await scheduler.advance(100);
  expect(scheduler.state().staleReason).toBe("live");
  scheduler.set({ live: false });
  await scheduler.advance(1000);
  await scheduler.rendered(1);
  expect(scheduler.state().result?.creationBody).toBe("First");
  expect(scheduler.state().staleReason).toBe("demand");
});

it("renders only on Run while the refresh setting is On demand", async () => {
  using scheduler = open({ live: false });
  const { host } = scheduler;
  scheduler.set({ source: "Held back" });
  await scheduler.advance(1000);
  expect(host.renders).toHaveLength(0);
  scheduler.run();
  await scheduler.rendered(1);
  expect(host.renders[0]!.request.source).toBe("Held back");
});

it("drops a render in flight and starts the quiet time over when Live is chosen again", async () => {
  using scheduler = open({ live: false });
  scheduler.run();
  await scheduler.rendered(1);
  scheduler.set({ live: true });
  await scheduler.interrupted(0);
  expect(scheduler.state().busy).toBe(false);
  await scheduler.advance(299);
  await scheduler.rendered(1);
  await scheduler.advance(1);
  await scheduler.rendered(2);
});

it("reads a fresh scheduler in on-demand mode as behind before any render starts", () => {
  using scheduler = open({ live: false });
  // Nothing has rendered yet, and On demand starts nothing on its own.
  expect(scheduler.state().staleReason).toBe("demand");
});

it("drops the render in flight on invalidate and renders again after the quiet time", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  scheduler.invalidate();
  await scheduler.interrupted(0);
  await scheduler.advance(300);
  await scheduler.rendered(2);
});

it("drops the render in flight on invalidate in on-demand mode and schedules nothing", async () => {
  using scheduler = open({ live: false });
  scheduler.run();
  scheduler.invalidate();
  await scheduler.interrupted(0);
  expect(scheduler.state().busy).toBe(false);
  await scheduler.advance(1000);
  await scheduler.rendered(1);
});

const SUPERSEDED: readonly {
  what: string;
  /** The selection this dimension starts on, where a Note preview carries none. */
  start?: Partial<RenderSchedulerInput>;
  supersede: Partial<RenderSchedulerInput>;
}[] = [
  { what: "source", supersede: { source: "Newer" } },
  { what: "paper", supersede: { snapshot: OTHER_PAPER } },
  { what: "annotation example", supersede: { annotation: OTHER_EXAMPLE } },
  {
    what: "citation example",
    start: { citation: CITATION },
    supersede: { citation: OTHER_CITATION },
  },
  {
    what: "citation variant",
    start: { citation: CITATION },
    supersede: { citation: { ...CITATION, variant: "alt" } },
  },
  {
    what: "partial caller",
    start: { partial: PARTIAL },
    supersede: { partial: OTHER_PARTIAL },
  },
  {
    what: "caller profile",
    start: { partial: PARTIAL },
    supersede: { partial: { ...PARTIAL, profile: "reading" } },
  },
  { what: "preview mode", supersede: { mode: "update" } },
  { what: "Template Document", supersede: { document: "templates/book.md" } },
];

it.each(
  SUPERSEDED.flatMap((entry) =>
    [true, false].map((live) => ({
      ...entry,
      live,
      mode: live ? "Live" : "On demand",
    })),
  ),
)(
  "never shows the result for a superseded $what in $mode",
  async ({ live, start, supersede }) => {
    using scheduler = open({ live, ...start });
    await startRender(scheduler, live);
    await scheduler.rendered(1);
    scheduler.set(supersede);
    // The render it was waiting on is dropped, so nothing is running any more.
    expect(scheduler.state().busy).toBe(false);
    await scheduler.interrupted(0);
    // No signal follows an answer to a dropped render; the landing below shows it never landed.
    scheduler.host.renders[0]!.answer({ creationBody: "Superseded" });
    await startRender(scheduler, live);
    await scheduler.rendered(2);
    await scheduler.answer(1, { creationBody: "Current" });
    expect(scheduler.state().result?.creationBody).toBe("Current");
    expect(scheduler.state().attempt).toBe(1);
  },
);

it("keeps the render in flight when the input is rebuilt with the same values", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  // A host model derives a new input object; every field is the same value.
  scheduler.set({});
  expect(scheduler.host.renders[0]!.interrupted).toBe(false);
  expect(scheduler.state().busy).toBe(true);
});

it("reads a selection by reference, so an equal new object is a new choice", async () => {
  using scheduler = open({ citation: CITATION });
  await scheduler.advance(300);
  scheduler.set({ citation: { ...CITATION } });
  await scheduler.interrupted(0);
});

it.each([
  { live: true, mode: "Live" },
  { live: false, mode: "On demand" },
])(
  "reads a delivered result as stale once another annotation example is chosen in $mode",
  async ({ live }) => {
    using scheduler = open({ live });
    await startRender(scheduler, live);
    await scheduler.answer(0, { creationBody: "First example" });
    expect(scheduler.state().staleReason).toBeNull();
    scheduler.set({ annotation: OTHER_EXAMPLE });
    // The result still on screen describes the example the reader has left.
    expect(scheduler.state().result?.creationBody).toBe("First example");
    expect(scheduler.state().staleReason).toBe(live ? "live" : "demand");
  },
);

it("clears the result once the host takes the paper away, and keeps it cleared", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "First" });
  scheduler.set({ snapshot: null });
  expect(scheduler.state().result).toBeNull();
  await scheduler.advance(1000);
  await scheduler.rendered(1);
  scheduler.set({ snapshot: PAPER });
  // The result that stood before describes a paper the host had let go.
  expect(scheduler.state().result).toBeNull();
  await scheduler.advance(300);
  await scheduler.rendered(2);
});

it("starts no render while the host has no paper", async () => {
  using scheduler = open({ snapshot: null });
  await scheduler.advance(1000);
  scheduler.run();
  expect(scheduler.host.renders).toHaveLength(0);
  expect(scheduler.state().busy).toBe(false);
});

it("shows a rejected render as a diagnostic carrying the engine's message", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.reject(0, new Error("Unclosed tag on line 3"));
  const { result, busy, staleReason } = scheduler.state();
  expect(
    result?.diagnostics.map(({ code, message }) => `${code}: ${message}`),
  ).toEqual(["render-error: Unclosed tag on line 3"]);
  expect(busy).toBe(false);
  // The failure names the source it was rendered for, so it does not read stale.
  expect(staleReason).toBeNull();
});

it("keeps the last successful preview while a failure is repaired", async () => {
  using scheduler = open();
  // The first attempt fails outright, so nothing successful stands behind it.
  await scheduler.advance(300);
  await scheduler.reject(0, new Error("Unclosed tag"));
  expect(scheduler.state().retained).toBeNull();

  scheduler.set({ source: "Working" });
  await scheduler.advance(300);
  await scheduler.answer(1, { creationBody: "Working" });
  // Nothing has failed since, so the result on screen is the current one.
  expect(scheduler.state().retained).toBeNull();

  scheduler.set({ source: "Broken" });
  await scheduler.advance(300);
  await scheduler.reject(2, new Error("Unclosed tag"));
  expect(scheduler.state().result?.creationBody).toBeNull();
  expect(scheduler.state().retained?.creationBody).toBe("Working");

  scheduler.set({ source: "Repaired" });
  await scheduler.advance(300);
  await scheduler.answer(3, { creationBody: "Repaired" });
  expect(scheduler.state().result?.creationBody).toBe("Repaired");
  expect(scheduler.state().retained).toBeNull();
});

it("keeps the note name the newest attempt produced, whatever else failed", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, { filename: "Old.md", creationBody: "Working" });
  // The note body failed on its own; the note name this attempt produced is
  // newer than the one kept beside that body, and replaces it.
  scheduler.set({ source: "Broken body" });
  await scheduler.advance(300);
  await scheduler.answer(1, {
    filename: "New.md",
    diagnostics: [{ code: "render-error", part: "render" }],
  });
  const { result, retained } = scheduler.state();
  expect(result?.filename).toBe("New.md");
  expect(retained?.creationBody).toBe("Working");
  expect(retained?.filename).toBe("New.md");
});

it("stands the last note name that worked while the Filename Template fails", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  // A failing rule leaves the note name alone: it renders apart from the note.
  await scheduler.answer(0, {
    filename: "Working.md",
    diagnostics: [{ code: "property-error", part: "properties", position: 1 }],
  });
  expect(scheduler.state().retained?.filename).toBe("Working.md");

  scheduler.set({ source: "{% broken %}" });
  await scheduler.advance(300);
  await scheduler.answer(1, {
    creationBody: "Working",
    diagnostics: [{ code: "liquid-syntax-error", part: "filename" }],
  });
  expect(scheduler.state().result?.filename).toBeNull();
  expect(scheduler.state().retained?.filename).toBe("Working.md");
});

it("takes retained output back once another annotation example is chosen", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "Working" });
  scheduler.set({ source: "Broken" });
  await scheduler.advance(300);
  await scheduler.reject(1, new Error("Unclosed tag"));
  expect(scheduler.state().retained?.creationBody).toBe("Working");

  scheduler.set({ annotation: OTHER_EXAMPLE });
  // That output answers for the example the reader has left.
  expect(scheduler.state().retained).toBeNull();
});

it("does not retain a successful result for another invalid Template Document", async () => {
  using scheduler = open({ document: "templates/paper.md" });
  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "Document A" });
  expect(scheduler.state().result?.creationBody).toBe("Document A");

  scheduler.set({ document: "templates/book.md", hold: "invalid" });
  expect(scheduler.state().retained).toBeNull();
});

it("takes retained output back once another Template Document is opened", async () => {
  using scheduler = open({ document: "templates/paper.md" });
  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "Working" });
  scheduler.set({ source: "Broken" });
  await scheduler.advance(300);
  await scheduler.reject(1, new Error("Unclosed tag"));
  expect(scheduler.state().retained?.creationBody).toBe("Working");

  // Another document the parser refuses, on the same paper: the note kept for
  // the document before it answers for that one, not for this reader's.
  scheduler.set({ document: "templates/book.md", hold: "invalid" });
  expect(scheduler.state().retained).toBeNull();
});

it("keeps the note that worked while the annotation beside it renders", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, {
    creationBody: "Working",
    annotation: "First highlight",
  });
  scheduler.set({ source: "Broken" });
  await scheduler.advance(300);
  // One attempt, two surfaces: the note produced nothing and the annotation
  // rendered, so each surface keeps the newest output it has.
  await scheduler.answer(1, {
    annotation: "Second highlight",
    diagnostics: [{ code: "render-error", message: "Unclosed tag" }],
  });
  const { result, retained } = scheduler.state();
  expect(result?.creationBody).toBeNull();
  expect(retained?.creationBody).toBe("Working");
  expect(retained?.annotation).toBe("Second highlight");
});

it("keeps the successful note when a Property failure accompanies Annotation output", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, {
    creationBody: "Working",
    annotation: "First highlight",
  });
  scheduler.set({ source: "Broken" });
  await scheduler.advance(300);
  await scheduler.answer(1, {
    creationBody: "Incomplete",
    annotation: "Second highlight",
    diagnostics: [
      {
        code: "property-error",
        part: "properties",
        position: 1,
        message: "Invalid property",
      },
    ],
  });
  const { retained } = scheduler.state();
  expect(retained?.creationBody).toBe("Working");
  expect(retained?.annotation).toBe("Second highlight");
});

it("names every selection on a failure the host reports", async () => {
  using scheduler = open({ citation: CITATION, partial: PARTIAL });
  await scheduler.advance(300);
  scheduler.fail("No citation data");
  // The failure drops the render it stands in for.
  await scheduler.interrupted(0);
  const { result, busy, staleReason, trigger, attempt } = scheduler.state();
  expect(
    result?.diagnostics.map(({ code, message }) => `${code}: ${message}`),
  ).toEqual(["render-error: No citation data"]);
  expect({ busy, trigger, attempt }).toEqual({
    busy: false,
    trigger: "automatic",
    attempt: 1,
  });
  // The failure carries the Citation set and the caller it was reported for,
  // so a Citation Template or Shared Partial preview reads it as its own.
  expect(staleReason).toBeNull();
});

it("starts no quiet-time render after a failure the host reports", async () => {
  using scheduler = open();
  scheduler.fail("No data");
  await scheduler.advance(1000);
  expect(scheduler.host.renders).toHaveLength(0);
});

it("names the attempt behind each result and counts the attempts apart", async () => {
  using scheduler = open();
  expect(scheduler.state()).toMatchObject({ trigger: null, attempt: 0 });

  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "Typed" });
  expect(scheduler.state()).toMatchObject({
    trigger: "automatic",
    attempt: 1,
  });

  scheduler.run();
  await scheduler.reject(1, new Error("Unclosed tag on line 3"));
  expect(scheduler.state()).toMatchObject({ trigger: "explicit", attempt: 2 });

  // The same source twice is two attempts, so a second deliberate failure
  // reads as its own.
  scheduler.run();
  await scheduler.reject(2, new Error("Unclosed tag on line 3"));
  expect(scheduler.state()).toMatchObject({ trigger: "explicit", attempt: 3 });
});

it("replaces the render in flight on Run and drops the quiet time", async () => {
  using scheduler = open();
  await scheduler.advance(100);
  scheduler.run();
  await scheduler.rendered(1);
  await scheduler.advance(1000);
  // Run ended the quiet time it overtook.
  await scheduler.rendered(1);
  scheduler.run();
  await scheduler.interrupted(0);
  await scheduler.rendered(2);
});

it("holds rendering on the host's word while the last result stands", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "Good" });
  scheduler.set({ hold: true });
  expect(scheduler.state()).toMatchObject({ staleReason: "hold" });
  expect(scheduler.state().result?.creationBody).toBe("Good");
  scheduler.set({ source: "Held" });
  await scheduler.advance(1000);
  scheduler.run();
  await scheduler.rendered(1);
  scheduler.set({ hold: false });
  await scheduler.advance(300);
  await scheduler.rendered(2);
});

it("tells a document the parser refuses from a hold that is only a wait", async () => {
  using scheduler = open();
  await scheduler.advance(300);
  await scheduler.answer(0, { creationBody: "Good" });

  scheduler.set({ hold: true });
  // Nothing failed: the host simply cannot answer for this draft yet.
  expect(scheduler.state().staleReason).toBe("hold");
  expect(scheduler.state().retained).toBeNull();

  scheduler.set({ hold: "invalid" });
  // The parser refused the draft, so the output on screen is what worked last.
  expect(scheduler.state().staleReason).toBe("invalid");
  expect(scheduler.state().retained?.creationBody).toBe("Good");
  await scheduler.rendered(1);

  scheduler.set({ annotation: OTHER_EXAMPLE });
  expect(scheduler.state().retained).toBeNull();
});

it("keeps choices and late results local to each scheduler", async () => {
  using first = open({ source: "First draft" });
  using second = open({ source: "Other draft" });
  await first.advance(300);
  await second.advance(300);
  await first.answer(0, { creationBody: "First output" });
  await second.answer(0, { creationBody: "Second output" });
  first.set({ live: false, mode: "update", source: "Current unsaved draft" });
  first.run();
  await first.rendered(2);
  expect(first.host.renders[1]!.request).toMatchObject({
    source: "Current unsaved draft",
    mode: "update",
  });
  expect(second.state().staleReason).toBeNull();
  await second.rendered(1);
  first[Symbol.dispose]();
  first.host.renders[1]!.answer({ creationBody: "Closed result" });
  expect(second.state().result?.creationBody).toBe("Second output");
});

it("reports the attempt a failure came from, not the draft the reader moved on to", async () => {
  using scheduler = open(
    { source: "Draft one" },
    {
      reportContext: () => ({
        document: "templates/paper.md",
        language: "liquid",
        root: "note",
      }),
    },
  );
  await scheduler.advance(300);
  // The reader edits while the first render is still out, so that attempt is
  // abandoned: its late failure reports nothing and shows nothing.
  scheduler.set({ source: "Draft two" });
  await scheduler.advance(300);
  scheduler.host.renders[0]!.reject(new Error("Abandoned failure"));

  const context = "1| {{ zt.title\n         ^";
  await scheduler.reject(
    1,
    Object.assign(new Error("Unclosed tag"), { context }),
  );
  // The abandoned failure never landed: this is the first attempt.
  expect(scheduler.state().attempt).toBe(1);
  const captured = scheduler.state().result!.diagnostics[0]!.report!;
  expect(captured.trigger).toBe("automatic");
  expect(captured.identity.sourceRevision).toBe(
    templateSourceRevision("Draft two"),
  );
  const text = formatRenderReport(captured);
  expect(text).toContain(`Source excerpt:\n${context}`);
  expect(text).toContain("Template document: templates/paper.md");
  expect(text).toContain("Attempt: 1");

  // Editing on does not reach back into what was already captured.
  scheduler.set({ source: "Draft three" });
  expect(
    formatRenderReport(scheduler.state().result!.diagnostics[0]!.report!),
  ).toBe(text);
});

it("renders once for a host whose render answers at once", async () => {
  // The web host renders on the page's own thread, so its render completes
  // inside the step that starts it.
  const requests: RenderRequest[] = [];
  const input = Atom.make<RenderSchedulerInput>({
    source: "Draft",
    snapshot: PAPER,
    annotation: EXAMPLE,
    mode: "create",
    live: true,
  });
  const runtime = Atom.runtime(TestClock.layer());
  const scheduler = makeRenderSchedulerAtoms({
    runtime,
    input,
    render: (request) =>
      Effect.sync(() => {
        requests.push(request);
        return {
          ...failedRender(renderIdentity(request), { code: "render-error" }),
          diagnostics: [],
        };
      }),
    failed: (result) => result,
  });
  const registry = AtomRegistry.make({
    defaultIdleTTL: 0,
    timeoutResolution: 1,
  });
  const release = registry.mount(scheduler.state);
  registry.set(scheduler.run, undefined);
  await vi.waitFor(() => expect(registry.get(scheduler.state).attempt).toBe(1));
  expect(requests).toHaveLength(1);
  release();
  registry.dispose();
});

/** A Profile draft whose Managed Frontmatter lists `keys`, in order. */
const listing = (...keys: string[]) =>
  [
    "---",
    "name: Reading notes",
    "id: reading",
    "version: 1.0.0",
    "contract: 2",
    "language: liquid",
    "frontmatter:",
    ...keys.flatMap((key) => [`  - key: ${key}`, `    expr: zt.${key}`]),
    "---",
    "# {{ zt.title }}",
    "",
  ].join("\n");

const LISTED = listing("title", "related");

/** A value on each of LISTED's two rows. */
const LISTED_PROPERTIES = [
  { key: "title", position: 1, value: "A paper", missing: false },
  { key: "related", position: 2, value: "Linked", missing: false },
] as const;

const rows = (properties: TemplateRenderResult["properties"] | undefined) =>
  properties?.map(({ key, position }) => [key, position]);

it("reads a standing result in the positions of the draft on screen", async () => {
  using scheduler = open({ source: LISTED });
  await scheduler.advance(300);
  await scheduler.answer(0, {
    properties: [...LISTED_PROPERTIES],
    diagnostics: [
      { code: "property-error", position: 1, message: "The rule stopped." },
    ],
  });
  scheduler.set({ source: listing("related", "title") });
  // The render the edit queued is on its way; the result stands meanwhile,
  // each value and problem on the row it belongs to.
  const moved = scheduler.state();
  expect(moved.staleReason).toBe("live");
  expect(rows(moved.result?.properties)).toEqual([
    ["title", 2],
    ["related", 1],
  ]);
  expect(moved.result?.diagnostics.map(({ position }) => position)).toEqual([
    2,
  ]);
  // Reading the same draft again answers with the same result.
  scheduler.set({ live: true });
  expect(scheduler.state().result).toBe(moved.result);

  scheduler.set({ source: listing("related") });
  // The removed row's value leaves with it. Its problem still explains the
  // attempt, so it stays, naming no row.
  const { result } = scheduler.state();
  expect(rows(result?.properties)).toEqual([["related", 1]]);
  expect(result?.diagnostics).toHaveLength(1);
  expect(result?.diagnostics[0]).toMatchObject({ code: "property-error" });
  expect(result?.diagnostics[0]).not.toHaveProperty("position");
});

it("moves retained output to each draft a later attempt and the reader are on", async () => {
  using scheduler = open({ source: LISTED });
  await scheduler.advance(300);
  await scheduler.answer(0, {
    creationBody: "Working",
    properties: [...LISTED_PROPERTIES],
  });
  // The next attempt renders the reordered list, produces the annotation, and
  // fails the note body, so the kept note output joins it in that draft's
  // positions.
  const reordered = listing("related", "title");
  scheduler.set({ source: reordered });
  await scheduler.advance(300);
  await scheduler.answer(1, {
    annotation: "Highlight",
    diagnostics: [{ code: "render-error", part: "render" }],
  });
  const kept = scheduler.state().retained;
  expect(kept?.annotation).toBe("Highlight");
  expect(rows(kept?.properties)).toEqual([
    ["title", 2],
    ["related", 1],
  ]);
  // The reader puts the list back before the next render lands; what is kept
  // reads in the list on screen.
  scheduler.set({ source: LISTED });
  expect(rows(scheduler.state().retained?.properties)).toEqual([
    ["title", 1],
    ["related", 2],
  ]);
});
