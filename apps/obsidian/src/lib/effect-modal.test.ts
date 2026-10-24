import { expect, test } from "vitest";

import { Effect, Fiber } from "@/lib/effect";
import { awaitModal } from "@/lib/effect-modal";
import { it } from "@/lib/effect-vitest";
import { modalAnswer } from "@/lib/modal-answer";

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

test("modalAnswer opens the modal before it returns, and answers once", async () => {
  const { modal, opener } = fakeModal<boolean>(false);
  const answer = modalAnswer(opener);
  expect(modal.isOpen).toBe(true);
  modal.choose(true);
  await expect(answer).resolves.toBe(true);
  expect(modal.closes).toBe(1);
});
