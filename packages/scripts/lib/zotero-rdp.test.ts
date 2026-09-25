import { createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { evalAsync, openRdpSession } from "./zotero-rdp.ts";
import type { Packet } from "./zotero-rdp.ts";

function createEvaluator(): (source: string) => Promise<Packet> {
  const context = createContext({ setTimeout });
  return async (source) => {
    try {
      return { result: runInContext(source, context) };
    } catch (error) {
      return { exceptionMessage: String(error) };
    }
  };
}

describe("evalAsync", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps concurrent evaluation results separate", async () => {
    vi.useFakeTimers();
    const evaluate = createEvaluator();
    const options = { pollAttempts: 100, pollMs: 1 };

    const first = evalAsync(
      evaluate,
      'new Promise((resolve) => setTimeout(() => resolve("first"), 40))',
      options,
    );
    const second = evalAsync(
      evaluate,
      'new Promise((resolve) => setTimeout(() => resolve("second"), 5))',
      options,
    );

    await vi.runAllTimersAsync();

    await expect(first).resolves.toMatchObject({
      result: JSON.stringify("first"),
    });
    await expect(second).resolves.toMatchObject({
      result: JSON.stringify("second"),
    });
  });

  it("returns a startup exception without polling", async () => {
    const evaluate = createEvaluator();
    const pause = async (): Promise<void> => {
      throw new Error("polling started");
    };

    await expect(evalAsync(evaluate, ")", { pause })).resolves.toMatchObject({
      exceptionMessage: expect.stringContaining("SyntaxError"),
    });
  });
});

describe("openRdpSession", () => {
  /**
   * A stand-in Zotero that greets and hands out its console actor, and then
   * answers evaluations only as `onEvaluate` decides.
   */
  async function fakeZotero(onEvaluate: (socket: Socket) => void) {
    const server = createServer((socket) => {
      const send = (packet: object): void => {
        const json = JSON.stringify(packet);
        socket.write(`${Buffer.byteLength(json)}:${json}`);
      };
      send({ from: "root", applicationType: "browser" });
      socket.on("data", (chunk) => {
        const request = JSON.parse(
          chunk.toString().slice(chunk.indexOf(":") + 1),
        ) as { to: string; type: string };
        if (request.type === "getProcess") {
          send({ from: "root", processDescriptor: { actor: "process" } });
        } else if (request.type === "getTarget") {
          send({ from: "process", process: { consoleActor: "console" } });
        } else if (request.type === "evaluateJSAsync") {
          onEvaluate(socket);
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    return {
      port: (server.address() as AddressInfo).port,
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  it("fails an evaluation Zotero never answers at the deadline", async () => {
    using zotero = await fakeZotero(() => {});
    using session = await openRdpSession(zotero.port, { timeoutMs: 200 });

    await expect(session.evaluate("1")).rejects.toThrow(
      "Zotero sent no reply within 200 ms",
    );
  });

  it("fails a waiting evaluation when Zotero closes the connection", async () => {
    using zotero = await fakeZotero((socket) => socket.destroy());
    using session = await openRdpSession(zotero.port);

    await expect(session.evaluate("1")).rejects.toThrow(
      "Zotero closed the RDP connection",
    );
  });
});
