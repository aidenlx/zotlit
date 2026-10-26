// What counts as a stale CSL store entry, next to the code that materializes one.

import { Duration, Effect } from "effect";
import { tmpdir } from "node:os";

import { isOlderThan, sweepTempDirectory } from "@/lib/temp-sweep";
import type { ReapTempsOptions } from "@/lib/temp-sweep";

import { CSL_STAGING_EXT, cslStoreDirectory } from "./csl";

/**
 * How long a materialized Resolved CSL Style stands unused before it is
 * evicted. Every resolve restamps the style it hands out, so the clock only has
 * to outlast the gap between two uses of one style.
 *
 * @see materializeCslStyle's `restamp`
 */
const CSL_MAX_AGE = Duration.days(30);

/**
 * How long a staged style file stands before it counts as abandoned. Only a
 * crash between the write and the link leaves one, and the whole
 * write-then-link window is milliseconds.
 */
const STAGING_MAX_AGE = Duration.hours(1);

/**
 * Evict every store entry whose own clock has run out. A materialized style is
 * a content-addressed cache shared across runs and handed by path to Pandoc
 * processes ZotLit does not supervise, so no run owns one and none can dispose
 * one — they age out instead.
 *
 * ZotLit owns the whole store, so an entry that is no staged file ages as a
 * style whatever it is named: an unrecognized entry is residue too. Age is
 * read from `mtime`, which every resolve of the style restamps, so the clock
 * reads last use.
 */
export const reapCslStore = Effect.fnUntraced(function* ({
  parent = tmpdir(),
}: ReapTempsOptions = {}) {
  yield* sweepTempDirectory({
    directory: cslStoreDirectory(parent),
    kind: "materialized CSL style",
    isResidue: (name, path) =>
      isOlderThan(
        path,
        name.endsWith(CSL_STAGING_EXT) ? STAGING_MAX_AGE : CSL_MAX_AGE,
      ),
  });
});
