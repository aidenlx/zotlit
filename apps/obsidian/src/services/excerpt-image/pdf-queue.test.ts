import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { vi } from "vitest";

import { queueFixture } from "./__fixtures__/queue";
import {
  makeExcerptPdfQueue,
  EXCERPT_JOB_LIMIT,
  EXCERPT_PDF_AFFINITY,
} from "./pdf-queue";

/** A signal nothing cancels, for jobs a test drives to completion. */
const running = () => new AbortController().signal;

describe("Excerpt PDF queue admission", () => {
  it.effect("counts queued, running, and reserved jobs against one bound", () =>
    Effect.gen(function* () {
      const queue = yield* queueFixture({ limit: 2 });
      yield* Effect.promise(async () => {
        const ran: string[] = [];
        const first = await queue.reserve(running());
        const second = await queue.reserve(running());
        const waiting = queue.reserve(running());
        // Producers that call together cannot both take the last slot, and the
        // third waits instead of being refused.
        expect(queue.diagnostics.admitted).toBe(2);
        expect(queue.diagnostics.awaiting).toBe(1);
        await Promise.all(
          [first, second].map((admission, index) =>
            admission.render(
              async () => {
                ran.push(`reserved ${index + 1}`);
              },
              { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
            ),
          ),
        );
        // Only the two admitted jobs reached the PDF slot.
        expect(ran).toEqual(["reserved 1", "reserved 2"]);
        first.release();
        const resumed = await waiting;
        await resumed.render(
          async () => {
            ran.push("waiting");
          },
          { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
        );
        // The settling job's slot moved to the waiting producer, not freed, so its
        // work runs while the bound stays full.
        expect(ran).toEqual(["reserved 1", "reserved 2", "waiting"]);
        expect(queue.diagnostics.admitted).toBe(2);
        expect(queue.diagnostics.awaiting).toBe(0);
        second.release();
        expect(queue.diagnostics.admitted).toBe(1);
        resumed.release();
        expect(queue.diagnostics.admitted).toBe(0);
      });
    }),
  );

  it.effect(
    "admits a burst of simultaneous producers up to the bound and no further",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ limit: 4 });
        yield* Effect.promise(async () => {
          const ran: string[] = [];
          const producers = Array.from({ length: 4 }, () =>
            queue.reserve(running()),
          );
          // The check and the reservation are one synchronous step, so a burst of
          // producers starting together cannot over-admit.
          expect(queue.diagnostics.admitted).toBe(4);
          const overflow = Array.from({ length: 3 }, () =>
            queue.reserve(running()),
          );
          expect(queue.diagnostics.admitted).toBe(4);
          expect(queue.diagnostics.awaiting).toBe(3);
          const admitted = await Promise.all(producers);
          await Promise.all(
            admitted.map((admission, index) =>
              admission.render(
                async () => {
                  ran.push(`admitted ${index + 1}`);
                },
                {
                  pdf: "PDF",
                  sequence: queue.nextSequence(),
                  signal: running(),
                },
              ),
            ),
          );
          // Four jobs — and only four — reached the PDF slot while the bound held.
          expect(ran).toEqual([
            "admitted 1",
            "admitted 2",
            "admitted 3",
            "admitted 4",
          ]);
          for (const admission of admitted) admission.release();
          const resumed = await Promise.all(overflow);
          await Promise.all(
            resumed.map((admission, index) =>
              admission.render(
                async () => {
                  ran.push(`resumed ${index + 1}`);
                },
                {
                  pdf: "PDF",
                  sequence: queue.nextSequence(),
                  signal: running(),
                },
              ),
            ),
          );
          expect(ran.slice(4)).toEqual(["resumed 1", "resumed 2", "resumed 3"]);
          expect(queue.diagnostics.admitted).toBe(3);
          for (const admission of resumed) admission.release();
          expect(queue.diagnostics.admitted).toBe(0);
        });
      }),
  );

  it.effect("cancels a capacity wait without consuming a slot", () =>
    Effect.gen(function* () {
      const queue = yield* queueFixture({ limit: 1 });
      yield* Effect.promise(async () => {
        const held = await queue.reserve(running());
        const cancelled = new AbortController();
        const waiting = queue.reserve(cancelled.signal);
        cancelled.abort();
        await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
        expect(queue.diagnostics.admitted).toBe(1);
        expect(queue.diagnostics.awaiting).toBe(0);
        // The cancelled producer left no slot behind: the next one still waits.
        const next = queue.reserve(running());
        expect(queue.diagnostics.awaiting).toBe(1);
        held.release();
        const resumed = await next;
        expect(queue.diagnostics.admitted).toBe(1);
        resumed.release();
      });
    }),
  );

  it.effect("hands slots to waiting producers in arrival order", () =>
    Effect.gen(function* () {
      const queue = yield* queueFixture({ limit: 1 });
      yield* Effect.promise(async () => {
        const held = await queue.reserve(running());
        const order: number[] = [];
        const waiting = [1, 2, 3].map((index) =>
          queue.reserve(running()).then((admission) => {
            order.push(index);
            // Handing the slot on is what wakes the next oldest producer.
            admission.release();
          }),
        );
        held.release();
        await Promise.all(waiting);
        expect(order).toEqual([1, 2, 3]);
      });
    }),
  );
});

