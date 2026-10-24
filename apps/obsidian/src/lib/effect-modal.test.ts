import { expect } from "vitest";

import { Effect, Fiber } from "@/lib/effect";
import { awaitModal } from "@/lib/effect-modal";
import { it } from "@/lib/effect-vitest";

/** A modal that, as Obsidian's, calls its close callback once it closes. */
function fakeModal<A>(dismissed: A) {
  let settle: (value: A) => void = () => undefined;
  let open = false;
  const modal = {
    closes: 0,
    get isOpen() {
      return open;
    },
    choose(value: A) {
      // A choice settles first, then the modal closes itself.
      settle(value);
      modal.close();
    },
    close() {
      if (!open) return;
      open = false;
      modal.closes++;
      settle(dismissed);
    },
  };
  const opener = (next: (value: A) => void) => {
    settle = next;
    open = true;
    return modal;
  };
  return { modal, opener };
}

it.effect("awaitModal opens the modal and completes with the choice", () =>
  Effect.gen(function* () {
    const { modal, opener } = fakeModal<string | null>(null);
    const fiber = yield* awaitModal(opener).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    expect(modal.isOpen).toBe(true);
    modal.choose("picked");
    expect(yield* Fiber.join(fiber)).toBe("picked");
    expect(modal.closes).toBe(1);
  }),
);

it.effect("awaitModal completes with the dismiss value on close", () =>
  Effect.gen(function* () {
    const { modal, opener } = fakeModal<string | null>(null);
    const fiber = yield* awaitModal(opener).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    modal.close();
    expect(yield* Fiber.join(fiber)).toBeNull();
  }),
);

it.effect("awaitModal closes the modal once on interrupt", () =>
  Effect.gen(function* () {
    const { modal, opener } = fakeModal<string | null>(null);
    const fiber = yield* awaitModal(opener).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Fiber.interrupt(fiber);
    expect(modal.isOpen).toBe(false);
    expect(modal.closes).toBe(1);
  }),
);

it.effect("awaitModal keeps a choice that settles after the modal closed", () =>
  Effect.gen(function* () {
    // A SuggestModal closes before it reports the choice, so the modal
    // guards its dismiss value and settles the choice after close.
    let settle: (value: string | null) => void = () => undefined;
    let closes = 0;
    const fiber = yield* awaitModal<string | null>((next) => {
      settle = next;
      return { close: () => closes++ };
    }).pipe(Effect.forkChild({ startImmediately: true }));
    closes++;
    settle("picked");
    expect(yield* Fiber.join(fiber)).toBe("picked");
    expect(closes).toBe(1);
  }),
);
