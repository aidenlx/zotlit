/**
 * PROTOTYPE — throwaway. Runs the #593 matrix inside a running Obsidian
 * renderer through the Obsidian CLI and writes `results/renderer-<library>.json`.
 * The renderer only reads the copies in `.scratch/libraries/`.
 *
 *   node bench-renderer.ts [library ...] [--quick] [--reps=3] [--vault=<id>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}`))?.split("=")[1];
const quick = args.includes("--quick");
const reps = Number(flag("reps") ?? (quick ? 1 : 3));
const vault = flag("vault");
const libDir = join(here, ".scratch/libraries");
const libs = args.filter((a) => !a.startsWith("--"));
const targets = libs.length > 0 ? libs : readdirSync(libDir).map((f) => f.replace(/\.sqlite$/, ""));

/** Strip types, imports, and `export` so both modules share one function scope. */
const inline = (file: string) =>
  stripTypeScriptTypes(readFileSync(join(here, file), "utf8"))
    .replace(/^import[\s\S]*?from\s+"[^"]+";$/gm, "")
    .replace(/^export /gm, "");

// Set OBSIDIAN_CLI to a checkout with installed dependencies when this one has none.
const cli = process.env.OBSIDIAN_CLI ?? resolve(here, "../../scripts/scripts/obsidian-cli.ts");
for (const lib of targets) {
  const out = join(here, "results", `renderer-${lib}${quick ? "-quick" : ""}.json`);
  const js = `(async () => {
    const { DatabaseSync } = require("node:sqlite");
    const fs = require("node:fs");
    ${inline("executor.ts")}
    ${inline("bench-core.ts")}
    const channel = new MessageChannel();
    const pending = [];
    channel.port1.onmessage = () => pending.shift()?.();
    const env = {
      name: "obsidian-renderer electron-" + process.versions.electron + " node-" + process.versions.node,
      now: () => performance.now(),
      yielders: {
        schedulerYield: () => scheduler.yield(),
        setImmediate: () => new Promise((r) => setImmediate(r)),
        setTimeout0: () => new Promise((r) => setTimeout(r, 0)),
        messageChannel: () => new Promise((r) => { pending.push(r); channel.port2.postMessage(0); }),
      },
      defaultYield: "schedulerYield",
      heapUsed: () => performance.memory?.usedJSHeapSize ?? process.memoryUsage().heapUsed,
      onFrame: (cb) => {
        let on = true;
        const loop = (t) => { if (!on) return; cb(t); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        return () => { on = false; };
      },
      log: (m) => console.log("[593]", m),
    };
    const db = new DatabaseSync(${JSON.stringify(join(libDir, `${lib}.sqlite`))}, { readOnly: true });
    try {
      const { library, results } = await runMatrix(env, db, { quick: ${quick}, reps: ${reps} });
      fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({
        host: env.name, platform: process.platform + "-" + process.arch,
        visible: document.visibilityState, library: { name: ${JSON.stringify(lib)}, ...library },
        at: new Date().toISOString(), results }));
      return "wrote " + results.length + " experiments";
    } finally {
      db.close();
      channel.port1.close();
    }
  })()`;
  const tmp = join(here, ".scratch", `renderer-${lib}.js`);
  writeFileSync(tmp, js);
  console.log(`=== ${lib}`);
  console.log(
    execFileSync(
      "node",
      [cli, "--timeout", "3600", "--js", tmp, ...(vault ? [`vault=${vault}`] : [])],
      { encoding: "utf8" },
    ),
  );
}