describe("Excerpt PDF queue rendering", () => {
  it.effect("never runs two crop renders at once", () =>
    Effect.gen(function* () {
      const queue = yield* queueFixture({ limit: 3 });
      yield* Effect.promise(async () => {
        let active = 0;
        let peak = 0;
        const admissions = await Promise.all([
          queue.reserve(running()),
          queue.reserve(running()),
          queue.reserve(running()),
        ]);
        await Promise.all(
          admissions.map((admission) =>
            admission.render(
              async () => {
                active += 1;
                peak = Math.max(peak, active);
                await Promise.resolve();
                active -= 1;
              },
              { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
            ),
          ),
        );
        expect(peak).toBe(1);
        for (const admission of admissions) admission.release();
      });
    }),
  );

  it.effect(
    "renders in call order even when jobs are enqueued out of order",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ limit: 4 });
        yield* Effect.promise(async () => {
          const order: string[] = [];
          const blockerRelease = Promise.withResolvers<void>();
          const blockerStarted = Promise.withResolvers<void>();
          // Both jobs are enqueued while the first render holds the slot, and the
          // later-arriving job reaches the queue first.
          const blocker = await queue.reserve(running());
          const blocking = blocker.render(
            async () => {
              blockerStarted.resolve();
              await blockerRelease.promise;
              order.push("blocker");
            },
            { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
          );
          await blockerStarted.promise;
          const first = queue.nextSequence();
          const second = queue.nextSequence();
          const secondAdmission = await queue.reserve(running());
          const firstAdmission = await queue.reserve(running());
          const pending = Promise.all([
            secondAdmission.render(
              async () => {
                order.push("second");
              },
              { pdf: "PDF", sequence: second, signal: running() },
            ),
            firstAdmission.render(
              async () => {
                order.push("first");
              },
              { pdf: "PDF", sequence: first, signal: running() },
            ),
          ]);
          blockerRelease.resolve();
          await blocking;
          await pending;
          expect(order).toEqual(["blocker", "first", "second"]);
          blocker.release();
          firstAdmission.release();
          secondAdmission.release();
        });
      }),
  );

  it.effect(
    "gives another waiting PDF a turn after four consecutive jobs",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ limit: 8 });
        yield* Effect.promise(async () => {
          const documents = [
            ...Array.from({ length: EXCERPT_PDF_AFFINITY + 1 }, () => "SAME"),
            "OTHER",
          ];
          const order: string[] = [];
          const admissions = await Promise.all(
            documents.map(() => queue.reserve(running())),
          );
          await Promise.all(
            admissions.map((admission, index) =>
              admission.render(
                async () => {
                  order.push(documents[index]!);
                },
                {
                  pdf: documents[index]!,
                  sequence: queue.nextSequence(),
                  signal: running(),
                },
              ),
            ),
          );
          // The fifth job of the loaded document yields to the waiting one, which
          // then leaves the remaining job its turn.
          expect(order).toEqual([
            "SAME",
            "SAME",
            "SAME",
            "SAME",
            "OTHER",
            "SAME",
          ]);
          for (const admission of admissions) admission.release();
        });
      }),
  );

  it.effect(
    "drops queued demand when a job's signal aborts, and keeps a running slot",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ limit: 4 });
        yield* Effect.promise(async () => {
          const release = Promise.withResolvers<void>();
          const started = Promise.withResolvers<void>();
          const runningJob = vi.fn(async () => {
            started.resolve();
            await release.promise;
          });
          const dropped = vi.fn(async () => {});
          const first = await queue.reserve(running());
          const second = await queue.reserve(running());
          const queued = new AbortController();
          const pending = first.render(runningJob, {
            pdf: "SAME",
            sequence: queue.nextSequence(),
            signal: running(),
          });
          await started.promise;
          const abandoned = second.render(dropped, {
            pdf: "SAME",
            sequence: queue.nextSequence(),
            signal: queued.signal,
          });
          queued.abort();
          await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
          expect(dropped).not.toHaveBeenCalled();
          // The running job keeps the slot, so nothing else started; its own
          // completion is what moves the queue on.
          expect(queue.diagnostics.rendering).toBe(1);
          expect(queue.diagnostics.queued).toBe(0);
          release.resolve();
          await pending;
          expect(runningJob).toHaveBeenCalledTimes(1);
          first.release();
          second.release();
        });
      }),
  );

  it.effect("holds a running render slot after its demand is cancelled", () =>
    Effect.gen(function* () {
      const queue = yield* queueFixture({ limit: 2 });
      yield* Effect.promise(async () => {
        const cancelled = new AbortController();
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const first = await queue.reserve(running());
        const second = await queue.reserve(running());
        const order: string[] = [];
        const rendering = first.render(
          async () => {
            started.resolve();
            await finish.promise;
            order.push("finished");
          },
          {
            pdf: "PDF",
            sequence: queue.nextSequence(),
            signal: cancelled.signal,
          },
        );
        await started.promise;
        cancelled.abort();
        const next = second.render(
          async () => {
            order.push("next");
          },
          {
            pdf: "OTHER",
            sequence: queue.nextSequence(),
            signal: running(),
          },
        );
        expect(queue.diagnostics.rendering).toBe(1);
        finish.resolve();
        await expect(rendering).rejects.toMatchObject({ name: "AbortError" });
        await next;
        expect(order).toEqual(["finished", "next"]);
        first.release();
        second.release();
      });
    }),
  );

  it.effect(
    "checks freshness and cache beside a blocked render, outside the admission bound",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ limit: 1 });
        yield* Effect.promise(async () => {
          const release = Promise.withResolvers<void>();
          const started = Promise.withResolvers<void>();
          const admission = await queue.reserve(running());
          const rendering = admission.render(
            async () => {
              started.resolve();
              await release.promise;
            },
            { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
          );
          await started.promise;
          // A cache hit completes while the render holds both the slot and the bound.
          await expect(
            queue.preflight(async () => "cache", running()),
          ).resolves.toBe("cache");
          expect(queue.diagnostics.admitted).toBe(1);
          expect(queue.diagnostics.awaiting).toBe(0);
          release.resolve();
          await rendering;
          admission.release();
        });
      }),
  );

  it.effect(
    "keeps teardown's place in line and holds a later render until it settles",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ limit: 4 });
        yield* Effect.promise(async () => {
          const order: string[] = [];
          const release = Promise.withResolvers<void>();
          const started = Promise.withResolvers<void>();
          const job = (name: string) => async () => {
            order.push(name);
            started.resolve();
            await release.promise;
          };
          const first = await queue.reserve(running());
          const rendering = first.render(job("first"), {
            pdf: "PDF",
            sequence: queue.nextSequence(),
            signal: running(),
          });
          await started.promise;
          // One render is already waiting, and another is admitted after the teardown
          // is asked for.
          const second = await queue.reserve(running());
          const queued = second.render(job("second"), {
            pdf: "PDF",
            sequence: queue.nextSequence(),
            signal: running(),
          });
          const teardown = queue.teardown(job("teardown"));
          const third = await queue.reserve(running());
          const later = third.render(job("later"), {
            pdf: "PDF",
            sequence: queue.nextSequence(),
            signal: running(),
          });

          release.resolve();
          await Promise.all([rendering, queued, teardown, later]);
          // Teardown keeps its place among the renders already admitted, and the
          // render admitted after it waits for the document to be destroyed.
          expect(order).toEqual(["first", "second", "teardown", "later"]);
          first.release();
          second.release();
          third.release();
        });
      }),
  );

  it.effect("counts a queued teardown against the admission bound", () =>
    Effect.gen(function* () {
      const queue = yield* queueFixture();
      yield* Effect.promise(async () => {
        const gate = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        const hold = () => gate.promise;
        // A previous operation's document teardown holds the render slot.
        const teardown = queue.teardown(async () => {
          started.resolve();
          await hold();
        });
        await started.promise;
        // The producers take what is left of the bound and queue for that slot.
        const producers = await Promise.all(
          Array.from({ length: EXCERPT_JOB_LIMIT - 1 }, () =>
            queue.reserve(running()),
          ),
        );
        const rendering = producers.map((admission) =>
          admission.render(hold, {
            pdf: "PDF",
            sequence: queue.nextSequence(),
            signal: running(),
          }),
        );
        // The job that would be the 129th waits for capacity rather than filling
        // the bound beside the teardown.
        const overflow = queue.reserve(running());
        const counts = queue.diagnostics;
        expect(counts.admitted).toBe(EXCERPT_JOB_LIMIT);
        expect(counts.rendering + counts.queued).toBe(EXCERPT_JOB_LIMIT);
        expect(counts.awaiting).toBe(1);

        gate.resolve();
        await teardown;
        await Promise.all(rendering);
        const resumed = await overflow;
        for (const producer of producers) producer.release();
        resumed.release();
        expect(queue.diagnostics.admitted).toBe(0);
      });
    }),
  );

  it.effect(
    "waits for a slot instead of overshooting a bound a teardown arrives at",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ limit: 1 });
        yield* Effect.promise(async () => {
          const gate = Promise.withResolvers<void>();
          const started = Promise.withResolvers<void>();
          const ran: string[] = [];
          const first = await queue.reserve(running());
          const rendering = first.render(
            async () => {
              ran.push("render");
              started.resolve();
              await gate.promise;
            },
            { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
          );
          await started.promise;
          // The bound is full, so the teardown is not a 129th job: it waits for the
          // slot the render hands over, then destroys the document behind it.
          const teardown = queue.teardown(async () => {
            ran.push("teardown");
          });
          expect(queue.diagnostics.admitted).toBe(1);
          expect(queue.diagnostics.awaiting).toBe(1);
          gate.resolve();
          await rendering;
          first.release();
          await teardown;
          expect(ran).toEqual(["render", "teardown"]);
          expect(queue.diagnostics.admitted).toBe(0);
        });
      }),
  );

  it.effect(
    "keeps a cancelled check's lane slot until the check itself settles",
    () =>
      Effect.gen(function* () {
        const queue = yield* queueFixture({ preflight: 1 });
        yield* Effect.promise(async () => {
          const cancelled = new AbortController();
          const gate = Promise.withResolvers<void>();
          const started = Promise.withResolvers<void>();
          const checking = queue.preflight(async () => {
            started.resolve();
            await gate.promise;
            return "checked";
          }, cancelled.signal);
          await started.promise;
          // The check has started against a store that has not answered yet: its
          // demand going does not hand the lane's one slot to the next check, because
          // the work behind it is still running.
          cancelled.abort(new Error("cancelled"));
          const next = queue.preflight(async () => "next", running());
          expect(queue.diagnostics.checking).toBe(1);
          gate.resolve();
          await expect(checking).rejects.toMatchObject({ name: "AbortError" });
          await expect(next).resolves.toBe("next");
        });
      }),
  );

  it.effect("signals idle only after a running job's teardown settles", () =>
    Effect.gen(function* () {
      const queue = yield* queueFixture({ limit: 2 });
      yield* Effect.promise(async () => {
        const release = Promise.withResolvers<void>();
        const sequence: string[] = [];
        const admission = await queue.reserve(running());
        const rendering = admission.render(
          async () => {
            try {
              await release.promise;
            } finally {
              sequence.push("teardown");
            }
          },
          { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
        );
        const idle = queue.idle().then(() => {
          sequence.push("idle");
        });
        admission.release();
        release.resolve();
        await idle;
        expect(sequence).toEqual(["teardown", "idle"]);
        await expect(rendering).resolves.toBeUndefined();
      });
    }),
  );
});

