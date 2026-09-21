// Runs a bundled browser entry inside a disposable Electron renderer, so canvas
// encoding and IndexedDB transactions use the same Chromium the plugin ships on.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "vite";

import { getPackageRoot, getWorkspaceRoot } from "@zotlit/scripts/package-roots";

/** Set ZOTLIT_TEST_ELECTRON_PATH to an installed Electron executable to run these. */
export const testElectron = process.env.ZOTLIT_TEST_ELECTRON_PATH;

/**
 * Bundles `entry`, runs its exported `run()` in a hidden window, and returns the
 * value `run()` resolved with. `name` is the bundle's global, `marker` the stdout
 * line the parent process reads the result from.
 *
 * @param options.minimized Shows the window off-screen and minimizes it before
 *   running, so Chromium's background throttling applies: Chromium reports a
 *   page hidden only after the window was shown once, and a hidden page clamps
 *   timers to one second. Use it for a trial whose claim depends on running as a
 *   minimized window would.
 */
export async function runInElectron(options: {
  entry: string;
  name: string;
  marker: string;
  timeoutMs?: number;
  minimized?: boolean;
}): Promise<unknown> {
  const workspaceRoot = await getWorkspaceRoot(options.entry);
  const parent = resolve(workspaceRoot, "tmp");
  await mkdir(parent, { recursive: true });
  await using resources = new AsyncDisposableStack();
  const folder = resources.adopt(
    await mkdtemp(resolve(parent, `${options.name}-`)),
    (path) => rm(path, { recursive: true, force: true }),
  );
  const output = await build({
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "@": resolve(getPackageRoot(options.entry), "src") } },
    build: {
      write: false,
      lib: { entry: options.entry, name: options.name, formats: ["iife"] },
    },
  });
  const result = Array.isArray(output) ? output[0]! : output;
  if (!("output" in result)) throw new Error("Expected a bundled entry");
  const chunk = result.output.find((part) => part.type === "chunk");
  if (!chunk) throw new Error("Missing entry bundle");
  const script = resolve(folder, "main.cjs");
  const minimize = options.minimized
    ? `
    window.show();
    window.minimize();
    // Minimizing settles with the window animation, and Chromium reports the
    // page hidden only then — that state is what turns throttling on, so wait
    // for it instead of racing it.
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await window.webContents.executeJavaScript("document.visibilityState")) === "hidden") break;
      const { promise, resolve } = Promise.withResolvers();
      setTimeout(resolve, 100);
      await promise;
    }`
    : "";
  await writeFile(
    script,
    `
const { app, BrowserWindow } = require("electron");
app.setPath("userData", ${JSON.stringify(resolve(folder, "profile"))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false${
      options.minimized ? ",\n    x: -10000,\n    y: -10000" : ""
    }
  });
  try {
    await window.loadFile(${JSON.stringify(resolve(folder, "index.html"))});
    ${minimize}
    const result = await window.webContents.executeJavaScript(${JSON.stringify(`${chunk.code}\n${options.name}.run()`)});
    process.stdout.write(${JSON.stringify(`${options.marker}=`)} + JSON.stringify(result) + "\\n");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`,
  );
  await writeFile(
    resolve(folder, "index.html"),
    "<!doctype html><title>Excerpt browser test</title>",
  );
  const { stdout } = await promisify(execFile)(testElectron!, [script], {
    timeout: options.timeoutMs ?? 30_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
  const line = stdout
    .split("\n")
    .find((value) => value.startsWith(`${options.marker}=`));
  if (!line) throw new Error(`Missing ${options.marker} in Electron output`);
  return JSON.parse(line.slice(options.marker.length + 1));
}
