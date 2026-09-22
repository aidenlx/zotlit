// Minimal Obsidian CLI client for the e2e suite. Mirrors the `=> `-prefixed
// output convention and bounded polling documented for `obEval` in
// packages/scripts/scripts/obsidian-vault.ts, whose own header carries the
// routing and transport background. The call itself comes from
// `@zotlit/scripts/obsidian-cli`, the same bounded client the scripts use, so
// one unanswered call cannot strand a run.

import { setTimeout as delay } from "node:timers/promises";

import { createObsidianCall } from "@zotlit/scripts/obsidian-cli";

const CLI_TIMEOUT_MS = 15_000;

const boundedCall = createObsidianCall({ timeoutMs: CLI_TIMEOUT_MS });

/**
 * The Obsidian CLI always exits 0 — failures come back only as output text.
 *
 * A single `eval` can hang while its window keeps answering every other call,
 * and the CLI process then outlives SIGTERM. Unbounded, that stalled one test
 * per run until Vitest's own timeout, on a different test each run. The
 * bounded call turns it into a named failure in {@link CLI_TIMEOUT_MS}.
 *
 * `timeoutMs` raises that deadline for one call; the bound itself stays, so a
 * longer measurement is still answered or reported unreachable.
 */
export function cli(args: string[], timeoutMs?: number): Promise<string> {
  const call =
    timeoutMs === undefined ? boundedCall : createObsidianCall({ timeoutMs });
  return call(args);
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
 * token. The process timeout bounds a missing reply; callers use
 * {@link waitFor} when they need to poll application state.
 *
 * `timeoutMs` is for a call that is one measurement rather than one question —
 * a batch the app answers when it has done the work — where the default
 * deadline would report a loaded machine as a failed measurement.
 */
export async function obEval(
  vaultId: string,
  code: string,
  timeoutMs?: number,
): Promise<string> {
  const text = await cli(
    [`vault=${vaultId}`, "eval", `code=${code}`],
    timeoutMs,
  );
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
 *
 * An unanswered call counts as "not ready yet" too. The stall is per call,
 * not per window: a traced run showed one `navigateToSearchResult` never
 * answer while the identical call on the same vault answered in 12 ms right
 * afterwards. So the deadline ends the call, and the next try goes on.
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
