#!/usr/bin/env node

// The Obsidian CLI, in-house: the same arguments and output as the `obsidian`
// binary, sent over the same socket by `#obsidian-cli`. The binary can miss
// the end of a reply on macOS and wait until killed; this client cannot, and
// every call is bounded.

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  createObsidianCall,
  obsidianCliSocketPath,
  OBSIDIAN_CALL_TIMEOUT_MS,
} from "#obsidian-cli";

const reference = `Arguments pass through to Obsidian unchanged, exactly as for the \`obsidian\`
binary. Put options before the first argument; everything from the first
argument on belongs to Obsidian.

  obsidian-cli.ts vault=<id> eval code='<js>'
  obsidian-cli.ts vault=<id> plugin:reload id=zotlit
  obsidian-cli.ts help                      Obsidian's own command list

vault=<id> selects the window only as the first argument. Without it, the
window of the current folder's vault answers, else the focused window.

Output is Obsidian's reply. Obsidian reports command failures as text
("Error: …", "Vault not found."), and the exit code stays 0 for them.
Exit code 1 means no reply: Obsidian is not running (the socket
${obsidianCliSocketPath()} is missing or refuses the connection), or
the window gave no answer within --timeout. The interactive TTY mode of the
binary is not supported.`;

await yargs(hideBin(process.argv))
  .scriptName("obsidian-cli.ts")
  .usage("$0 [options] <obsidian arguments..>")
  .command(
    "$0 [args..]",
    "run one Obsidian CLI command over Obsidian's CLI socket",
    (y) =>
      y
        .positional("args", {
          describe: "the arguments you would give the `obsidian` binary",
          type: "string",
          array: true,
        })
        .option("timeout", {
          describe: "seconds to wait for the reply",
          type: "number",
          default: OBSIDIAN_CALL_TIMEOUT_MS / 1_000,
        }),
    async (argv) => {
      const args = [...(argv.args ?? []), ...argv._.map(String)];
      if (args.length === 0) throw new Error("Give at least one argument.");
      const call = createObsidianCall({ timeoutMs: argv.timeout * 1_000 });
      console.log(await call(args));
    },
  )
  .parserConfiguration({
    "halt-at-non-option": true,
    "unknown-options-as-args": true,
  })
  .epilogue(reference)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `obsidian-cli: ${error instanceof Error ? error.message : message}`,
    );
    process.exit(1);
  })
  .parseAsync();
