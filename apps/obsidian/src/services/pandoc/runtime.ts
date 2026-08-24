// Vendored WASI bridge to the official Pandoc WASM binary, over an in-memory virtual filesystem.

import {
  ConsoleStdout,
  File as WasiFile,
  OpenFile,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";
import type { Inode } from "@bjorn3/browser_wasi_shim";

import { getLogger } from "@/lib/log";

const logger = getLogger("pandoc");

/** One record of Pandoc's structured log, as written to the `warnings` file. */
export interface PandocLogMessage {
  type: string;
  verbosity: string;
  pretty: string;
}

/** Files a conversion reads, keyed by the name Pandoc opens them under. */
export type VirtualFiles = Readonly<Record<string, string | Uint8Array>>;

/**
 * Pandoc's defaults object, passed through as JSON. Only the keys this bridge
 * itself acts on are named; the rest reach Pandoc unread.
 *
 * @see https://pandoc.org/MANUAL.html#defaults-files
 */
export interface PandocOptions {
  /** Virtual file the conversion writes its output to, instead of stdout. */
  "output-file"?: string;
  [option: string]: unknown;
}

export interface PandocConvertResult {
  stdout: string;
  /** Carries the failure reason; empty when the conversion succeeded. */
  stderr: string;
  messages: PandocLogMessage[];
  /** Bytes of `options["output-file"]`, absent when the conversion wrote none. */
  outputFile?: Uint8Array;
}

/**
 * One instantiated Pandoc WASM module.
 *
 * The virtual filesystem is instance-wide mutable state that every conversion
 * resets, so `convert` runs to completion synchronously and callers must keep
 * it non-re-entrant.
 */
export interface PandocRuntime {
  convert(
    options: PandocOptions,
    stdin: string | null,
    files: VirtualFiles,
  ): PandocConvertResult;
}

/**
 * The reactor-module exports the binary offers. `convert` and `query` take a
 * JSON defaults object; every other export belongs to the Haskell runtime.
 *
 * @see https://github.com/jgm/pandoc/blob/3.10/wasm/pandoc.js
 */
interface PandocExports {
  memory: WebAssembly.Memory;
  __wasm_call_ctors: () => void;
  malloc: (size: number) => number;
  hs_init_with_rtsopts: (argcPtr: number, argvPtr: number) => void;
  convert: (optionsPtr: number, optionsLength: number) => void;
}

/** Reserve a 64 MiB nursery so citation processing does not thrash the GC. */
const RTS_ARGS = ["pandoc.wasm", "+RTS", "-H64m", "-RTS"];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Instantiate the Pandoc binary against a fresh in-memory filesystem.
 *
 * Adapted from the official `pandoc-wasm` bridge, narrowed to the conversion
 * path: virtual files arrive as bytes rather than Blobs, which keeps `convert`
 * synchronous, and media extraction is left out.
 *
 * @param wasmBinary the verified `pandoc.wasm` binary, streamed rather than
 *   materialized.
 * @see https://github.com/pandoc/pandoc-wasm/blob/v1.1.0/src/core.js
 */
export async function createPandocRuntime(
  wasmBinary: Blob,
): Promise<PandocRuntime> {
  const fileSystem = new Map<string, Inode>();
  const wasi = new WASI(
    RTS_ARGS,
    [],
    [
      new OpenFile(new WasiFile(new Uint8Array(), { readonly: true })),
      ConsoleStdout.lineBuffered((line) =>
        logger.debug("Pandoc stdout", { line }),
      ),
      ConsoleStdout.lineBuffered((line) =>
        logger.debug("Pandoc stderr", { line }),
      ),
      new PreopenDirectory("/", fileSystem),
    ],
    { debug: false },
  );

  // instantiateStreaming requires an `application/wasm` Content-Type; an OPFS
  // File's own `type` is empty, so the header is set explicitly rather than
  // left to the Blob.
  const response = new Response(wasmBinary, {
    headers: { "Content-Type": "application/wasm" },
  });
  const { instance } = await WebAssembly.instantiateStreaming(response, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  const exports = instance.exports as unknown as PandocExports;
  wasi.initialize({ exports });
  exports.__wasm_call_ctors();
  initHaskellRuntime(exports);

  return {
    convert(options, stdin, files) {
      const optionsBytes = encoder.encode(JSON.stringify(options));
      const optionsPtr = writeBytes(exports, optionsBytes);

      const stdout = new WasiFile(new Uint8Array());
      const stderr = new WasiFile(new Uint8Array());
      const warnings = new WasiFile(new Uint8Array());
      fileSystem.clear();
      fileSystem.set(
        "stdin",
        new WasiFile(encoder.encode(stdin ?? ""), { readonly: true }),
      );
      fileSystem.set("stdout", stdout);
      fileSystem.set("stderr", stderr);
      fileSystem.set("warnings", warnings);
      for (const [name, data] of Object.entries(files)) {
        const bytes = typeof data === "string" ? encoder.encode(data) : data;
        fileSystem.set(name, new WasiFile(bytes, { readonly: true }));
      }
      const outputName = options["output-file"];
      if (outputName !== undefined) {
        fileSystem.set(outputName, new WasiFile(new Uint8Array()));
      }

      exports.convert(optionsPtr, optionsBytes.length);

      const output =
        outputName === undefined ? undefined : fileSystem.get(outputName);
      return {
        stdout: decoder.decode(stdout.data),
        stderr: decoder.decode(stderr.data),
        messages: parseMessages(decoder.decode(warnings.data)),
        outputFile:
          output instanceof WasiFile && output.data.length > 0
            ? output.data
            : undefined,
      };
    },
  };
}

/**
 * Hand the RTS its `argc`/`argv` pair so `+RTS` options apply. Every allocation
 * happens before the view is taken, because `malloc` can grow the memory and
 * detach an earlier one.
 */
function initHaskellRuntime(exports: PandocExports): void {
  const argPtrs = RTS_ARGS.map((arg) => writeCString(exports, arg));
  const argv = exports.malloc(4 * (RTS_ARGS.length + 1));
  const argcPtr = exports.malloc(4);
  const argvPtr = exports.malloc(4);

  const view = new DataView(exports.memory.buffer);
  argPtrs.forEach((ptr, index) => view.setUint32(argv + 4 * index, ptr, true));
  view.setUint32(argv + 4 * RTS_ARGS.length, 0, true);
  view.setUint32(argcPtr, RTS_ARGS.length, true);
  view.setUint32(argvPtr, argv, true);

  exports.hs_init_with_rtsopts(argcPtr, argvPtr);
}

function writeBytes(exports: PandocExports, bytes: Uint8Array): number {
  const ptr = exports.malloc(bytes.length);
  new Uint8Array(exports.memory.buffer).set(bytes, ptr);
  return ptr;
}

function writeCString(exports: PandocExports, text: string): number {
  const bytes = encoder.encode(text);
  const ptr = exports.malloc(bytes.length + 1);
  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(bytes, ptr);
  memory[ptr + bytes.length] = 0;
  return ptr;
}

function parseMessages(raw: string): PandocLogMessage[] {
  if (raw === "") return [];
  try {
    return JSON.parse(raw) as PandocLogMessage[];
  } catch (error) {
    logger.warn("Pandoc wrote an unreadable log", { raw, error });
    return [];
  }
}
