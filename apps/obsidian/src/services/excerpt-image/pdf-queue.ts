import { Deferred, Effect, Fiber, Scope, Semaphore } from "effect";

/** Jobs admitted — reserved, queued, or rendering — at once (ADR 0052). */
export const EXCERPT_JOB_LIMIT = 128;
/** One resident PDF document: the renderer renders one crop at a time. */
export const EXCERPT_RENDER_CONCURRENCY = 1;
/** Freshness and cache checks that may run beside a crop render. */
export const EXCERPT_PREFLIGHT_CONCURRENCY = 4;
/** Consecutive jobs one PDF may keep before another waiting PDF gets a turn. */
export const EXCERPT_PDF_AFFINITY = 4;

interface Ticket {
  pdf: string;
  sequence: number;
  ready: Deferred.Deferred<void>;
  selected: boolean;
}

/** A permit goes directly to the next ticket, before a new arrival can take it. */
function makeLane(
  concurrency: number,
  affinity: boolean,
  changes: { before: () => void; after: Effect.Effect<unknown> },
) {
  const permits = Semaphore.makeUnsafe(concurrency);
  const tickets: Ticket[] = [];
  let active = 0;
  let last: string | undefined;
  let consecutive = 0;
  const dispatch = Effect.gen(function* () {
    while (tickets.length > 0 && (yield* permits.takeIfAvailable(1))) {
      tickets.sort((a, b) => a.sequence - b.sequence);
      let index = 0;
      if (
        affinity &&
        tickets[0]!.pdf === last &&
        consecutive >= EXCERPT_PDF_AFFINITY
      ) {
        const other = tickets.findIndex((ticket) => ticket.pdf !== last);
        if (other !== -1) index = other;
      }
      const ticket = tickets.splice(index, 1)[0]!;
      if (ticket.pdf === last) consecutive++;
      else {
        last = ticket.pdf;
        consecutive = 1;
      }
      ticket.selected = true;
      active++;
      yield* Deferred.succeed(ticket.ready, undefined);
    }
  }).pipe(Effect.uninterruptible);
  const take = Effect.fnUntraced(function* (order: {
    pdf: string;
    sequence: number;
  }) {
    const held = yield* Effect.acquireRelease(
      Effect.sync(() => {
        changes.before();
        const ticket: Ticket = {
          ...order,
          ready: Deferred.makeUnsafe<void>(),
          selected: false,
        };
        tickets.push(ticket);
        let released = false;
        const release = Effect.gen(function* () {
          if (released) return;
          released = true;
          if (ticket.selected) {
            active--;
            yield* permits.release(1);
          } else {
            const index = tickets.indexOf(ticket);
            if (index !== -1) tickets.splice(index, 1);
          }
          yield* dispatch;
          yield* changes.after;
        });
        return { ticket, release };
      }),
      (held) => held.release,
    );
    yield* dispatch.pipe(
      Effect.andThen(Deferred.await(held.ticket.ready)),
      Effect.onInterrupt(() => held.release),
    );
    return held.release;
  });
  return {
    take,
    get active() {
      return active;
    },
    get queued() {
      return tickets.length;
    },
    get busy() {
      return active > 0 || tickets.length > 0;
    },
  };
}

export type ExcerptPdfQueue = Effect.Success<
  ReturnType<typeof makeExcerptPdfQueue>
>;

/** Admission, preflight, and ordered rendering share the owner's Scope. */
export const makeExcerptPdfQueue = Effect.fn("ExcerptPdfQueue.make")(function* (
  options: { limit?: number; render?: number; preflight?: number } = {},
) {
  const scope = yield* Scope.Scope;
  let sequence = 0;
  let idle = Deferred.makeUnsafe<void>();
  yield* Deferred.succeed(idle, undefined);
  const markBusy = () => {
    if (!renders.busy && !checks.busy) idle = Deferred.makeUnsafe<void>();
  };
  const markIdle = Effect.suspend(() =>
    renders.busy || checks.busy
      ? Effect.void
      : Deferred.succeed(idle, undefined),
  );
  const capacity = makeLane(options.limit ?? EXCERPT_JOB_LIMIT, false, {
    before: () => {},
    after: Effect.void,
  });
  const renders = makeLane(options.render ?? EXCERPT_RENDER_CONCURRENCY, true, {
    before: markBusy,
    after: markIdle,
  });
  const checks = makeLane(
    options.preflight ?? EXCERPT_PREFLIGHT_CONCURRENCY,
    false,
    { before: markBusy, after: markIdle },
  );

  const owned = Effect.fnUntraced(function* <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) {
    const fiber = yield* work.pipe(
      Effect.forkIn(scope, { startImmediately: true }),
    );
    return yield* Fiber.join(fiber).pipe(
      Effect.onInterrupt(() => Fiber.interrupt(fiber)),
    );
  });
  const render = Effect.fn("ExcerptPdfQueue.render")(
    <A, E, R>(
      task: Effect.Effect<A, E, R>,
      order: { pdf: string; sequence: number },
    ) =>
      owned(
        Effect.scoped(
          Effect.gen(function* () {
            yield* renders.take(order).pipe(Effect.asVoid);
            return yield* task;
          }),
        ),
      ),
  );
  const reserve = Effect.gen(function* () {
    const release = yield* capacity.take({ pdf: "", sequence: ++sequence });
    return { render, release };
  });
  return {
    get admitted() {
      return capacity.active;
    },
    get busy() {
      return capacity.busy || renders.busy || checks.busy;
    },
    get diagnostics() {
      return {
        admitted: capacity.active,
        rendering: renders.active,
        queued: renders.queued,
        checking: checks.active,
        awaiting: capacity.queued,
      };
    },
    nextSequence: () => ++sequence,
    reserve,
    preflight: Effect.fn("ExcerptPdfQueue.preflight")(
      <A, E, R>(task: Effect.Effect<A, E, R>) =>
        owned(
          Effect.scoped(
            Effect.gen(function* () {
              yield* checks
                .take({ pdf: "", sequence: ++sequence })
                .pipe(Effect.asVoid);
              return yield* task;
            }),
          ),
        ),
    ),
    teardown: Effect.fn("ExcerptPdfQueue.teardown")(
      <A, E, R>(task: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          const order = { pdf: "", sequence: ++sequence };
          return owned(
            Effect.scoped(
              Effect.gen(function* () {
                yield* reserve;
                return yield* render(task, order);
              }),
            ),
          );
        }),
    ),
    idle: Effect.suspend(() => Deferred.await(idle)),
  };
});
