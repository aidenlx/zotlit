/**
 * PROTOTYPE — throwaway. Bundles `bench.ts`, loads it in a running Obsidian
 * window with `require`, runs the matrix per Library tier, then measures
 * cancel requests that arrive as a second Obsidian CLI call.
 *
 *   OBSIDIAN_CLI=<checkout>/packages/scripts/scripts/obsidian-cli.ts \
 *   ESBUILD=<checkout>/apps/obsidian/node_modules/.bin/esbuild \
 *   NODE_PATH=<checkout>/apps/obsidian/node_modules \
 *   node run-renderer.ts vault=<id> [--reps=5] [--tiers=tier-10k,...] [--skip-matrix] [--cli-engines=a,b]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n: string) =>
  args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const vault = args.find((a) => a.startsWith("vault="));
if (!vault) throw new Error("pass vault=<id>");
const reps = Number(flag("reps") ?? 5);
const tiers = (flag("tiers") ?? "tier-10k,tier-50k,tier-100k").split(",");
const cli = process.env.OBSIDIAN_CLI!;
const cliEngines = (flag("cli-engines") ?? "plain-mc8,effect-mc8").split(",");
const bundle = join(here, ".scratch/bench.cjs");

execFileSync(
  process.env.ESBUILD!,
  [
    join(here, "bench.ts"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--target=node24",
    `--outfile=${bundle}`,
    "--log-level=warning",
  ],
  { stdio: "inherit" },
);

const call = (code: string, timeout = 3600) =>
  execFileSync(
    "node",
    [cli, "--timeout", String(timeout), vault, "eval", `code=${code}`],
    {
      encoding: "utf8",
    },
  ).trim();
const load = `(delete require.cache[${JSON.stringify(bundle)}], require(${JSON.stringify(bundle)}))`;

// A covered window is throttled; turn that off for the run.
console.log(
  call(
    `(()=>{const r=require("@electron/remote");r.getCurrentWebContents().setBackgroundThrottling(false);return "throttling off, "+document.visibilityState})()`,
  ),
);

for (const tier of tiers) {
  const file = join(here, ".scratch/libraries", `${tier}.sqlite`);
  const out = join(here, "results", `renderer-${tier}.json`);
  if (!args.includes("--skip-matrix")) {
    console.log(`=== ${tier}`);
    console.log(
      call(
        `(async()=>{const b=${load};try{return await b.runMatrix(${JSON.stringify(file)},{reps:${reps},out:${JSON.stringify(out)}})}finally{b.close()}})()`,
      ),
    );
  }

  // CLI-delivered cancel: the query repeats until the abort call lands inside a run.
  const matrix = JSON.parse(readFileSync(out, "utf8"));
  const cliRuns: unknown[] = [];
  call(`(globalThis.__b1313=${load}, "loaded")`);
  // Idle baseline for the same call path: CLI start-up plus IPC with no query running.
  const idleIpcMs: number[] = [];
  for (let r = 0; r < reps; r++) {
    const sent = Date.now();
    idleIpcMs.push(Number(call(`Date.now() - ${sent}`).replace(/^=> /, "")));
  }
  console.log(`cli-cancel ${tier} idle ipc: ${idleIpcMs.join("/")}ms`);
  matrix.cliIdleIpcMs = idleIpcMs;
  for (const engine of cliEngines) {
    const delay = 300 + Math.random() * 400;
    for (let r = 0; r < reps; r++) {
      call(
        `globalThis.__b1313.startCli(${JSON.stringify(file)},${JSON.stringify(engine)},"full-export")`,
      );
      await sleep(delay);
      const sent = Date.now();
      const ack = JSON.parse(
        call(`globalThis.__b1313.abortCli(${sent})`).replace(/^=> /, ""),
      );
      const ackAt = Date.now();
      const rec = JSON.parse(
        call(
          `globalThis.__b1313.collectCli().then(r=>JSON.stringify({...r,slices:[]}))`,
        ).replace(/^=> /, ""),
      );
      cliRuns.push({
        engine,
        delayMs: delay,
        ...ack,
        cliRoundTripMs: ackAt - sent,
        ...rec,
      });
      console.log(
        `cli-cancel ${tier} ${engine}: ipc ${ack.receivedAtWall - sent}ms, settle ${rec.settleAfterAbortMs?.toFixed(1)}ms, cancelled ${rec.cancelled}`,
      );
    }
  }
  call(`(globalThis.__b1313.close(), delete globalThis.__b1313, "ok")`);
  matrix.cliCancel = [
    ...(args.includes("--skip-matrix")
      ? (matrix.cliCancel ?? []).filter(
          (r: any) => !cliEngines.includes(r.engine),
        )
      : []),
    ...cliRuns,
  ];
  writeFileSync(out, JSON.stringify(matrix));
}
