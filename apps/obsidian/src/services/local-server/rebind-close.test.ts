// Closing the Local Server while a rebind is binding: the close waits for it.
import type { ServerType } from "@hono/node-server";
import { expect, it, vi } from "vitest";

import { Stream } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";

import { buildLocalServer } from "./__fixtures__";

/** The listeners `serve` opened, and the gate holding their bind callback. */
const binds = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  opened: [] as ServerType[],
  onOpen: null as (() => void) | null,
}));

vi.mock("@hono/node-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hono/node-server")>();
  return {
    ...actual,
    serve: ((options, onListening) => {
      const gate = binds.gate;
      const listener = actual.serve(options, (info) => {
        if (gate === null) onListening?.(info);
        else void gate.then(() => onListening?.(info));
      });
      binds.opened.push(listener);
      binds.onOpen?.();
      return listener;
    }) satisfies typeof actual.serve,
  };
});

it("closing waits for a rebind that has started", async () => {
  const stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    { "server.enabled": true, "server.port": 0 },
    stack,
  );
  await new Promise<void>((resolve) => {
    const off = subscribe(
      service.runtime,
      service.server.effectivePortChanges,
      (port) => {
        if (port === null) return;
        off();
        resolve();
      },
    );
  });

  // Hold the next bind, then make the server rebind.
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  binds.gate = gate;
  const opened = new Promise<void>((resolve) => {
    binds.onOpen = resolve;
  });
  const stopped = new Promise<void>((resolve) => {
    const off = subscribe(
      service.runtime,
      Stream.drop(service.server.effectivePortChanges, 1),
      (port) => {
        if (port !== null) return;
        off();
        resolve();
      },
    );
  });
  service.runtime.runSync(service.settings.update({ "server.enabled": false }));
  await stopped;
  service.runtime.runSync(service.settings.update({ "server.enabled": true }));
  await opened;
  const rebound = binds.opened.at(-1)!;

  let closed = false;
  const closing = stack.disposeAsync().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);

  release();
  await closing;
  // The rebind finished, and the stop that followed closed its listener.
  expect(rebound.listening).toBe(false);
});
