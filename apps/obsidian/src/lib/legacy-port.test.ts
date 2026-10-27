import { it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import { expect } from "vitest";

import { AbortError } from "./abort-error";
import { LegacyPortError, portCall } from "./legacy-port";

// #1824: a port whose run unload stopped rejects with an AbortError at its
// Promise edge; in Effect, that stop is an interrupt again.
it.effect("ends as an interrupt when the port rejects with an abort", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      portCall("open", () => Promise.reject(new AbortError())),
    );
    expect(Exit.isFailure(exit) && Exit.hasInterrupts(exit)).toBe(true);
    expect(Exit.findErrorOption(exit)).toEqual(Option.none());
  }),
);

it.effect("fails with the port's rejection as a typed failure", () =>
  Effect.gen(function* () {
    const cause = new Error("disk full");
    const error = yield* Effect.flip(
      portCall("open", () => Promise.reject(cause)),
    );
    expect(error).toBeInstanceOf(LegacyPortError);
    expect(error).toMatchObject({ step: "open", cause });
  }),
);
