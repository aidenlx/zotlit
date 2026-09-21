import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "vite";
import { expect, it } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

// Set ZOTLIT_TEST_ELECTRON_PATH to run the native Chromium pixel oracle and
// benchmark. The utility remains reproducible in the real Obsidian renderer.
const electron = process.env.ZOTLIT_TEST_ELECTRON_PATH;

it.skipIf(!electron)(
  "proves WebP pixels and records representative PNG/WebP measurements",
  async () => {
    await using resources = new AsyncDisposableStack();
    const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
    const root = resolve(workspaceRoot, "tmp");
    await mkdir(root, { recursive: true });
    const folder = resources.adopt(
      await mkdtemp(resolve(root, "excerpt-encoding-test-")),
      (path) => rm(path, { recursive: true, force: true }),
    );
    const output = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        lib: {
          entry: resolve(import.meta.dirname, "encoding.browser-test.ts"),
          name: "excerptEncodingTrial",
          formats: ["iife"],
        },
      },
    });
    const result = Array.isArray(output) ? output[0]! : output;
    if (!("output" in result)) throw new Error("Expected a bundled trial");
    const chunk = result.output.find((part) => part.type === "chunk");
    if (!chunk) throw new Error("Missing encoding trial bundle");
    const script = resolve(folder, "main.cjs");
    await writeFile(
      script,
      `
const { app, BrowserWindow } = require("electron");
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  try {
    await window.loadFile(${JSON.stringify(resolve(folder, "index.html"))});
    const result = await window.webContents.executeJavaScript(${JSON.stringify(`${chunk.code}\nexcerptEncodingTrial.run()`)});
    process.stdout.write("EXCERPT_ENCODING_RUNTIME=" + JSON.stringify(process.versions) + "\\n");
    process.stdout.write("EXCERPT_ENCODING_RESULT=" + JSON.stringify(result) + "\\n");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`,
    );
    await writeFile(
      resolve(folder, "index.html"),
      "<!doctype html><title>Excerpt encoding test</title>",
    );
    const { stdout } = await promisify(execFile)(electron!, [script], {
      timeout: 25_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
    });
    const line = stdout
      .split("\n")
      .find((value) => value.startsWith("EXCERPT_ENCODING_RESULT="));
    const runtimeLine = stdout
      .split("\n")
      .find((value) => value.startsWith("EXCERPT_ENCODING_RUNTIME="));
    const measurements = line
      ? JSON.parse(line.slice("EXCERPT_ENCODING_RESULT=".length))
      : undefined;
    const runtime = runtimeLine
      ? JSON.parse(runtimeLine.slice("EXCERPT_ENCODING_RUNTIME=".length))
      : undefined;
    process.stdout.write(
      `EXCERPT_ENCODING_RUNTIME=${JSON.stringify(runtime)} EXCERPT_ENCODING_MEASUREMENTS=${JSON.stringify(measurements)}\n`,
    );
    expect(runtime).toEqual(
      expect.objectContaining({
        chrome: expect.any(String),
        electron: expect.any(String),
      }),
    );
    expect(measurements).toHaveLength(4);
    expect(measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "text", width: 640, height: 360 }),
        expect.objectContaining({ kind: "equation" }),
        expect.objectContaining({ kind: "ink" }),
        expect.objectContaining({ kind: "image-heavy" }),
      ]),
    );
    for (const measurement of measurements) {
      expect(measurement.pngBytes).toBeGreaterThan(0);
      expect(measurement.webpBytes).toBeGreaterThan(0);
      expect(measurement.pngMs).toBeGreaterThanOrEqual(0);
      expect(measurement.webpMs).toBeGreaterThanOrEqual(0);
    }
  },
  30_000,
);
