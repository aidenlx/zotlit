import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { loadTemporal } from "./temporal";

const present = globalThis.Temporal;

afterEach(() => {
  globalThis.Temporal = present;
});

describe("loadTemporal", () => {
  it("leaves a runtime that already has Temporal alone", async () => {
    const own = {} as typeof globalThis.Temporal;
    globalThis.Temporal = own;

    await Effect.runPromise(loadTemporal);

    expect(globalThis.Temporal).toBe(own);
  });

  it("installs the polyfill when the global is absent", async () => {
    // @ts-expect-error the absent case is what the polyfill exists for
    delete globalThis.Temporal;

    await Effect.runPromise(loadTemporal);

    expect(globalThis.Temporal.PlainDate.from("2026-09-04").year).toBe(2026);
  });
});
