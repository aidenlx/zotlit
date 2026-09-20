import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "vite";
import { expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

// Set ZOTLIT_TEST_ELECTRON_PATH to an installed Electron executable to run this integration test.
const electron = process.env.ZOTLIT_TEST_ELECTRON_PATH;
it.skipIf(!electron)(
  "persists and bounds derived images in Chromium IndexedDB",
  async () => {
    await using resources = new AsyncDisposableStack();
    const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
    const root = resolve(workspaceRoot, "tmp");
    await mkdir(root, { recursive: true });
    const folder = resources.adopt(
      await mkdtemp(resolve(root, "excerpt-store-test-")),
      (path) => rm(path, { recursive: true, force: true }),
    );
    const output = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        lib: {
          entry: resolve(import.meta.dirname, "store.browser-test.ts"),
          name: "excerptStoreTrial",
          formats: ["iife"],
        },
      },
    });
    const result = Array.isArray(output) ? output[0]! : output;
    if (!("output" in result))
      throw new Error("Expected a bundled store trial");
    const chunk = result.output.find((part) => part.type === "chunk");
    if (!chunk) throw new Error("Missing store trial bundle");
    const script = resolve(folder, "main.cjs");
    await writeFile(
      script,
      `
const { app, BrowserWindow } = require("electron");
app.setPath("userData", ${JSON.stringify(resolve(folder, "profile"))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  try {
    await window.loadFile(${JSON.stringify(resolve(folder, "index.html"))});
    const result = await window.webContents.executeJavaScript(${JSON.stringify(`${chunk.code}\nexcerptStoreTrial.run()`)});
    process.stdout.write("EXCERPT_STORE_RESULT=" + JSON.stringify(result) + "\\n");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`,
    );
    await writeFile(
      resolve(folder, "index.html"),
      "<!doctype html><title>Excerpt store test</title>",
    );
    const { stdout } = await promisify(execFile)(electron!, [script], {
      timeout: 25_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
    });
    const line = stdout
      .split("\n")
      .find((value) => value.startsWith("EXCERPT_STORE_RESULT="));
    expect(
      line && JSON.parse(line.slice("EXCERPT_STORE_RESULT=".length)),
    ).toEqual([
      "restart and vault isolation",
      "LRU, replacement accounting, oversized and owned bytes",
      "transaction serialization and clear accounting",
      "failed transaction rolls back pixels and accounting",
      "schema reset",
    ]);
  },
  30_000,
);
