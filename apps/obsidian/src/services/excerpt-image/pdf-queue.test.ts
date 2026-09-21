import { describe, expect, it, vi } from "vitest";

import {
  EXCERPT_JOB_LIMIT,
  EXCERPT_PDF_AFFINITY,
  ExcerptPdfQueue,
  PdfAffinityQueue,
} from "./pdf-queue";

/** A signal nothing cancels, for jobs a test drives to completion. */
const running = () => new AbortController().signal;

describe("Excerpt PDF queue admission", () => {
  it("counts queued, running, and reserved jobs against one bound", async () => {
    const queue = new ExcerptPdfQueue({ limit: 2 });
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

  it("admits a burst of simultaneous producers up to the bound and no further", async () => {
    const queue = new ExcerptPdfQueue({ limit: 4 });
    const ran: string[] = [];
    const producers = Array.from({ length: 4 }, () => queue.reserve(running()));
    // The check and the reservation are one synchronous step, so a burst of
    // producers starting together cannot over-admit.
    expect(queue.diagnostics.admitted).toBe(4);
    const overflow = Array.from({ length: 3 }, () => queue.reserve(running()));
    expect(queue.diagnostics.admitted).toBe(4);
    expect(queue.diagnostics.awaiting).toBe(3);
    const admitted = await Promise.all(producers);
    await Promise.all(
      admitted.map((admission, index) =>
        admission.render(
          async () => {
            ran.push(`admitted ${index + 1}`);
          },
          { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
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
          { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
        ),
      ),
    );
    expect(ran.slice(4)).toEqual(["resumed 1", "resumed 2", "resumed 3"]);
    expect(queue.diagnostics.admitted).toBe(3);
    for (const admission of resumed) admission.release();
    expect(queue.diagnostics.admitted).toBe(0);
  });

  it("holds the default admitted bound at the literal 128 jobs", async () => {
    // ADR 0052 fixes the bound at 128: the literal catches a drift in the
    // constant itself, which a bound derived from it cannot.
    expect(EXCERPT_JOB_LIMIT).toBe(128);
    const queue = new ExcerptPdfQueue();
    const ran: number[] = [];
    const reservations = Array.from({ length: 128 }, () =>
      queue.reserve(running()),
    );
    expect(queue.diagnostics.admitted).toBe(128);
    const admitted = await Promise.all(reservations);
    await Promise.all(
      admitted.map((admission, index) =>
        admission.render(
          async () => {
            ran.push(index);
          },
          { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
        ),
      ),
    );
    expect(ran).toHaveLength(128);
    const overflow = queue.reserve(running());
    expect(queue.diagnostics.awaiting).toBe(1);
    // The 129th job is admitted nowhere: the PDF slot served exactly the jobs
    // the bound admitted, and no more.
    expect(ran).toHaveLength(128);
    admitted[0]!.release();
    const resumed = await overflow;
    await resumed.render(
      async () => {
        ran.push(128);
      },
      { pdf: "PDF", sequence: queue.nextSequence(), signal: running() },
    );
    expect(ran).toHaveLength(129);
    for (const admission of admitted.slice(1)) admission.release();
    expect(queue.diagnostics.admitted).toBe(1);
    resumed.release();
    expect(queue.diagnostics.admitted).toBe(0);
  });

  it("cancels a capacity wait without consuming a slot", async () => {
    const queue = new ExcerptPdfQueue({ limit: 1 });
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

  it("hands slots to waiting producers in arrival order", async () => {
    const queue = new ExcerptPdfQueue({ limit: 1 });
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
});

describe("Excerpt PDF queue rendering", () => {
  it("never runs two crop renders at once", async () => {
    const queue = new ExcerptPdfQueue({ limit: 3 });
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

  it("renders in call order even when jobs are enqueued out of order", async () => {
    const queue = new ExcerptPdfQueue({ limit: 4 });
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

  it("gives another waiting PDF a turn after four consecutive jobs", async () => {
    const queue = new ExcerptPdfQueue({ limit: 8 });
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
    expect(order).toEqual(["SAME", "SAME", "SAME", "SAME", "OTHER", "SAME"]);
    for (const admission of admissions) admission.release();
  });

  it("drops queued demand when a job's signal aborts, and keeps a running slot", async () => {
    const queue = new ExcerptPdfQueue({ limit: 4 });
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

  it("checks freshness and cache beside a blocked render, outside the admission bound", async () => {
    const queue = new ExcerptPdfQueue({ limit: 1 });
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
    await expect(queue.preflight(async () => "cache", running())).resolves.toBe(
      "cache",
    );
    expect(queue.diagnostics.admitted).toBe(1);
    expect(queue.diagnostics.awaiting).toBe(0);
    release.resolve();
    await rendering;
    admission.release();
  });

  it("signals idle only after a running job's teardown settles", async () => {
    const queue = new ExcerptPdfQueue({ limit: 2 });
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
});

describe("PdfAffinityQueue contract", () => {
  it("sizes, filters, re-prioritizes, and removes queued jobs", () => {
    const queued = new PdfAffinityQueue();
    const runs = Array.from({ length: 3 }, () => async () => undefined);
    queued.enqueue(runs[0]!, { id: "a", pdf: "ONE", priority: 0 });
    queued.enqueue(runs[1]!, { id: "b", pdf: "TWO", priority: 0 });
    queued.enqueue(runs[2]!, { id: "c", pdf: "ONE", priority: 0 });
    expect(queued.size).toBe(3);
    expect(queued.filter({ pdf: "ONE" })).toEqual([runs[0], runs[2]]);
    expect(queued.filter({ pdf: "TWO" })).toEqual([runs[1]]);
    queued.setPriority("b", 1);
    expect(queued.dequeue()).toBe(runs[1]);
    expect(() => queued.setPriority("gone", 1)).toThrow("gone");
    // Queued-abort removal is keyed by the task id p-queue assigns.
    queued.remove("c");
    expect(queued.size).toBe(1);
    expect(queued.dequeue()).toBe(runs[0]);
    expect(queued.dequeue()).toBeUndefined();
    expect(queued.size).toBe(0);
  });
});
