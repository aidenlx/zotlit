// The scanner's public entry runs in the same guarded bundle as production workers.
import { once } from "node:events";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { build } from "vite";
import { expect, it } from "vitest";

import { embeddedWorker } from "./embedded-worker.ts";

const packageRoot = resolve(import.meta.dirname, "..");

it("bundles the scanner and classifier without Obsidian and scans in a worker (#1689)", async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "scan-worker-test-entry",
        resolveId: (id) => (id === "virtual:scan-test" ? id : null),
        load: (id) =>
          id === "virtual:scan-test"
            ? 'export { default } from "virtual:scan-worker";'
            : null,
      },
      embeddedWorker({
        id: "virtual:scan-worker",
        entry: resolve(packageRoot, "src/services/citation-index/scan-note.ts"),
        config: {
          resolve: { alias: { "@": resolve(packageRoot, "src") } },
          external: [],
          minify: false,
          sourcemap: false,
          target: "es2025",
        },
      }),
    ],
    build: {
      write: false,
      lib: { entry: "virtual:scan-test", formats: ["es"] },
      rolldownOptions: { input: "virtual:scan-test" },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Scanner worker bundle emitted no JavaScript");
  const bundled = (await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  )) as { default: string };
  await using worker = new Worker(
    `
    const { parentPort } = require("node:worker_threads");
    ${bundled.default}
    parentPort.on("message", text => parentPort.postMessage(exports.scanNote(text)));
  `,
    { eval: true },
  );
  const response = once(worker, "message");
  worker.postMessage(
    "[](zotero://open/groups/42/items/ABCD2345?annotation=EFGH6789)",
  );
  expect(await response).toEqual([
    {
      citations: [],
      citekeys: [],
      wikilinks: [],
      malformedWikilinks: [],
      malformedAnnotationCitations: [],
      annotations: [
        {
          form: "citation",
          indexedKey: "EFGH6789g42",
          attachmentKey: "ABCD2345",
          pageLabel: null,
          position: {
            start: { line: 0, col: 0, offset: 0 },
            end: { line: 0, col: 62, offset: 62 },
          },
        },
      ],
    },
  ]);
});
