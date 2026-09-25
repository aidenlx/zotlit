#!/usr/bin/env node

// Evaluate JavaScript in a running Zotero's parent (chrome) process over the
// Firefox Remote Debugging Protocol; see `--help`.

import type { Packet } from "#zotero-rdp";
import { relative } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { getFixtureLayout, getFixtureRoot } from "#fixture/layout";
import { livePairedZotero, pairedRunStatePath } from "#fixture/run-state";
import { getWorkspaceRoot } from "#package-roots";
import {
  ASYNC_EVAL_TIMEOUT_MS,
  openRdpSession,
  RDP_CALL_TIMEOUT_MS,
} from "#zotero-rdp";

const PORT_ENV = "ZOTERO_RDP_PORT";
const ASYNC_PREFIX = "await ";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const fixtureLayout = getFixtureLayout(getFixtureRoot(workspaceRoot));

const reference = `Port: --port, else $${PORT_ENV}, else the debugger port this worktree's live
Paired Run reports in ${relative(workspaceRoot, pairedRunStatePath(fixtureLayout))}.
Start a Paired Run with 'pnpm fixture dev'; see docs/fixture.md.

Scope: the parent process's console scope — Zotero, Services, and the
plugin are globals. Reader iframes are reached through Zotero.Reader and
_iframeWindow.

Sync: the expression's value prints. Return JSON-serializable data; a DOM
node or class instance comes back as a grip preview.

Async: start the expression with '${ASYNC_PREFIX}'. It runs inside an async
function and its JSON-stringified value prints; multi-step work goes in an
IIFE: '${ASYNC_PREFIX}(async () => { ...; return result; })()'. An async
expression must produce a value, and has ${ASYNC_EVAL_TIMEOUT_MS / 1_000} seconds to settle.

Exit code 1: the expression threw (the error prints on stderr), Zotero sent
no reply within --timeout, or no Zotero answered on the port.`;

/** What the evaluated expression threw, or `undefined` when it did not. */
function thrownMessage(packet: Packet): string | undefined {
  if (packet.exception || packet.exceptionMessage) {
    return JSON.stringify(packet.exceptionMessage ?? packet.exception, null, 2);
  }
  // evalAsync reports a rejection as its result, prefixed "ERR:".
  if (typeof packet.result === "string" && packet.result.startsWith("ERR:")) {
    return packet.result.slice("ERR:".length);
  }
  return undefined;
}

async function resolvePort(port: number | undefined): Promise<number> {
  if (port !== undefined) return port;
  const override = Number(process.env[PORT_ENV]);
  if (process.env[PORT_ENV] && Number.isInteger(override)) return override;
  const reported = await livePairedZotero(fixtureLayout);
  if (reported?.debuggerPort === undefined) {
    throw new Error(
      `No live Paired Run with a debugger port under ${fixtureLayout.root}. Start one with 'pnpm fixture dev', or pass --port.`,
    );
  }
  return reported.debuggerPort;
}

await yargs(hideBin(process.argv))
  .scriptName("zotero-rdp.ts")
  .command(
    "$0 <expression>",
    "evaluate JavaScript in Zotero's parent process",
    (y) =>
      y
        .positional("expression", {
          describe: `JavaScript; prefix '${ASYNC_PREFIX}' for an async expression`,
          type: "string",
          demandOption: true,
        })
        .option("port", {
          describe: "Zotero's remote debugging port",
          type: "number",
        })
        .option("timeout", {
          describe: "seconds to wait for each reply",
          type: "number",
          default: RDP_CALL_TIMEOUT_MS / 1_000,
        }),
    async (argv) => {
      using session = await openRdpSession(await resolvePort(argv.port), {
        timeoutMs: argv.timeout * 1_000,
      });
      const { expression } = argv;
      const packet = expression.startsWith(ASYNC_PREFIX)
        ? await session.evaluateAsync(expression.slice(ASYNC_PREFIX.length))
        : await session.evaluate(expression);
      const thrown = thrownMessage(packet);
      if (thrown !== undefined) throw new Error(thrown);
      console.log(
        typeof packet.result === "string"
          ? packet.result
          : JSON.stringify(packet.result, null, 2),
      );
    },
  )
  .epilogue(reference)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `zotero-rdp: ${error instanceof Error ? error.message : message}`,
    );
    process.exit(1);
  })
  .parseAsync();
