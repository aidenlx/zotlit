// SPDX-License-Identifier: MPL-2.0
//
// Derived from Mozilla web-ext `src/firefox/rdp-client.js`.

import { EventEmitter } from "node:events";
import { createConnection, createServer } from "node:net";
import type { Socket } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 6000;
export const DEFAULT_CONNECT_MAX_RETRIES = 120;
export const DEFAULT_CONNECT_RETRY_INTERVAL_MS = 500;

const BYTE_COLON = 0x3a;
const BYTE_DIGIT_0 = 0x30;
const BYTE_DIGIT_9 = 0x39;

const UNSOLICITED_EVENTS = new Set([
  "tabNavigated",
  "styleApplied",
  "propertyChange",
  "networkEventUpdate",
  "networkEvent",
  "newMutations",
  "frameUpdate",
  "tabListChanged",
  "addonListChanged",
]);

export interface RdpMessage {
  from?: string;
  type?: string;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

export interface RdpRequest {
  to?: string;
  type: string;
  [key: string]: unknown;
}

export interface RdpClientConnectOptions {
  host?: string;
  signal?: AbortSignal;
}

export interface ConnectWithRetryOptions extends RdpClientConnectOptions {
  maxRetries?: number;
  retryIntervalMs?: number;
}

interface RdpClientEvents {
  disconnect: [];
  "unsolicited-event": [RdpMessage];
  error: [Error];
}

type NormalizedRdpRequest = RdpRequest & { to: string };

interface PendingRequest {
  request: NormalizedRdpRequest;
  deferred: PromiseWithResolvers<RdpMessage>;
}

type ParseResult =
  | { data: Buffer; rdpMessage: RdpMessage }
  | { data: Buffer; error: Error; fatal: boolean }
  | { data: Buffer };

export class RdpClient extends EventEmitter<RdpClientEvents> {
  #incoming: Buffer = Buffer.alloc(0);
  #pending: PendingRequest[] = [];
  readonly #active = new Map<string, PromiseWithResolvers<RdpMessage>>();
  #socket: Socket | undefined;
  #removeAbortListener: (() => void) | undefined;

  readonly #onData = (data: Buffer): void => {
    this.#incoming = Buffer.concat([this.#incoming, data]);

    while (this.#readMessage()) {
      // Keep draining complete RDP packets already buffered on this tick.
    }
  };

