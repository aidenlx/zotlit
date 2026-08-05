// The `obsidian-i18n compile` command: one compile per invocation. Rebuilding
// on input changes belongs to the Vite plugin in `./vite.ts`, which registers
// the compile result's `watchPaths` with the bundler's own watcher.

import { compile, type CompileOptions } from "./compiler.js";

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
  await runCompile(options, io);
}

function parseArguments(argv: readonly string[], cwd: string): CompileOptions {
  const args = [...argv];
  if (args.shift() !== "compile") {
    throw new Error(
      "Usage: obsidian-i18n compile [--project PATH] [--output PATH] [--exclude-prefix PREFIX] [--target-locale-prefix PREFIX]",
    );
  }
  const options: CompileOptions = {
    root: cwd,
    excludeMessagePrefixes: [],
    targetLocaleMessagePrefixes: [],
  };
  while (args.length > 0) {
    const option = args.shift()!;
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

async function runCompile(options: CompileOptions, io: CliIo): Promise<void> {
  const result = await compile(options);
  io.stdout.write(`Generated ${result.messageCount} Message wrappers\n`);
  if (result.warnings.length > 0) {
    io.stderr.write(`${result.warnings.join("\n")}\n`);
  }
}
