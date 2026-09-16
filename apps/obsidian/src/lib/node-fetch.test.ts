import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { AbortError } from "@/lib/abort-error";
import { nodeFetch } from "@/lib/node-fetch";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

/** A loopback server on an OS-assigned port, closed when its scope ends. */
async function serve(
  handler: Handler,
): Promise<{ origin: string } & AsyncDisposable> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    [Symbol.asyncDispose]: () =>
      new Promise<void>((resolve, reject) => {
        // Node keeps the client's connection alive, which close() would wait on.
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/** The request as it arrived, so the assertions read the wire, not the call. */
function record(): {
  handler: Handler;
  arrived: Promise<{ method: string; headers: IncomingMessage["headers"] }>;
  body: Promise<string>;
} {
  const arrived = Promise.withResolvers<{
    method: string;
    headers: IncomingMessage["headers"];
  }>();
  const body = Promise.withResolvers<string>();
  return {
    arrived: arrived.promise,
    body: body.promise,
    handler: async (request, response) => {
      arrived.resolve({
        method: request.method!,
        headers: request.headers,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      body.resolve(Buffer.concat(chunks).toString("utf-8"));
      response.writeHead(200).end("ok");
    },
  };
}

describe("nodeFetch", () => {
  it("resolves the status, headers, and body the server answered", async () => {
    await using server = await serve((_, response) => {
      response.writeHead(201, { "X-Answer": "42" }).end("hello");
    });

    const response = await nodeFetch(`${server.origin}/items`);

    expect(response.status).toBe(201);
    expect(response.headers.get("x-answer")).toBe("42");
    expect(await response.text()).toBe("hello");
  });

  it("resolves a refusal as a status, rather than rejecting", async () => {
    await using server = await serve((_, response) => {
      response.writeHead(403).end("Local API is not enabled");
    });

    const response = await nodeFetch(server.origin);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Local API is not enabled");
  });

  it("sends the method, the headers, and the body it was given", async () => {
    const seen = record();
    await using server = await serve(seen.handler);

    await nodeFetch(server.origin, {
      method: "POST",
      headers: { "Zotero-Allowed-Request": "1" },
      body: '{"jsonrpc":"2.0"}',
    });

    const { method, headers } = await seen.arrived;
    expect(method).toBe("POST");
    expect(headers["zotero-allowed-request"]).toBe("1");
    expect(await seen.body).toBe('{"jsonrpc":"2.0"}');
  });

  it("measures the body, so no request arrives without a content length", async () => {
    // Zotero's HTTP server answers 400 to a chunked body, which is how Node
    // frames one it was given no length for.
    const seen = record();
    await using server = await serve(seen.handler);

    await nodeFetch(server.origin, { method: "POST", body: "héllo" });

    const { headers } = await seen.arrived;
    expect(headers["content-length"]).toBe("6");
    expect(headers["transfer-encoding"]).toBeUndefined();
  });

  it("sends no origin and no user agent, which is what Zotero refuses on", async () => {
    const seen = record();
    await using server = await serve(seen.handler);

    await nodeFetch(server.origin);

    const { headers } = await seen.arrived;
    expect(headers.origin).toBeUndefined();
    expect(headers["user-agent"]).toBeUndefined();
  });

  it("keeps a 204 answer body-free, which the Response constructor requires", async () => {
    await using server = await serve((_, response) => {
      response.writeHead(204).end();
    });

    const response = await nodeFetch(server.origin, { method: "PATCH" });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("keeps every value of a header the answer repeats", async () => {
    await using server = await serve((_, response) => {
      response
        .writeHead(200, { "Set-Cookie": ["first=1", "second=2"] })
        .end("ok");
    });

    const response = await nodeFetch(server.origin);

    expect(response.headers.getSetCookie()).toEqual(["first=1", "second=2"]);
  });

  it("rejects with a TypeError when nothing holds the port", async () => {
    const closed = await serve((_, response) => {
      response.end();
    });
    const { origin } = closed;
    await closed[Symbol.asyncDispose]();

    await expect(nodeFetch(origin)).rejects.toThrow(TypeError);
  });

  it("rejects with an AbortError when the signal aborts before the answer", async () => {
    const arrived = Promise.withResolvers<void>();
    await using server = await serve(() => arrived.resolve());
    const controller = new AbortController();

    const pending = nodeFetch(server.origin, { signal: controller.signal });
    await arrived.promise;
    controller.abort();

    await expect(pending).rejects.toSatisfy((error: unknown) =>
      AbortError.test(error),
    );
  });

  it("rejects with an AbortError when the signal aborts mid-body", async () => {
    const started = Promise.withResolvers<void>();
    await using server = await serve((_, response) => {
      response.writeHead(200, { "Content-Length": "10" }).write("half");
      started.resolve();
    });
    const controller = new AbortController();

    const pending = nodeFetch(server.origin, { signal: controller.signal });
    await started.promise;
    controller.abort();

    await expect(pending).rejects.toSatisfy((error: unknown) =>
      AbortError.test(error),
    );
  });

  it("rejects an already-aborted signal without reaching the server", async () => {
    const arrived = Promise.withResolvers<void>();
    await using server = await serve((_, response) => {
      arrived.resolve();
      response.end("ok");
    });
    let reached = false;
    void arrived.promise.then(() => (reached = true));

    await expect(
      nodeFetch(server.origin, { signal: AbortSignal.abort() }),
    ).rejects.toSatisfy((error: unknown) => AbortError.test(error));
    expect(reached).toBe(false);
  });
});
