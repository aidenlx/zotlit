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

function connect(port: number, host = "127.0.0.1"): Promise<Rdp> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host });
    const rdp = new Rdp(socket);
    socket.once("error", reject);
    // Root actor greets us first.
    rdp.next((p) => p.from === "root").then(() => resolve(rdp), reject);
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

type Evaluate = (text: string) => Promise<Packet>;

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
  const rdp = await connect(port);
  try {
    const consoleActor = await getParentConsoleActor(rdp);
    const res = isAsync
      ? await evalAsync(
          (text) => evalJS(rdp, consoleActor, text),
          expr.slice("await ".length),
        )
      : await evalJS(rdp, consoleActor, expr);
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
  } finally {
    rdp.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
