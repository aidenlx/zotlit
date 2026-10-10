import { afterEach, expect, it, vi } from "vitest";

import { yieldToMain } from "@/lib/yield-to-main";

import { CitekeySnapshot } from "./snapshot";

// Failure modes: a cancelled build publishes; an equal rebuild loses identity;
// a changed candidate order is mistaken for equality. Existing service tests
// cover scope, ambiguity, reverse lookup, and held-answer publication.
afterEach(() => vi.restoreAllMocks());

it("cancels a snapshot build at a renderer yield", async () => {
  let elapsed = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (elapsed += 5));
  const abort = new AbortController();
  const rows = Array.from({ length: 1024 }, (_, itemID) => ({
    itemID,
    libraryID: 1,
    key: `key${itemID}`,
    indexedKey: `key${itemID}`,
    citekey: `cite${itemID}`,
  }));
  const abortAtTask = yieldToMain().then(() => abort.abort());
  const build = Promise.resolve(
    CitekeySnapshot.from(rows, new Set([1]), { signal: abort.signal }),
  );
  const rejected = expect(build).rejects.toMatchObject({ name: "AbortError" });
  await Promise.all([abortAtTask, rejected]);
});
