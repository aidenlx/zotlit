#!/usr/bin/env node

// Fails when a `.snap` entry exceeds MAX_SNAPSHOT_LINES. Checks the files it
// is given (Lefthook passes the staged ones), or every tracked `.snap` file.
import { readFile } from "node:fs/promises";
import { $ } from "zx";

import { largeSnapshots, largeSnapshotsMessage } from "#snapshot-size";

const given = process.argv.slice(2);
const paths = given.length
  ? given
  : (await $`git ls-files -z -- ${"*.snap"}`).stdout
      .split("\0")
      .filter(Boolean);
const files = [];
for (const path of paths) {
  const large = largeSnapshots(await readFile(path, "utf8"));
  if (large.length) files.push({ path, large });
}
if (files.length) {
  console.error(largeSnapshotsMessage(files));
  process.exitCode = 1;
}
