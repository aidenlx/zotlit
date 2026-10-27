import { EventEmitter } from "node:events";
import { createContext, runInContext } from "node:vm";
import { beforeEach, expect, it, vi } from "vitest";

const socketBoundary = vi.hoisted(() => ({
  answer: async (_code: string): Promise<string> => "",
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
  const answer = socketBoundary.answer;
  const responses = ['=> __zotlitEvalError__{"message":"loading"}', ""];
  socketBoundary.answer = (code) =>
    responses.length ? Promise.resolve(responses.shift()!) : answer(code);
  expect(
    await obRunUntil("vault", () => ({ count: 2 }), undefined, {
      ready: (value) => value.count === 2,
      what: "rows",
      tries: 3,
    }),
  ).toEqual({ count: 2 });
});

it("defaults to true and names the last rejected value on exhaustion", async () => {
  expect(
    await obRunUntil("vault", () => true, undefined, { what: "ready" }),
  ).toBe(true);
  await expect(
    obRunUntil("vault", () => false, undefined, {
      what: "query ready",
      tries: 1,
    }),
  ).rejects.toThrow("query ready: false");
});
