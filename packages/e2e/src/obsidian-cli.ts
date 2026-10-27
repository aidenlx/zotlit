// Minimal Obsidian CLI client for the e2e suite. Mirrors the `=> `-prefixed
// output convention and bounded polling documented for `obEval` in
// packages/scripts/scripts/obsidian-vault.ts, whose own header carries the
// routing and transport background. The call itself comes from
// `@zotlit/scripts/obsidian-cli`, the same bounded client the scripts use, so
// one unanswered call cannot strand a run.

import { setTimeout as delay } from "node:timers/promises";

import { createObsidianCall } from "@zotlit/scripts/obsidian-cli";

import type { ObsidianContext, JsonCompatible } from "./page-context.ts";
import { createPageHelpers } from "./page-helpers.ts";

const CLI_TIMEOUT_MS = 15_000;

const boundedCall = createObsidianCall({ timeoutMs: CLI_TIMEOUT_MS });

/**
 * Obsidian reports failures only as output text.
 *
 * A call that gets no reply — a window that reloads mid-call, or one whose
 * renderer is gone — would otherwise stall a test until Vitest's own timeout.
 * The bounded call turns it into a named failure in {@link CLI_TIMEOUT_MS}.
 *
 * `timeoutMs` raises that deadline for one call; the bound itself stays, so a
 * longer measurement is still answered or reported unreachable.
 */
export function cli(args: string[], timeoutMs?: number): Promise<string> {
  const call =
    timeoutMs === undefined ? boundedCall : createObsidianCall({ timeoutMs });
  return call(args);
}

/** Starts the reply of wrapped code that threw; JSON follows on the same line. */
const THROWN = "__zotlitEvalError__";

/**
 * `code`, run as Obsidian's `eval` runs it — a global eval whose completion
 * value is awaited — but with a thrown error answered as a {@link THROWN}
 * reply that carries its `stack`. Obsidian itself prints only
 * `Error: <message>`, so an error raised inside Obsidian's code would read as
 * if the test's code raised it.
 */
export function wrapEvalCode(code: string): string {
  return `(async()=>{try{return await (0,eval)(${JSON.stringify(code)});}catch(error){return ${JSON.stringify(THROWN)}+JSON.stringify({message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined});}})()`;
}

/** The error a {@link THROWN} reply stands for: the message, then the app's frames. */
function thrownError(json: string): Error {
  const { message, stack } = JSON.parse(json) as {
    message: string;
    stack?: string;
  };
  const frames = stack
    ?.split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
  return new Error(frames ? `${message}\n${frames}` : message);
}

/**
 * Pull the `=> `-prefixed reply out of raw CLI output. Evaluated code that
 * logs to the console (the plugin does, on a reload) shares the same
 * response stream, so the reply is the *last* `=> `-prefixed line rather than
 * necessarily the first character of the output. A reply of code wrapped by
 * {@link wrapEvalCode} that threw becomes that error.
 */
export function parseEvalReply(text: string): string {
  const marker = "\n=> ";
  const lastIndex = text.lastIndexOf(marker);
  let reply: string;
  if (lastIndex !== -1) reply = text.slice(lastIndex + marker.length);
  else if (text.startsWith("=> ")) reply = text.slice(3);
  else throw new Error(`obsidian reply had no "=> " line: ${text}`);
  if (reply.startsWith(THROWN)) throw thrownError(reply.slice(THROWN.length));
  return reply;
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
    [`vault=${vaultId}`, "eval", `code=${wrapEvalCode(code)}`],
    timeoutMs,
  );
  if (text === "") return "";
  return parseEvalReply(text);
}

/** {@link obEval}, with its reply parsed as JSON. */
export async function obJson<T>(vaultId: string, code: string): Promise<T> {
  return JSON.parse(await obEval(vaultId, code)) as T;
}

/**
 * The document of every window of the vault, the main window first, as an
 * eval expression: a notice goes to the window Obsidian counts as active.
 */
export const WINDOW_DOCUMENTS =
  "(()=>{const docs=new Set([document]);app.workspace.iterateAllLeaves((leaf)=>docs.add(leaf.view.containerEl.doc));return [...docs];})()";

/**
 * Takes every notice off screen in every window, so the next one is the
 * caller's own.
 */
