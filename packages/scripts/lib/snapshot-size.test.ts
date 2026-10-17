import { describe, expect, it } from "vitest";

import { largeSnapshots } from "./snapshot-size.ts";

/** A `.snap` entry whose value spans `body` lines between its two markers. */
const entry = (name: string, body: number) =>
  [
    `exports[\`${name}\`] = \``,
    ...Array.from({ length: body }, (_, i) => `  "line ${i}",`),
    "`;",
  ].join("\n");

const file = (...entries: string[]) =>
  ["// Vitest Snapshot v1", "", ...entries, ""].join("\n\n");

describe("largeSnapshots", () => {
  it("is empty for a file without entries", () => {
    expect(largeSnapshots(file(), 3)).toEqual([]);
  });

  it("counts an entry from its exports line through its closing line", () => {
    // 2 marker lines + 2 body lines = 4.
    expect(largeSnapshots(file(entry("at the cap 1", 2)), 4)).toEqual([]);
    expect(largeSnapshots(file(entry("over the cap 1", 3)), 4)).toEqual([
      { name: "over the cap 1", lines: 5 },
    ]);
  });

  it("names only the entries over the cap", () => {
    expect(
      largeSnapshots(
        file(entry("small 1", 1), entry("large 1", 10), entry("small 2", 0)),
        5,
      ),
    ).toEqual([{ name: "large 1", lines: 12 }]);
  });

  it("closes a one-line entry on its own line", () => {
    expect(
      largeSnapshots(
        file('exports[`inline 1`] = `"a"`;', entry("next 1", 6)),
        5,
      ),
    ).toEqual([{ name: "next 1", lines: 8 }]);
  });

  it("keeps an escaped backtick inside the value", () => {
    const text = file(
      ["exports[`escaped 1`] = `", "  \\`code\\`;", "  more", "`;"].join("\n"),
    );
    expect(largeSnapshots(text, 3)).toEqual([{ name: "escaped 1", lines: 4 }]);
  });
});
