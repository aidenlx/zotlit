// What counts as a stale CSL store entry, next to the code that materializes one.

import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";

import { Temporal } from "@zotlit/shared/temporal";

import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import { sweepTempDirectory } from "@/lib/temp-sweep";
import type { ReapTempsOptions } from "@/lib/temp-sweep";

import { CSL_STAGING_EXT, cslStoreDirectory } from "./csl";

const logger = getLogger(["pandoc", "reap-temps"]);

/**
 * How long a materialized Resolved CSL Style stands unused before it is
 * evicted. Every resolve restamps the style it hands out, so the clock only has
 * to outlast the gap between two uses of one style.
 *
 * @see materializeCslStyle's `restamp`
 */
const CSL_MAX_AGE = Temporal.Duration.from({ hours: 24 * 30 });

/**
 * How long a staged style file stands before it counts as abandoned. Only a
 * crash between the write and the link leaves one, and the whole
 * write-then-link window is milliseconds.
 */
const STAGING_MAX_AGE = Temporal.Duration.from({ hours: 1 });

/**
 * Evict every store entry whose own clock has run out. A materialized style is
 * a content-addressed cache shared across runs and handed by path to Pandoc
 * processes ZotLit does not supervise, so no run owns one and none can dispose
 * one — they age out instead.
 *
 * ZotLit owns the whole store, so an entry that is no staged file ages as a
 * style whatever it is named: an unrecognized entry is residue too.
 */
export async function reapCslStore({
  signal,
  parent = tmpdir(),
}: ReapTempsOptions = {}): Promise<void> {
  await sweepTempDirectory({
    directory: cslStoreDirectory(parent),
    kind: "materialized CSL style",
    signal,
    isResidue: (name, path) =>
      isOlderThan(
        path,
        name.endsWith(CSL_STAGING_EXT) ? STAGING_MAX_AGE : CSL_MAX_AGE,
      ),
  });
}

/**
 * Age from `mtime`, which every resolve of the style restamps, so the clock
 * reads last use. An entry that vanished under us is not older than anything.
 */
async function isOlderThan(
  path: string,
  maxAge: Temporal.Duration,
): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(path);
    const cutoff = Temporal.Now.instant().subtract(maxAge);
    return (
      Temporal.Instant.compare(
        Temporal.Instant.fromEpochMilliseconds(Math.trunc(mtimeMs)),
        cutoff,
      ) < 0
    );
  } catch (error) {
    if (!isErrno(error, "ENOENT")) {
      logger.warn("Failed to age a CSL store entry", { error, path });
    }
    return false;
  }
}
