/**
 * PROTOTYPE — throwaway. Runs the #593 matrix in Node against the copies in
 * `.scratch/libraries/` and writes `results/node-<library>.json`.
 *
 *   node --expose-gc bench-node.ts [library ...] [--quick] [--reps=3] [--only=regex]
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate as setImmediateP, setTimeout as setTimeoutP } from "node:timers/promises";

import { runMatrix, type BenchEnv } from "./bench-core.ts";

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}`))?.split("=")[1];
const quick = args.includes("--quick");
const reps = Number(flag("reps") ?? (quick ? 1 : 3));
const only = flag("only") ? new RegExp(flag("only")!) : undefined;
const libDir = join(here, ".scratch/libraries");
const libs = args.filter((a) => !a.startsWith("--"));
const targets = libs.length > 0 ? libs : readdirSync(libDir).map((f) => f.replace(/\.sqlite$/, ""));

const channel = new MessageChannel();
const pending: (() => void)[] = [];
channel.port1.onmessage = () => pending.shift()?.();

const env: BenchEnv = {
  name: `node-${process.version}`,
  now: () => performance.now(),
  yielders: {
    setImmediate: () => setImmediateP(),
    setTimeout0: () => setTimeoutP(0),
    messageChannel: () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
        channel.port2.postMessage(0);
      }),
  },
  defaultYield: "setImmediate",
  heapUsed: () => process.memoryUsage().heapUsed,
  gc: (globalThis as { gc?: () => void }).gc,
  log: (m) => console.log(m),
};

mkdirSync(join(here, "results"), { recursive: true });
for (const lib of targets) {
  console.log(`\n=== ${lib}`);
  const db = new DatabaseSync(join(libDir, `${lib}.sqlite`), { readOnly: true });
  const { library, results } = await runMatrix(env, db, { quick, reps, only });
  db.close();
  const file = join(here, "results", `node-${lib}${quick ? "-quick" : ""}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { host: env.name, platform: `${process.platform}-${process.arch}`, library: { name: lib, ...library }, at: new Date().toISOString(), results },
    ),
  );
  console.log(`wrote ${file}`);
}
channel.port1.close();
