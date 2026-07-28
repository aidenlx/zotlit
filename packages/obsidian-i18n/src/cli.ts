// The `obsidian-i18n compile` command, including its watch loop over project inputs.

import { watch } from "node:fs";

import {
  compile,
  type CompileOptions,
  type CompileResult,
} from "./compiler.js";

export type CliIo = {
  cwd: string;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
};

export async function runCli(
  argv: readonly string[],
  io: CliIo = {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<void> {
  const options = parseArguments(argv, io.cwd);
  if (!options.watch) {
    await runCompile(options, io);
    return;
  }

  using watchSession = new DisposableStack();
  let watchers = new DisposableStack();
  watchSession.defer(() => watchers.dispose());
  let compiling = false;
  let pending = false;
  const compileAndWatch = async (): Promise<void> => {
    if (compiling) {
      pending = true;
      return;
    }
    compiling = true;
    try {
      const result = await runCompile(options, io);
      watchers.dispose();
      watchers = watchInputs(result, () => {
        void compileAndWatch().catch((error: unknown) => {
          io.stderr.write(`${toError(error).message}\n`);
        });
      });
    } finally {
      compiling = false;
      if (pending) {
        pending = false;
        await compileAndWatch();
      }
    }
  };
  await compileAndWatch();
  await new Promise<void>((resolveDone) => {
    const close = (): void => resolveDone();
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    watchSession.defer(() => {
      process.off("SIGINT", close);
      process.off("SIGTERM", close);
    });
  });
}

type ParsedOptions = CompileOptions & { watch: boolean };

function parseArguments(argv: readonly string[], cwd: string): ParsedOptions {
  const args = [...argv];
  if (args.shift() !== "compile") {
    throw new Error(
      "Usage: obsidian-i18n compile [--project PATH] [--output PATH] [--exclude-prefix PREFIX] [--target-locale-prefix PREFIX] [--watch]",
    );
  }
  const options: ParsedOptions = {
    root: cwd,
    watch: false,
    excludeMessagePrefixes: [],
    targetLocaleMessagePrefixes: [],
  };
  while (args.length > 0) {
    const option = args.shift()!;
    if (option === "--watch") {
      options.watch = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined) throw new Error(`${option} requires a value`);
    switch (option) {
      case "--project":
        options.project = value;
        break;
      case "--output":
        options.output = value;
        break;
      case "--exclude-prefix":
        options.excludeMessagePrefixes = [
          ...(options.excludeMessagePrefixes ?? []),
          value,
        ];
        break;
      case "--target-locale-prefix":
        options.targetLocaleMessagePrefixes = [
          ...(options.targetLocaleMessagePrefixes ?? []),
          value,
        ];
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
  }
  return options;
}

async function runCompile(
  options: ParsedOptions,
  io: CliIo,
): Promise<CompileResult> {
  const result = await compile(options);
  io.stdout.write(`Generated ${result.messageCount} Message wrappers\n`);
  if (result.warnings.length > 0) {
    io.stderr.write(`${result.warnings.join("\n")}\n`);
  }
  return result;
}

function watchInputs(
  result: CompileResult,
  onChange: () => void,
): DisposableStack {
  using watchers = new DisposableStack();
  const inputs = new Set(result.watchPaths);
  for (const path of inputs) {
    watchers.adopt(watch(path, { persistent: true }, onChange), (watcher) =>
      watcher.close(),
    );
  }
  return watchers.move();
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
