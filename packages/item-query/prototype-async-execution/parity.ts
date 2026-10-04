/**
 * PROTOTYPE — throwaway. Confirms that every knob combination in the matrix
 * returns the same Query Result, so timing comparisons compare equal work.
 *
 *   node parity.ts [library ...]
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";

import { BASELINE, discoverQueries } from "./bench-core.ts";
import { executeItemQuery, type ExecOptions } from "./executor.ts";

const libDir = join(import.meta.dirname, ".scratch/libraries");
const libs = process.argv.slice(2);
let failed = 0;
for (const lib of libs.length > 0 ? libs : readdirSync(libDir).map((f) => f.replace(/\.sqlite$/, ""))) {
  const db = new DatabaseSync(join(libDir, `${lib}.sqlite`), { readOnly: true });
  const { queries } = discoverQueries(db);
  const variants: Partial<ExecOptions>[] = [
    { plan: "snapshot", sqlOrder: false, lateProjection: false },
    {},
    { plan: "predicate-led" },
    { sqlOrder: false },
    { sqlOrder: false, sortStrategy: "whole" },
    { candidateChunk: 0 },
    { lateProjection: false },
    { hydrateBatch: 7, candidateChunk: 13, sliceBudgetMs: 0 },
  ];
  for (const [name, q] of Object.entries(queries)) {
    let reference = "";
    for (const v of variants) {
      const { result } = executeItemQuery(db, q, { ...BASELINE, ...v }, { now: () => performance.now(), yield: () => setImmediate() }, () => ({ release() {} }));
      const r = await result;
      const sig = JSON.stringify([r.truncated, r.returnedCount, r.rows]);
      if (!reference) reference = sig;
      else if (sig !== reference) {
        failed++;
        console.log(`MISMATCH ${lib} ${name} ${JSON.stringify(v)}`);
      }
    }
    console.log(`${lib} ${name}: ${variants.length} variants checked`);
  }
  db.close();
}
process.exitCode = failed ? 1 : 0;
