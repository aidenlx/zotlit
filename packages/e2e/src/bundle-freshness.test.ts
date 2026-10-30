import { describe, expect, it } from "vitest";

import { newerInput } from "./bundle-freshness.ts";

describe("newerInput", () => {
  it("passes a bundle written after every input", () => {
    expect(
      newerInput(100, [
        { path: "apps/obsidian/src/a.ts", mtimeMs: 90 },
        { path: "messages/en.json", mtimeMs: 100 },
      ]),
    ).toBeUndefined();
  });

  it("names the newest input written after the bundle", () => {
    expect(
      newerInput(100, [
        { path: "apps/obsidian/src/a.ts", mtimeMs: 110 },
        { path: "packages/ui/src/b.ts", mtimeMs: 130 },
        { path: "messages/en.json", mtimeMs: 120 },
      ]),
    ).toEqual({ path: "packages/ui/src/b.ts", mtimeMs: 130 });
  });

  it("ignores test and benchmark files, which the bundle never includes", () => {
    expect(
      newerInput(100, [
        { path: "apps/obsidian/src/a.test.ts", mtimeMs: 200 },
        { path: "packages/db/src/q.bench.ts", mtimeMs: 200 },
        { path: "apps/obsidian/src/view.test.tsx", mtimeMs: 200 },
      ]),
    ).toBeUndefined();
  });
});
