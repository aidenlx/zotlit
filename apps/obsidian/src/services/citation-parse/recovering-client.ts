// Keeps one parse client across worker lifetimes and replays requests after backoff.
import { abortable } from "@std/async/abortable";

import { getLogger } from "@/lib/log";

import type { ParseClient, ParseRequest, ParseReply } from "./client";

export interface ParseConnection extends ParseClient, Disposable {
  /** Resolves when this connection can no longer serve requests. */
  died: Promise<void>;
}

const logger = getLogger("citation-parse");

export class RecoveringParseClient implements ParseClient, Disposable {
  readonly #connect;
  readonly #stop = new AbortController();
  #available = Promise.withResolvers<ParseConnection>();
  #current: ParseConnection | null = null;
  #started = false;
  #backoff = 100;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(connect: () => ParseConnection) {
    this.#connect = connect;
  }

  start(): void {
    if (this.#started || this.#stop.signal.aborted) return;
    this.#started = true;
    this.#spawn();
  }

  #spawn(): void {
    if (this.#stop.signal.aborted) return;
    try {
      const connection = this.#connect();
      this.#current = connection;
      this.#available.resolve(connection);
      void connection.died.then(() => this.#restart(connection));
    } catch (error) {
      logger.warn("Parse worker did not start", { error });
      this.#schedule();
    }
  }

  #schedule(): void {
    this.#timer = setTimeout(() => this.#spawn(), this.#backoff);
    this.#backoff = Math.min(this.#backoff * 2, 5_000);
  }

  #restart(connection: ParseConnection): void {
    if (this.#current !== connection || this.#stop.signal.aborted) return;
    this.#current = null;
    this.#available = Promise.withResolvers<ParseConnection>();
    connection[Symbol.dispose]();
    logger.warn("Parse worker stopped; restarting", {
      backoffMs: this.#backoff,
    });
    this.#schedule();
  }

  async parse(request: ParseRequest, signal: AbortSignal): Promise<ParseReply> {
    const lifetime = AbortSignal.any([signal, this.#stop.signal]);
    for (;;) {
      lifetime.throwIfAborted();
      const connection = await abortable(this.#available.promise, lifetime);
      try {
        const reply = await abortable(
          connection.parse(request, lifetime),
          lifetime,
        );
        this.#backoff = 100;
        return reply;
      } catch (error) {
        lifetime.throwIfAborted();
        logger.debug("Parse request will retry", { path: request.path, error });
        this.#restart(connection);
      }
    }
  }

  [Symbol.dispose](): void {
    this.#stop.abort();
    clearTimeout(this.#timer);
    this.#current?.[Symbol.dispose]();
    this.#current = null;
  }
}
