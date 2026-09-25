#!/usr/bin/env node

// Inspect a running Obsidian over the Chrome DevTools Protocol: list its
// windows, evaluate like the DevTools console, send any CDP command, or open
// full DevTools on one window or on the main process. Windows need Obsidian
// started with `--remote-debugging-port`; see `--help`.

import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import {
  DEFAULT_CDP_PORT,
  DEFAULT_MAIN_INSPECTOR_PORT,
  evaluate,
  formatWindow,
  launchCommand,
  listObsidianWindows,
  openCdpSession,
  openMainInspector,
  selectWindow,
} from "#obsidian-cdp";
import { OBSIDIAN_CALL_TIMEOUT_MS } from "#obsidian-cli";

const reference = `Obsidian answers CDP only when it starts with the debugging flag. Quit
Obsidian, then start it with:
  ${launchCommand(DEFAULT_CDP_PORT)}
The port listens on 127.0.0.1 only, but any local process can then drive
Obsidian. Start Obsidian normally again when you are done.

Window selection (eval, send, inspect):
  --vault <id>     the main window of that vault
  --target <id>    a window by CDP target-id prefix, from 'windows';
                   use it for popout and settings windows
  neither          the only main window, when exactly one vault is open

Main process (eval, send, inspect with --main):
  --main opens the main process's Node.js inspector on 127.0.0.1:--main-port
  (default ${DEFAULT_MAIN_INSPECTOR_PORT}), or reuses the one already open. It needs no
  debugging flag: a vault window opens it through the CLI socket (--vault
  selects that window, else the focused one). It stays open until Obsidian
  quits. The scope has no \`require\`; use process.mainModule.require("electron").
  Top-level variables of Obsidian's main.js are closure-scoped; reach them with
  the Debugger domain (inspect --main, then set breakpoints in main.js).

With the port open, agent-browser attaches to the same windows for
snapshots, clicks, screenshots, console, and network:
  agent-browser --cdp ${DEFAULT_CDP_PORT} tab`;

function withPort<T>(y: Argv<T>) {
  return y.option("port", {
    describe: "Obsidian's remote debugging port",
    type: "number",
    default: DEFAULT_CDP_PORT,
  });
}

function withWindow<T>(y: Argv<T>) {
  return withPort(y)
    .option("vault", {
      describe: "vault id of the main window",
      type: "string",
    })
    .option("main", {
      describe: "target the main process instead of a window",
      type: "boolean",
      default: false,
    })
    .option("main-port", {
      describe: "port for the main process's Node.js inspector",
      type: "number",
      default: DEFAULT_MAIN_INSPECTOR_PORT,
    })
    .option("target", {
      describe: "CDP target-id prefix of the window",
      type: "string",
    })
    .option("timeout", {
      describe: "seconds to wait for the answer",
      type: "number",
      default: OBSIDIAN_CALL_TIMEOUT_MS / 1_000,
    });
}

/** The window or main process that `argv` selects. */
async function resolveTarget(argv: {
  port: number;
  vault?: string;
  target?: string;
  main: boolean;
  "main-port": number;
}): Promise<{ webSocketDebuggerUrl: string; devtoolsUrl: string }> {
  if (argv.main) {
    return openMainInspector({ port: argv["main-port"], vault: argv.vault });
  }
  return selectWindow(await listObsidianWindows(argv.port), argv);
}

function print(value: unknown): void {
  if (value === undefined) console.log("undefined");
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

await yargs(hideBin(process.argv))
  .scriptName("obsidian-cdp.ts")
  .command(
    "windows",
    "list Obsidian's windows with their vault, kind, and target id",
    (y) => withPort(y),
    async (argv) => {
      for (const w of await listObsidianWindows(argv.port)) {
        console.log(formatWindow(w));
      }
    },
  )
  .command(
    "eval <expression>",
    "evaluate JavaScript like the DevTools console; top-level await works",
    (y) =>
      withWindow(y).positional("expression", {
        describe: "JavaScript; a returned promise is awaited",
        type: "string",
        demandOption: true,
      }),
    async (argv) => {
      const target = await resolveTarget(argv);
      using session = await openCdpSession(target.webSocketDebuggerUrl);
      const outcome = await evaluate(session, argv.expression, {
        timeoutMs: argv.timeout * 1_000,
      });
      if (!outcome.ok) throw new Error(outcome.error);
      print(outcome.value);
    },
  )
  .command(
    "send <method> [params]",
    "send one raw CDP command (any domain) and print its result",
    (y) =>
      withWindow(y)
        .positional("method", {
          describe:
            "CDP method, such as DOM.getDocument or Page.captureScreenshot",
          type: "string",
          demandOption: true,
        })
        .positional("params", {
          describe: "JSON object of parameters",
          type: "string",
          default: "{}",
        }),
    async (argv) => {
      const target = await resolveTarget(argv);
      using session = await openCdpSession(target.webSocketDebuggerUrl);
      print(
        await session.send(
          argv.method,
          JSON.parse(argv.params) as Record<string, unknown>,
          { timeoutMs: argv.timeout * 1_000 },
        ),
      );
    },
  )
  .command(
    "inspect",
    "print the full DevTools URL for a window or the main process; open it in Chrome",
    (y) => withWindow(y),
    async (argv) => {
      const target = await resolveTarget(argv);
      console.log(target.devtoolsUrl);
    },
  )
  .epilogue(reference)
  .demandCommand(1, 1)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `obsidian-cdp: ${error instanceof Error ? error.message : message}`,
    );
    process.exit(1);
  })
  .parseAsync();
