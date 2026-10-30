import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  matchesCollection,
  matchesNodeTest,
  projectCollection,
} from "./test-gates.ts";

const cwd = resolve("fixture/package");
const defaults = {
  include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  exclude: ["**/node_modules/**"],
};
// Failure modes: excludes and package boundaries narrow collection; defaults,
// TSX/MTS, dotfiles, test.dir and project roots widen it only as configured.
describe("gate collection matcher", () => {
  it.each([
    ["src/value.test.ts", true],
    ["src/view.test.tsx", true],
    ["src/value.test.mts", true],
    ["src/.hidden.test.ts", true],
    ["src/value.ts", false],
    ["node_modules/dependency/value.test.ts", false],
    ["../sibling/value.test.ts", false],
  ])("matches the default collection for %s", (path, expected) => {
    expect(
      matchesCollection(
        resolve(cwd, path),
        projectCollection({}, cwd, defaults),
      ),
    ).toBe(expected);
  });

  it.each([
    ["src/kept.test.ts", true],
    ["src/excluded.test.ts", false],
    ["scripts/kept.test.ts", false],
  ])("applies include and exclude to %s", (path, expected) => {
    const collection = projectCollection(
      {
        test: {
          include: ["src/**/*.test.ts"],
          exclude: ["**/excluded.test.ts"],
        },
      },
      cwd,
      defaults,
    );
    expect(matchesCollection(resolve(cwd, path), collection)).toBe(expected);
  });

  it("resolves a project root and test directory together", () => {
    const collection = projectCollection(
      { root: "project", test: { dir: "cases" } },
      cwd,
      defaults,
    );
    expect(
      matchesCollection(
        resolve(cwd, "project/cases/value.test.ts"),
        collection,
      ),
    ).toBe(true);
    expect(
      matchesCollection(
        resolve(cwd, "project/other/value.test.ts"),
        collection,
      ),
    ).toBe(false);
  });

  it("applies file filters after collection patterns", () => {
    const collection = {
      ...projectCollection({}, cwd, defaults),
      filters: ["kept"],
    };
    expect(
      matchesCollection(resolve(cwd, "src/kept.test.ts"), collection),
    ).toBe(true);
    expect(
      matchesCollection(resolve(cwd, "src/other.test.ts"), collection),
    ).toBe(false);
  });

  it.each([
    ["src/value.test.ts", [], true],
    ["src/value.test.mjs", [], true],
    ["src/view.test.tsx", [], false],
    ["evals/kept.test.mjs", ["evals/*.test.mjs"], true],
    ["src/kept.test.mjs", ["evals/*.test.mjs"], false],
  ] as const)(
    "matches Node collection for %s with %j",
    (path, patterns, expected) => {
      expect(matchesNodeTest(resolve(cwd, path), cwd, [...patterns])).toBe(
        expected,
      );
    },
  );
});
