// Loads the guarded production parse worker bundle for tests and benchmarks.
import { resolve } from "node:path";
import { build } from "vite";

import { embeddedWorker } from "./embedded-worker.js";

export async function scanWorkerBundle(): Promise<string> {
  const packageRoot = resolve(import.meta.dirname, "..");
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "scan-benchmark-entry",
        resolveId: (id) => (id === "virtual:scan-benchmark" ? id : null),
        load: (id) =>
          id === "virtual:scan-benchmark"
            ? 'export { default } from "virtual:scan-worker";'
            : null,
      },
      embeddedWorker({
        id: "virtual:scan-worker",
        entry: resolve(packageRoot, "src/services/citation-parse/worker.ts"),
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
      lib: { entry: "virtual:scan-benchmark", formats: ["es"] },
      rolldownOptions: { input: "virtual:scan-benchmark" },
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
  return bundled.default;
}
