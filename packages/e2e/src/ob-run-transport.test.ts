import { EventEmitter } from "node:events";
import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const socketBoundary = vi.hoisted(() => ({
  answer: async (_code: string): Promise<string> => "",
}));
// Node's promise timer retains its original timer even when globals are faked.
// Keep this OS boundary on the test clock too.
vi.mock("node:timers/promises", () => ({
  setTimeout: (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}));
vi.mock("node:net", () => ({
  createConnection() {
    const socket = new EventEmitter();
    Object.assign(socket, {
      setNoDelay() {},
      destroy(error: Error) {
        socket.emit("error", error);
      },
      write(request: string) {
        const { argv } = JSON.parse(request) as { argv: string[] };
        const code = argv.find((arg) => arg.startsWith("code="))!.slice(5);
        void socketBoundary.answer(code).then(
          (reply) => {
            socket.emit("data", Buffer.from(reply));
            socket.emit("end");
          },
          (error) => socket.emit("error", error),
        );
      },
    });
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  },
}));

import { obRun, obRunUntil } from "./obsidian-cli.ts";

beforeEach(() => {
  const page = createContext({
    app: { plugins: { plugins: { zotlit: { services: {} } } } },
  });
  socketBoundary.answer = async (code) =>
    `=> ${String(await runInContext(code, page))}`;
});

afterEach(() => {
  vi.useRealTimers();
});

it("installs missing helpers and carries JSON args, inferred results, and void", async () => {
  expect(
    await obRun(
      "vault",
      ({ page }, { source }) => page.listAnnotations(source),
      {
        source:
          "Before\n## Annotations\n\n```zotquery\nfrom: annotations\n```\nAfter",
      },
    ),
  ).toBe(
    "Before\n{% managed %}\n{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n{% endmanaged %}\nAfter",
  );
  expect(await obRun("vault", () => {})).toBeUndefined();
});

it("keeps scratch across calls and installs it again in a replacement window", async () => {
  await obRun("vault", ({ page }) => {
    page.scratch.windowBeforeReload = true;
  });
  expect(
    await obRun("vault", ({ page }) => page.scratch.windowBeforeReload),
  ).toBe(true);
  const replacement = createContext({ app: { plugins: { plugins: {} } } });
  socketBoundary.answer = async (code) =>
    `=> ${String(await runInContext(code, replacement))}`;
  expect(
    await obRun("vault", ({ page }) => page.scratch.windowBeforeReload),
  ).toBeUndefined();
});

it("keeps the page stack on a thrown error", async () => {
  await expect(
    obRun("vault", () => {
      throw new Error("page failed");
    }),
  ).rejects.toThrow("page failed\n    at");
});

it("polls past a throw and a missing reply, returning the value accepted by ready", async () => {
  vi.useFakeTimers();
  const answer = socketBoundary.answer;
  const responses = ['=> __zotlitEvalError__{"message":"loading"}', ""];
  socketBoundary.answer = (code) =>
    responses.length ? Promise.resolve(responses.shift()!) : answer(code);
  const accepted = expect(
    obRunUntil("vault", () => ({ count: 2 }), undefined, {
      ready: (value) => value.count === 2,
      what: "rows",
      tries: 3,
    }),
  ).resolves.toEqual({ count: 2 });
  await vi.advanceTimersByTimeAsync(500);
  await accepted;
});

it("defaults to true and names the last rejected value on exhaustion", async () => {
  vi.useFakeTimers();
  expect(
    await obRunUntil("vault", () => true, undefined, { what: "ready" }),
  ).toBe(true);
  const rejected = expect(
    obRunUntil("vault", () => false, undefined, {
      what: "query ready",
      tries: 1,
    }),
  ).rejects.toThrow("query ready: false");
  await vi.advanceTimersByTimeAsync(250);
  await rejected;
});

// #1855: preserve wrapper behavior through the public typed transport.
it("awaits a callback promise", async () => {
  expect(await obRun("vault", () => Promise.resolve(7))).toBe(7);
});

it("names a non-Error thrown by the page", async () => {
  await expect(
    obRun("vault", () => {
      throw "plain";
    }),
  ).rejects.toThrow("plain");
});

it("takes the last reply past console output", async () => {
  const answer = socketBoundary.answer;
  socketBoundary.answer = async (code) =>
    `plugin loaded\n=> early\nmore\n${await answer(code)}`;
  expect(await obRun("vault", () => 42)).toBe(42);
});

it("reports output with no reply line", async () => {
  socketBoundary.answer = async () => "Vault not found.";
  await expect(obRun("vault", () => true)).rejects.toThrow(
    'obsidian reply had no "=> " line: Vault not found.',
  );
});

it("puts the thrown message first, then the app frames", async () => {
  socketBoundary.answer = async () =>
    `=> __zotlitEvalError__${JSON.stringify({
      message: "x",
      stack: "Error: x\n    at eval (app://obsidian.md/app.js:1:1)",
    })}`;
  await expect(obRun("vault", () => true)).rejects.toThrow(
    "x\n    at eval (app://obsidian.md/app.js:1:1)",
  );
});
