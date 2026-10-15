#!/usr/bin/env node

// Holds the desktop lock around a command, for a manual session on the desktop
// Obsidian and Paired Zotero:
//
//   pnpm desktop-lock -- <command> [args...]
//
// A ZotLit tool that the command starts reuses the lock. The exit code is the
// command's, or 128 plus the signal number when a signal ends the command.

import { spawn } from "node:child_process";
import { constants } from "node:os";

import { acquireDesktopLock } from "#desktop-lock";

const command = process.argv.slice(2);
if (command[0] === "--") command.shift();
if (command.length === 0) {
  console.error("Usage: pnpm desktop-lock -- <command> [args...]");
  process.exit(2);
}

// The command handles the signals; the lock is released after it exits.
const lock = await acquireDesktopLock({
  command: command.join(" "),
  signals: false,
});
const child = spawn(command[0]!, command.slice(1), { stdio: "inherit" });
// The terminal sends SIGINT to the command too, so only forward the others.
process.on("SIGINT", () => {});
for (const signal of ["SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  lock.release();
  process.exit(127);
});
child.on("exit", (code, signal) => {
  lock.release();
  process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0));
});
