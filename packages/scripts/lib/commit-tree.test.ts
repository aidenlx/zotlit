import { describe, expect, it } from "vitest";

import { looseFiles, looseFilesMessage } from "./commit-tree.ts";

/** `git status --porcelain=v1 -z` output for these entries. */
const status = (...entries: string[]) =>
  entries.map((entry) => `${entry}\0`).join("");

describe("looseFiles", () => {
  it("is empty for a clean tree", () => {
    expect(looseFiles("")).toEqual([]);
  });

  it.each([
    ["an untracked source", "?? src/new.ts"],
    ["a source changed only on disk", " M src/a.tsx"],
    ["a source deleted only on disk", " D src/old.mts"],
    ["a message catalog changed only on disk", " M messages/en.json"],
  ])("names %s", (_case, entry) => {
    expect(looseFiles(status(entry))).toEqual([entry.slice(3)]);
  });

  it.each([
    ["a staged source", "M  src/a.ts"],
    [
      "a partly staged source, whose unstaged hunks Lefthook hides",
      "MM src/a.ts",
    ],
    ["an added source changed again on disk", "AM src/b.ts"],
    ["a file the build does not read", " M README.md"],
  ])("leaves out %s", (_case, entry) => {
    expect(looseFiles(status(entry))).toEqual([]);
  });

  it("reads a rename's source field as part of the rename", () => {
    // A source path that would read as an untracked entry on its own.
    expect(
      looseFiles(status("R  src/new.ts", "?? old.ts", " M src/c.ts")),
    ).toEqual(["src/c.ts"]);
  });

  it("keeps a path with spaces whole", () => {
    expect(looseFiles(status("?? my notes/a b.ts"))).toEqual([
      "my notes/a b.ts",
    ]);
  });
});

it("names each loose file and the way to skip the check", () => {
  const message = looseFilesMessage(["src/a.ts"]);
  expect(message).toContain("\n  src/a.ts\n");
  expect(message).toContain("LEFTHOOK_EXCLUDE=tree");
});