  readonly #onError = (error: Error): void => {
    this.emit("error", error);
    this.#close(error, "destroy");
  };

  readonly #onEnd = (): void => {
    this.#close(new Error("RDP connection closed"), "none");
  };

  readonly #onClose = (): void => {
    this.#close(new Error("RDP connection closed"), "none");
  };

  readonly #onTimeout = (): void => {
    const error = new Error("RDP connection timed out");
    this.emit("error", error);
    this.#close(error, "destroy");
  };

  async connect(
    port: number,
    { host = DEFAULT_HOST, signal }: RdpClientConnectOptions = {},
  ): Promise<void> {
    if (this.#socket) {
      throw new Error("RDP client is already connected");
    }

    signal?.throwIfAborted();

    const socket = createConnection({ host, port });
    this.#socket = socket;
    this.#incoming = Buffer.alloc(0);

    const rootReply = Promise.withResolvers<RdpMessage>();
    this.#expectReply("root", rootReply);

    const onConnect = (): void => {
      socket.off("error", onConnectError);
      socket.on("error", this.#onError);
    };

    const onConnectError = (error: Error): void => {
      socket.off("connect", onConnect);
      this.#close(error, "destroy");
    };

    if (signal) {
      const onAbort = (): void => {
        this.#close(abortError(signal), "destroy");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#removeAbortListener = () => {
        signal.removeEventListener("abort", onAbort);
      };
    }

    socket.on("data", this.#onData);
    socket.once("connect", onConnect);
    socket.once("error", onConnectError);
    socket.once("end", this.#onEnd);
    socket.once("close", this.#onClose);
    socket.once("timeout", this.#onTimeout);

    await rootReply.promise;
  }

  disconnect(): void {
    this.#close(new Error("RDP connection closed"), "end");
  }

  request<T extends RdpMessage = RdpMessage>(
    requestProps: string | RdpRequest,
  ): Promise<T> {
    const request =
      typeof requestProps === "string"
        ? { to: "root", type: requestProps }
        : requestProps;

    if (request.to == null) {
      throw new Error(
        `Unexpected RDP request without target actor: ${request.type}`,
      );
    }

    const deferred = Promise.withResolvers<RdpMessage>();
    this.#pending.push({
      request: { ...request, to: request.to },
      deferred,
    });
    this.#flushPendingRequests();

    return deferred.promise as Promise<T>;
  }

  #flushPendingRequests(): void {
    const remaining: PendingRequest[] = [];

    for (const pending of this.#pending) {
      if (this.#active.has(pending.request.to)) {
        remaining.push(pending);
        continue;
      }

      const socket = this.#socket;
      if (!socket?.writable) {
        pending.deferred.reject(new Error("RDP connection closed"));
        continue;
      }

      try {
        const json = JSON.stringify(pending.request);
        socket.write(`${Buffer.byteLength(json)}:${json}`);
        this.#expectReply(pending.request.to, pending.deferred);
      } catch (error) {
        pending.deferred.reject(error);
      }
    }

    this.#pending = remaining;
  }

  #expectReply(
    targetActor: string,
    deferred: PromiseWithResolvers<RdpMessage>,
  ): void {
    if (this.#active.has(targetActor)) {
      throw new Error(`${targetActor} already has an active request`);
    }

    this.#active.set(targetActor, deferred);
  }

  #readMessage(): boolean {
    const result = parseRdpMessage(this.#incoming);
    this.#incoming = result.data;

    if ("error" in result) {
      const error = new Error("Error parsing RDP packet", {
        cause: result.error,
      });
      this.emit("error", error);

      if (result.fatal) {
        this.#close(error, "destroy");
      }

      return !result.fatal;
    }

    if (!("rdpMessage" in result)) {
      return false;
    }

    this.#handleMessage(result.rdpMessage);
    return true;
  }

  #handleMessage(message: RdpMessage): void {
    if (message.from == null) {
      this.emit(
        "error",
        new Error(
          `Received an RDP message without a sender actor: ${JSON.stringify(
            message,
          )}`,
        ),
      );
      return;
    }

    if (message.type != null && UNSOLICITED_EVENTS.has(message.type)) {
      this.emit("unsolicited-event", message);
      return;
    }

    const deferred = this.#active.get(message.from);
    if (deferred) {
      this.#active.delete(message.from);
      if (message.error != null) {
        deferred.reject(message);
      } else {
        deferred.resolve(message);
      }
      this.#flushPendingRequests();
      return;
    }

    this.emit(
      "error",
      new Error(`Unexpected RDP message received: ${JSON.stringify(message)}`),
    );
  }

  #close(reason: Error, socketAction: "destroy" | "end" | "none"): void {
    const socket = this.#socket;
    if (!socket) {
      this.#rejectAllRequests(reason);
      return;
    }

    this.#socket = undefined;
    this.#removeAbortListener?.();
    this.#removeAbortListener = undefined;

    socket.off("data", this.#onData);
    socket.off("error", this.#onError);
    socket.off("end", this.#onEnd);
    socket.off("close", this.#onClose);
    socket.off("timeout", this.#onTimeout);

    if (socketAction === "destroy" && !socket.destroyed) {
      socket.destroy();
    } else if (socketAction === "end" && !socket.destroyed) {
      socket.end();
    }

    this.#rejectAllRequests(reason);
    this.emit("disconnect");
  }

  #rejectAllRequests(error: Error): void {
    for (const deferred of this.#active.values()) {
      deferred.reject(error);
    }
    this.#active.clear();

    for (const { deferred } of this.#pending) {
      deferred.reject(error);
    }
    this.#pending = [];
  }
}

export async function connectWithRetry(
  port: number,
  {
    host = DEFAULT_HOST,
    signal,
    maxRetries = DEFAULT_CONNECT_MAX_RETRIES,
    retryIntervalMs = DEFAULT_CONNECT_RETRY_INTERVAL_MS,
  }: ConnectWithRetryOptions = {},
): Promise<RdpClient> {
  let lastError: unknown;
  const attempts = Math.max(1, maxRetries);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();

    const client = new RdpClient();
    try {
      await client.connect(port, { host, signal });
      return client;
    } catch (error) {
      client.disconnect();
      signal?.throwIfAborted();

      if (!isErrorWithCode(error, "ECONNREFUSED")) {
        throw error;
      }

      lastError = error;
      if (attempt < attempts) {
        await sleep(retryIntervalMs, undefined, { signal });
      }
    }
  }

  throw new Error(
    `Unable to connect to Firefox debugger on ${host}:${port} after ${attempts} attempts`,
    { cause: lastError },
  );
}

export async function findFreePort(host = DEFAULT_HOST): Promise<number> {
  const server = createServer();
  const deferred = Promise.withResolvers<number>();

  server.once("error", (error) => {
    deferred.reject(error);
  });

  server.listen(0, host, () => {
    const address = server.address();
    if (address == null || typeof address === "string") {
      server.close();
      deferred.reject(new Error("Unable to resolve free TCP port"));
      return;
    }

    const { port } = address;
    server.close((error) => {
      if (error) {
        deferred.reject(error);
      } else {
        deferred.resolve(port);
      }
    });
  });

  return deferred.promise;
}

function parseRdpMessage(data: Buffer): ParseResult {
  const sepIdx = data.indexOf(BYTE_COLON);
  if (sepIdx < 1) {
    return { data };
  }

  const byteLength = parseByteLength(data.subarray(0, sepIdx));
  if (byteLength == null) {
    return {
      data,
      error: new Error("Error parsing RDP message length"),
      fatal: true,
    };
  }

  const bodyStart = sepIdx + 1;
  const bodyEnd = bodyStart + byteLength;
  if (data.length < bodyEnd) {
    return { data };
  }

  const payload = data.subarray(bodyStart, bodyEnd);
  const rest = data.subarray(bodyEnd);

  try {
    const message = JSON.parse(payload.toString("utf8")) as unknown;
    if (!isRdpMessage(message)) {
      return {
        data: rest,
        error: new Error("RDP packet did not contain a message object"),
        fatal: false,
      };
    }
    return { data: rest, rdpMessage: message };
  } catch (cause) {
    return {
      data: rest,
      error: new Error("Error parsing RDP message JSON", { cause }),
      fatal: false,
    };
  }
}

function parseByteLength(bytes: Buffer): number | undefined {
  let length = 0;

  for (const byte of bytes) {
    if (byte < BYTE_DIGIT_0 || byte > BYTE_DIGIT_9) {
      return undefined;
    }
    length = length * 10 + byte - BYTE_DIGIT_0;
  }

  return length;
}

function isRdpMessage(value: unknown): value is RdpMessage {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

interface ErrorWithCode extends Error {
  code?: string;
}

function isErrorWithCode(error: unknown, code: string): error is ErrorWithCode {
  return error instanceof Error && (error as ErrorWithCode).code === code;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }

  return new Error("RDP connection aborted", { cause: signal.reason });
}
