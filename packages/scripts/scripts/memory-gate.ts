#!/usr/bin/env node

// Runs a command once the Memory Gate admits it:
//
//   node packages/scripts/scripts/memory-gate.ts -- <command> [args...]
//
// Root `pnpm test` runs `turbo run test` through it, so the whole run passes
// the gate once and each package's Vitest skips it. ZOTLIT_MEMORY_GATE=off
// skips the gate. The exit code is the command's, or 128 plus the signal
// number when a signal ends the command.

import { spawn } from "node:child_process";
import { constants } from "node:os";

import {
  MEMORY_GATE_ADMITTED_ENV,
  passMemoryGateOrExit,
} from "@zotlit/config/memory-gate";

const argv = process.argv.slice(2);
const [command, ...args] = argv[0] === "--" ? argv.slice(1) : argv;
if (!command) {
  console.error("Usage: memory-gate.ts -- <command> [args...]");
  process.exit(2);
}

const admitted = await passMemoryGateOrExit();
const options = {
  stdio: "inherit",
  env: admitted
    ? { ...process.env, [MEMORY_GATE_ADMITTED_ENV]: "1" }
    : process.env,
} as const;
// Windows resolves `turbo` and `pnpm` through their .cmd shims, so it needs a
// shell, and a shell takes one command line (DEP0190).
const child =
  process.platform === "win32"
    ? spawn([command, ...args].join(" "), { ...options, shell: true })
    : spawn(command, args, options);
// The terminal signals the whole foreground group; a supervisor such as
// turbo signals only this process, so pass its signal on.
for (const signal of ["SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
process.on("SIGINT", () => {});
child.on("error", (error) => {
  console.error(error.message);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0));
});