it.effect(
  "#1861: closing the queue interrupts waiting and running work and returns admission",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.fork(yield* Scope.Scope);
      const queue = yield* makeExcerptPdfQueue({ limit: 2 }).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const started = yield* Deferred.make<void>();
      const order: string[] = [];
      const run = (name: string) =>
        Effect.scoped(
          Effect.gen(function* () {
            const admission = yield* queue.reserve;
            return yield* admission.render(
              Effect.gen(function* () {
                order.push(name);
                yield* Deferred.succeed(started, undefined);
                return yield* Effect.never;
              }),
              { pdf: name, sequence: queue.nextSequence() },
            );
          }),
        ).pipe(Effect.forkIn(scope, { startImmediately: true }));
      const first = yield* run("first");
      yield* Deferred.await(started);
      const second = yield* run("second");
      const third = yield* run("third");
      expect(queue.diagnostics).toMatchObject({
        admitted: 2,
        rendering: 1,
        queued: 1,
        awaiting: 1,
      });
      yield* Scope.close(scope, Exit.void);
      expect(order).toEqual(["first"]);
      expect(queue.busy).toBe(false);
      for (const fiber of [first, second, third])
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
    }),
);

it.effect(
  "#1861: bounds preflight readers and serves waiting checks in order",
  () =>
    Effect.gen(function* () {
      const queue = yield* makeExcerptPdfQueue();
      const release = yield* Deferred.make<void>();
      const order: number[] = [];
      const jobs = yield* Effect.forEach([1, 2, 3, 4, 5, 6], (index) =>
        queue
          .preflight(
            Effect.gen(function* () {
              order.push(index);
              yield* Deferred.await(release);
            }),
          )
          .pipe(Effect.forkChild({ startImmediately: true })),
      );
      expect(order).toEqual([1, 2, 3, 4]);
      expect(queue.diagnostics.checking).toBe(4);
      yield* Deferred.succeed(release, undefined);
      const last = yield* queue
        .preflight(
          Effect.sync(() => {
            order.push(7);
          }),
        )
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Fiber.joinAll([...jobs, last]);
      expect(order).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(queue.busy).toBe(false);
    }),
);
