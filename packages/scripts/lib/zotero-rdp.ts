// Minimal Firefox Remote Debugging Protocol client for evaluating JS in
// Zotero's parent (chrome) process over the remote debugging port a Paired Run
// enables. The expression runs in that process's console scope, so `Zotero`,
// `Services`, etc. are in scope.
//
// Every wait on the socket is bounded: a Zotero that stops answering fails the
// call instead of holding its caller forever.

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { Socket } from "node:net";

const BYTE_COLON = 0x3a;

/** How long a listener gets to prove it speaks RDP before we give up on it. */
const GREETING_TIMEOUT_MS = 5000;

/** Default deadline for one request's reply. */
export const RDP_CALL_TIMEOUT_MS = 30_000;

const ASYNC_POLL_MS = 100;
const ASYNC_POLL_ATTEMPTS = 100;
/** How long {@link evalAsync} polls for an async result by default. */
export const ASYNC_EVAL_TIMEOUT_MS = ASYNC_POLL_MS * ASYNC_POLL_ATTEMPTS;

export interface Packet {
  from?: string;
  type?: string;
  [key: string]: unknown;
}

interface Waiter {
  match(p: Packet): boolean;
  resolve(p: Packet): void;
  reject(error: Error): void;
}

class Rdp {
  readonly #socket: Socket;
  #buf = Buffer.alloc(0);
  #waiters: Waiter[] = [];

  constructor(socket: Socket) {
    this.#socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.#buf = Buffer.concat([this.#buf, chunk]);
      this.#drain();
    });
    // A closed socket answers nothing more; fail what still waits at once.
    socket.on("close", () => {
      for (const waiter of this.#waiters) {
        waiter.reject(new Error("Zotero closed the RDP connection"));
      }
      this.#waiters = [];
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
      this.#waiters = this.#waiters.filter((w) => {
        if (!w.match(packet)) return true;
        w.resolve(packet);
        return false;
      });
    }
  }

  send(req: Record<string, unknown>): void {
    const json = JSON.stringify(req);
    this.#socket.write(`${Buffer.byteLength(json)}:${json}`);
  }

  /** Resolve with the next packet matching `match`, or reject at the deadline. */
  next(match: (p: Packet) => boolean, timeoutMs: number): Promise<Packet> {
    const { promise, resolve, reject } = Promise.withResolvers<Packet>();
    const waiter: Waiter = {
      match,
      resolve: (p) => {
        clearTimeout(timer);
        resolve(p);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    const timer = setTimeout(() => {
      this.#waiters = this.#waiters.filter((w) => w !== waiter);
      reject(new Error(`Zotero sent no reply within ${timeoutMs} ms`));
    }, timeoutMs);
    this.#waiters.push(waiter);
    return promise;
  }

  async request(
    req: { to: string; type: string } & Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Packet> {
    const reply = this.next((p) => p.from === req.to, timeoutMs);
    this.send(req);
    return reply;
  }

  close(): void {
    this.#socket.destroy();
  }
}

function connect(port: number, host: string): Promise<Rdp> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ port, host });
    const rdp = new Rdp(socket);
    // Something else may be listening on a port a previous Zotero used. It
    // will never send the root greeting, so the greeting deadline turns that
    // into a failed connect, and a caller probing for a live Zotero gets its
    // answer.
    socket.once("error", (error: Error) => {
      rdp.close();
      reject(error);
    });
    // Root actor greets us first.
    rdp
      .next((p) => p.from === "root", GREETING_TIMEOUT_MS)
      .then(
        () => resolve(rdp),
        (error: unknown) => {
          rdp.close();
          reject(
            new Error(`no RDP greeting from ${host}:${port}`, { cause: error }),
          );
        },
      );
  });
}

async function getParentConsoleActor(
  rdp: Rdp,
  timeoutMs: number,
): Promise<string> {
  const proc = await rdp.request(
    { to: "root", type: "getProcess", id: 0 },
    timeoutMs,
  );
  const descriptor = (proc.processDescriptor ?? proc.form) as { actor: string };
  const target = await rdp.request(
    { to: descriptor.actor, type: "getTarget" },
    timeoutMs,
  );
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

function evalJS(
  rdp: Rdp,
  text: string,
  { consoleActor, timeoutMs }: { consoleActor: string; timeoutMs: number },
): Promise<Packet> {
  // evaluateJSAsync replies with { resultID }, then emits a separate
  // evaluationResult packet carrying the actual value.
  const resultEvent = rdp.next(
    (p) => p.from === consoleActor && p.type === "evaluationResult",
    timeoutMs,
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
 * its JSON result on a global; we then poll that global synchronously. A
 * rejection stores "ERR:" and the error with its stack — Gecko's `stack`
 * leaves out the message.
 */
export async function evalAsync(
  evaluate: Evaluate,
  body: string,
  options: AsyncEvalOptions = {},
): Promise<Packet> {
  const pause = options.pause ?? sleep;
  const pollAttempts = options.pollAttempts ?? ASYNC_POLL_ATTEMPTS;
  const pollMs = options.pollMs ?? ASYNC_POLL_MS;
  const resultTtlMs = options.resultTtlMs ?? 60_000;
  const resultKey = `__zlEvalResult_${randomUUID()}`;
  const resultRef = `globalThis[${JSON.stringify(resultKey)}]`;
  const started = await evaluate(
    `${resultRef} = undefined;
     (async () => {
       try { ${resultRef} = JSON.stringify(await (async () => (${body}))()); }
       catch (e) { ${resultRef} = "ERR:" + (e && e.stack ? e + "\\n" + e.stack : e); }
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
 *
 * `timeoutMs` bounds each reply; {@link evalAsync} bounds its own polling.
 */
export async function openRdpSession(
  port: number,
  {
    host = "127.0.0.1",
    timeoutMs = RDP_CALL_TIMEOUT_MS,
  }: { host?: string; timeoutMs?: number } = {},
): Promise<RdpSession> {
  const rdp = await connect(port, host);
  try {
    const consoleActor = await getParentConsoleActor(rdp, timeoutMs);
    const evaluate: Evaluate = (text) =>
      evalJS(rdp, text, { consoleActor, timeoutMs });
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
