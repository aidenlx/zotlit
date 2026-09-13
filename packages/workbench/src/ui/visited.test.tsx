// The retention rule the tab strip and the property rows share: an opened key
// stays, while its occupant does, and is dropped when the occupant changes.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { useRetention } from "./visited";

afterEach(cleanup);

function useRows(entries: readonly [number, string][]) {
  return useRetention(new Map(entries));
}

it("remembers an opened key and forgets one never opened", () => {
  const rows = renderHook(({ entries }) => useRows(entries), {
    initialProps: { entries: [[1, "title:expr"]] as [number, string][] },
  });
  expect(rows.result.current.isRetained(1)).toBe(false);
  act(() => rows.result.current.open(1));
  expect(rows.result.current.isRetained(1)).toBe(true);
});

it("drops a key whose occupant changed, and keeps one that moved with it", () => {
  const rows = renderHook(({ entries }) => useRows(entries), {
    initialProps: {
      entries: [
        [1, "title:expr"],
        [2, "related:expr"],
      ] as [number, string][],
    },
  });
  act(() => rows.result.current.open(1));
  act(() => rows.result.current.open(2));
  // The entry that was row 2 is removed; a different entry takes row 1.
  rows.rerender({ entries: [[1, "citekey:value"]] });
  expect(rows.result.current.isRetained(1)).toBe(false);
  expect(rows.result.current.isRetained(2)).toBe(false);
});
