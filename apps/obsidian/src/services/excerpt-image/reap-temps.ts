// What counts as a stale excerpt PNG, next to the code that publishes one.

import { Duration, Effect } from "effect";
import { tmpdir } from "node:os";

import { isOlderThan, sweepTempDirectoryEffect } from "@/lib/temp-sweep";
import type { ReapTempsOptions } from "@/lib/temp-sweep";

import { excerptTempDirectory } from "./temp-store";

/** Every reuse restamps a published PNG, so last use starts its lifetime. */
const PNG_MAX_AGE = Duration.days(7);

/** A `.part` file outlives its write only when the write was abandoned. */
const PART_MAX_AGE = Duration.hours(1);

/** Evict published PNGs unused for seven days and writes abandoned for an hour. */
export const reapExcerptTemps = Effect.fnUntraced(function* ({
  parent = tmpdir(),
}: ReapTempsOptions = {}) {
  yield* sweepTempDirectoryEffect({
    directory: excerptTempDirectory(parent),
    kind: "excerpt PNG",
    isResidue: (name, path) =>
      isOlderThan(path, name.endsWith(".part") ? PART_MAX_AGE : PNG_MAX_AGE),
  });
});
