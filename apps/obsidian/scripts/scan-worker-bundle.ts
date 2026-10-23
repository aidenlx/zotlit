// Loads the guarded production parse worker and its RPC client for Node tests.

import { resolve } from "node:path";
import type { MessagePort } from "node:worker_threads";
import { build } from "vite";

import { embeddedWorker } from "./embedded-worker.js";

export interface BenchmarkParseRequest {
  path: string;
  generation: number;
  text: string;
}

export interface BenchmarkParseClient<Reply> extends AsyncDisposable {
  parse(
    this: void,
    request: BenchmarkParseRequest,
    signal: AbortSignal,
  ): Promise<Reply>;
}

// Both imports of renderer code stay inside Vite: the Node script loads only
// the guarded bundle, with the same RPC codecs and scheduler as production.
const CLIENT_ENTRY = `
export { default } from "virtual:scan-worker";
import { Effect, Scope } from "@/lib/effect";
import { openScope } from "@/lib/effect-scope";
import { decodeParseReply } from "@/services/citation-parse/client";
import { makeParseWorkerClient } from "@/services/citation-parse/worker-client";
export async function connect(spawn, onEncode) {
  const { scope, close } = openScope();
  try {
    const measureEncoding = onEncode && (() => {
      const start = performance.now();
      return () => onEncode(performance.now() - start);
    });
    const client = await Effect.runPromise(makeParseWorkerClient(spawn, measureEncoding).pipe(Scope.provide(scope)));
    return {
      parse: (request, signal) => Effect.runPromise(Effect.suspend(() => client.Parse(request)).pipe(Effect.map(decodeParseReply)), { signal }),
      [Symbol.asyncDispose]: close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
`;

export async function scanWorkerBundle<Reply>(): Promise<{
  default: string;
  connect(
    spawn: () => Pick<
      MessagePort,
      "addEventListener" | "removeEventListener" | "postMessage"
    >,
    onEncode?: (milliseconds: number) => void,
  ): Promise<BenchmarkParseClient<Reply>>;
}> {
  const packageRoot = resolve(import.meta.dirname, "..");
  const resolveConfig = { alias: { "@": resolve(packageRoot, "src") } };
  const result = await build({
    configFile: false,
    logLevel: "silent",
    resolve: resolveConfig,
    plugins: [
      {
        name: "scan-benchmark-entry",
        resolveId: (id) => (id === "virtual:scan-benchmark" ? id : null),
        load: (id) => (id === "virtual:scan-benchmark" ? CLIENT_ENTRY : null),
      },
      embeddedWorker({
        id: "virtual:scan-worker",
        entry: resolve(packageRoot, "src/services/citation-parse/worker.ts"),
        config: {
          resolve: resolveConfig,
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
  return import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  );
}