export async function clearNotices(vaultId: string): Promise<void> {
  await obEval(
    vaultId,
    `(function(){for(const doc of ${WINDOW_DOCUMENTS})for(const node of doc.querySelectorAll('.notice'))node.remove();return true;})()`,
  );
}

/**
 * Dispatch a registered CLI command (not `eval`). Unlike `eval`'s JS return
 * value, a plugin's `registerCliHandler` reply prints as its own text with no
 * `=> ` prefix, so this returns it as-is — the caller's own parsing (e.g.
 * `JSON.parse`) is what tells a reply from an error sentence.
 *
 * Each entry of `options.args` goes after the command as one `name=value`
 * token.
 */
export async function cliCommand(
  vaultId: string,
  command: string,
  options: {
    args?: Readonly<Record<string, string>>;
    /** @default the bounded call of {@link cli} */
    timeoutMs?: number;
  } = {},
): Promise<string> {
  return cli(
    [
      `vault=${vaultId}`,
      command,
      ...Object.entries(options.args ?? {}).map(
        ([name, value]) => `${name}=${value}`,
      ),
    ],
    options.timeoutMs,
  );
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
 * Poll `read` until `ready` accepts its answer, and return that answer. A
 * `null` answer is "not drawn yet" and never passes. Throws naming `what` and
 * the last answer once `tries` run out.
 */
export async function readUntil<T>(
  read: () => Promise<T | null>,
  ready: (value: T) => boolean,
  { what, tries = 40 }: { what: string; tries?: number },
): Promise<T> {
  let value: T | null = null;
  const settled = await waitFor(async () => {
    value = await read();
    return value !== null && ready(value);
  }, tries);
  if (!settled) throw new Error(`${what}: ${JSON.stringify(value)}`);
  return value!;
}

/** {@link readUntil} over the JSON that `code` answers in the vault's window. */
export function obReadUntil<T>(
  vaultId: string,
  code: string,
  {
    ready,
    ...options
  }: { ready: (value: T) => boolean; what: string; tries?: number },
): Promise<T> {
  return readUntil(
    async () => JSON.parse(await obEval(vaultId, code)) as T | null,
    ready,
    options,
  );
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

/**
 * The JSON callback boundary; all imports used by its code must be type-only.
 * Service reads follow the current plugin when a callback restarts it.
 */
// oxlint-disable-next-line max-params -- The approved callback API keeps options fourth (#1848).
export async function obRun<A = undefined, R = void>(
  vaultId: string,
  callback: (
    context: ObsidianContext,
    args: A,
  ) => (R & JsonCompatible<R>) | Promise<R & JsonCompatible<R>>,
  args?: A & JsonCompatible<A>,
  options: { timeoutMs?: number } = {},
): Promise<Awaited<R>> {
  const code = `(async()=>{const page=globalThis.__zotlitPageHelpers;if(!page)return '__zotlitHelpersMissing__';const result=await (${callback.toString()})({app,zotlit:{get services(){return app.plugins.plugins.zotlit.services;}},page},${JSON.stringify(args) ?? "undefined"});return JSON.stringify({value:result});})()`;
  let reply = await obEval(vaultId, code, options.timeoutMs);
  if (reply === "__zotlitHelpersMissing__") {
    await obEval(
      vaultId,
      `globalThis.__zotlitPageHelpers=(${createPageHelpers.toString()})(app);true`,
      options.timeoutMs,
    );
    reply = await obEval(vaultId, code, options.timeoutMs);
  }
  return (JSON.parse(reply) as { value: Awaited<R> }).value;
}

/** Poll a typed page callback; reloads and missing replies count as not ready. */
// oxlint-disable-next-line max-params -- The approved callback API keeps options fourth (#1848).
export async function obRunUntil<A = undefined, R = boolean>(
  vaultId: string,
  callback: (
    context: ObsidianContext,
    args: A,
  ) => (R & JsonCompatible<R>) | Promise<R & JsonCompatible<R>>,
  args: (A & JsonCompatible<A>) | undefined,
  {
    ready = (value) => value === true,
    what,
    tries = 40,
  }: { ready?: (value: Awaited<R>) => boolean; what: string; tries?: number },
): Promise<Awaited<R>> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      // oxlint-disable-next-line zotlit-tests/no-eval-capture -- Forward the caller-checked callback through the transport.
      const value = await obRun(vaultId, callback, args);
      last = value;
      if (ready(value)) return value;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}
