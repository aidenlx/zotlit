#!/usr/bin/env node

// The `obsidian-i18n` bin entry: invokes runCli against real process I/O.

import { runCli } from "./cli.js";

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

runCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${toError(error).message}\n`);
  process.exitCode = 1;
});
