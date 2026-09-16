// Minimal Firefox RDP client for evaluating JS in Zotero's parent (chrome)
// process over the remote debugging port the dev server already enables.
//
// Usage:
//   node scripts/debug/rdp-eval.ts <port> "<expression>"
//
// The expression runs in the browser/parent process console scope, so
// `Zotero`, `Services`, etc. are in scope. Return a JSON-serializable value
// (wrap multi-statement logic in an IIFE) to read it back here.

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { pathToFileURL } from "node:url";

const BYTE_COLON = 0x3a;

export interface Packet {
  from?: string;
  type?: string;
  [key: string]: unknown;
}

class Rdp {
  readonly #socket: Socket;
  #buf = Buffer.alloc(0);
  #waiters: Array<(p: Packet) => boolean> = [];

  constructor(socket: Socket) {
    this.#socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.#buf = Buffer.concat([this.#buf, chunk]);
      this.#drain();
    });
  }

  #drain(): void {
    while (true) {
      const sep = this.#buf.indexOf(BYTE_COLON);
      if (sep < 1) return;
      const len = Number(this.#buf.subarray(0, sep).toString("ascii"));
      if (!Number.isInteger(len)) return;
      const start = sep + 1;
      if (this.#buf.length < start + len) return;
      const body = this.#buf.subarray(start, start + len).toString("utf8");
      this.#buf = this.#buf.subarray(start + len);
      const packet = JSON.parse(body) as Packet;
      this.#waiters = this.#waiters.filter((w) => !w(packet));
    }
  }

  send(req: Record<string, unknown>): void {
    const json = JSON.stringify(req);
    this.#socket.write(`${Buffer.byteLength(json)}:${json}`);
  }

  /** Resolve with the next packet matching `match`. */
  next(match: (p: Packet) => boolean): Promise<Packet> {
    return new Promise((resolve) => {
      this.#waiters.push((p) => {
        if (!match(p)) return false;
        resolve(p);
        return true;
      });
    });
  }

  async request(
    req: { to: string; type: string } & Record<string, unknown>,
  ): Promise<Packet> {
    const reply = this.next((p) => p.from === req.to);
    this.send(req);
    return reply;
  }

  close(): void {
    this.#socket.destroy();
  }
}

/** How long a listener gets to prove it speaks RDP before we give up on it. */
const GREETING_TIMEOUT_MS = 5000;

function connect(port: number, host = "127.0.0.1"): Promise<Rdp> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host });
    const rdp = new Rdp(socket);
    // Something else may be listening on a port a previous Zotero used. It
    // will never send the root greeting, so without this the connect hangs
    // instead of failing, and a caller probing for a live Zotero never gets
    // its answer.
    const timer = setTimeout(() => {
      rdp.close();
      reject(new Error(`no RDP greeting from ${host}:${port}`));
    }, GREETING_TIMEOUT_MS);
    const settle = (outcome: () => void): void => {
      clearTimeout(timer);
      outcome();
    };
    socket.once("error", (error: Error) => {
      settle(() => reject(error));
    });
    // Root actor greets us first.
    rdp
      .next((p) => p.from === "root")
      .then(
        () => settle(() => resolve(rdp)),
        (error: unknown) => settle(() => reject(error)),
      );
  });
}

async function getParentConsoleActor(rdp: Rdp): Promise<string> {
  const proc = await rdp.request({ to: "root", type: "getProcess", id: 0 });
  const descriptor = (proc.processDescriptor ?? proc.form) as { actor: string };
  const target = await rdp.request({ to: descriptor.actor, type: "getTarget" });
  const form = (target.process ?? target.frame ?? target.form) as {
    consoleActor: string;
  };
  if (!form?.consoleActor) {
    throw new Error(
      `No consoleActor in getTarget reply: ${JSON.stringify(target)}`,
    );
  }
  return form.consoleActor;
}

