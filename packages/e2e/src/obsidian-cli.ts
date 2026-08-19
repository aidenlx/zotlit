// Minimal Obsidian CLI client for the e2e suite. Mirrors the `=> `-prefixed
// output convention and the "no timeout — bounded polling is the caller's
// job" caveat documented for `obEval` in
// packages/scripts/scripts/obsidian-vault.ts. Not importing that script
// directly: it has no public exports, it's a script, not a library — see
// docs/obsidian-cli-vault-routing.md for the routing/transport background.

import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The Obsidian CLI always exits 0 — failures come back only as output text. */
export async function cli(args: string[]): Promise<string> {
  const result = await execFileAsync("obsidian", args, { windowsHide: true });
  return `${result.stdout}${result.stderr}`.trim();
}

/**
 * Pull the `=> `-prefixed reply out of raw CLI output. Evaluated code that
 * logs to the console (the plugin does, on a reload) shares the same
 * response stream, so the reply is the *last* `=> `-prefixed line rather than
 * necessarily the first character of the output.
 */
function parseReply(text: string): string {
  const marker = "\n=> ";
  const lastIndex = text.lastIndexOf(marker);
  if (lastIndex !== -1) return text.slice(lastIndex + marker.length);
  if (text.startsWith("=> ")) return text.slice(3);
  throw new Error(`obsidian reply had no "=> " line: ${text}`);
}

/**
 * Run JavaScript in `vaultId`'s window. `vault=<id>` must be the first argv
 * token — see docs/obsidian-cli-vault-routing.md. No timeout on the reply, so
 * every caller bounds its own wait with {@link waitFor}.
 */
export async function obEval(vaultId: string, code: string): Promise<string> {
  const text = await cli([`vault=${vaultId}`, "eval", `code=${code}`]);
  if (text === "") return "";
  return parseReply(text);
}

/**
 * Dispatch a registered CLI command (not `eval`). Unlike `eval`'s JS return
 * value, a plugin's `registerCliHandler` reply prints as its own text with no
 * `=> ` prefix, so this returns it as-is — the caller's own parsing (e.g.
 * `JSON.parse`) is what tells a reply from an error sentence.
 */
export async function cliCommand(
  vaultId: string,
  command: string,
): Promise<string> {
  return cli([`vault=${vaultId}`, command]);
}

/** Bounded polling — mirrors `waitFor` in obsidian-vault.ts. */
export async function waitFor(
  check: () => Promise<boolean>,
  tries = 40,
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (await check()) return true;
    await delay(250);
  }
  return false;
}

/**
 * `obEval`, retried until its reply equals `expected`. A window that just
 * opened or reloaded can answer a stray console line ahead of its `=> `
 * reply (or none at all, mid-reload) before its command registry settles —
 * mirrors the `.catch(() => "")` around the "loaded" check in
 * obsidian-vault.ts's own `create()` — so a failed parse here means "not
 * ready yet", not "give up".
 */
export async function obEvalUntil(
  vaultId: string,
  code: string,
  options: { expected: string; tries?: number },
): Promise<boolean> {
  return waitFor(async () => {
    const answer = await obEval(vaultId, code).catch(() => "");
    return answer === options.expected;
  }, options.tries);
}
