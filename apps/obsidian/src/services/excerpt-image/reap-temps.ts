import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";

import { sweepTempDirectory } from "@/lib/temp-sweep";
import type { PlainReapTempsOptions } from "@/lib/temp-sweep";

import { excerptTempDirectory } from "./temp-store";

/** Last use starts the seven-day lifetime; abandoned writes expire in one hour. */
export async function reapExcerptTemps({
  signal,
  parent = tmpdir(),
}: PlainReapTempsOptions = {}): Promise<void> {
  await sweepTempDirectory(
    {
      directory: excerptTempDirectory(parent),
      kind: "excerpt PNG",
      isResidue: async (name, path) => {
        const entry = await stat(path).catch(() => null);
        const cutoff = Temporal.Now.instant().subtract({
          hours: name.endsWith(".part") ? 1 : 7 * 24,
        });
        return entry !== null && entry.mtimeMs < cutoff.epochMilliseconds;
      },
    },
    signal,
  );
}