function evalJS(rdp: Rdp, consoleActor: string, text: string): Promise<Packet> {
  // evaluateJSAsync replies with { resultID }, then emits a separate
  // evaluationResult packet carrying the actual value.
  const resultEvent = rdp.next(
    (p) => p.from === consoleActor && p.type === "evaluationResult",
  );
  rdp.send({ to: consoleActor, type: "evaluateJSAsync", text });
  return resultEvent;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export type Evaluate = (text: string) => Promise<Packet>;

interface AsyncEvalOptions {
  pause?: (ms: number) => Promise<void>;
  pollAttempts?: number;
  pollMs?: number;
  resultTtlMs?: number;
}

/**
 * Evaluate an `async` expression. The webconsole actor here won't transform
 * top-level `await`, so the body is run inside an async function that stashes
 * its JSON result on a global; we then poll that global synchronously.
 */
export async function evalAsync(
  evaluate: Evaluate,
  body: string,
  options: AsyncEvalOptions = {},
): Promise<Packet> {
  const pause = options.pause ?? sleep;
  const pollAttempts = options.pollAttempts ?? 100;
  const pollMs = options.pollMs ?? 100;
  const resultTtlMs = options.resultTtlMs ?? 60_000;
  const resultKey = `__zlEvalResult_${randomUUID()}`;
  const resultRef = `globalThis[${JSON.stringify(resultKey)}]`;
  const started = await evaluate(
    `${resultRef} = undefined;
     (async () => {
       try { ${resultRef} = JSON.stringify(await (async () => (${body}))()); }
       catch (e) { ${resultRef} = "ERR:" + (e && e.stack || e); }
       finally { setTimeout(() => { delete ${resultRef}; }, ${resultTtlMs}); }
     })();
     "started"`,
  );
  if (started.exception || started.exceptionMessage) return started;

  try {
    for (let i = 0; i < pollAttempts; i++) {
      await pause(pollMs);
      const res = await evaluate(resultRef);
      const value = res.result as unknown;
      if (typeof value === "string") return { ...res, result: value };
    }
    throw new Error("async eval timed out");
  } finally {
    await evaluate(`delete ${resultRef}`).catch(() => undefined);
  }
}

/**
 * One connection to a running Zotero's parent process, already attached to its
 * console actor. Disposing it closes the socket.
 */
export interface RdpSession extends Disposable {
  /** Evaluate a synchronous expression and return the reply packet. */
  evaluate: Evaluate;
  /** Evaluate an `async` expression through {@link evalAsync}. */
  evaluateAsync(body: string): Promise<Packet>;
}

/**
 * Attach to the debugging port a Paired Run's Zotero listens on. Rejects when
 * nothing answers there, so a caller probing for a live Zotero treats the
 * rejection as "no Zotero", not as a failure of its own.
 */
export async function openRdpSession(
  port: number,
  host = "127.0.0.1",
): Promise<RdpSession> {
  const rdp = await connect(port, host);
  try {
    const consoleActor = await getParentConsoleActor(rdp);
    const evaluate: Evaluate = (text) => evalJS(rdp, consoleActor, text);
    return {
      evaluate,
      evaluateAsync: (body) => evalAsync(evaluate, body),
      [Symbol.dispose]() {
        rdp.close();
      },
    };
  } catch (error) {
    rdp.close();
    throw error;
  }
}

async function main(): Promise<void> {
  const [, , portArg, expr] = process.argv;
  const port = Number(portArg);
  if (!Number.isInteger(port) || !expr) {
    console.error(
      'Usage: node scripts/debug/rdp-eval.ts <port> "<expression>"',
    );
    process.exit(2);
  }

  const isAsync = expr.startsWith("await ");
  using session = await openRdpSession(port);
  const res = isAsync
    ? await session.evaluateAsync(expr.slice("await ".length))
    : await session.evaluate(expr);
  if (res.exception || res.exceptionMessage) {
    console.error(
      "EXCEPTION:",
      JSON.stringify(res.exceptionMessage ?? res.exception, null, 2),
    );
  }
  console.log(
    typeof res.result === "string"
      ? res.result
      : JSON.stringify(res.result, null, 2),
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
