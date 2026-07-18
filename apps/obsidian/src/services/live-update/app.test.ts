import { describe, expect, it, vi } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";

import { createLiveUpdateApp, type LiveUpdateAppDeps } from "./app";

const SOURCE_ID = "a1b2c3d4";

function headers(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
    [SOURCE_ID_HEADER]: SOURCE_ID,
  };
  return Object.assign(base, overrides);
}

function makeDeps(
  overrides: Partial<LiveUpdateAppDeps> = {},
): LiveUpdateAppDeps {
  return {
    sourceId: () => SOURCE_ID,
    noteIndex: {
      whenIndexed: () => Promise.resolve(),
      getIndexedItemKeys: () => ["ABCD2345", "ZZZ99999g17"],
    },
    onNotify: vi.fn(),
    onUpdateMany: vi.fn(),
    onImportNotes: vi.fn(),
    ...overrides,
  };
}

describe("GET /literature-notes", () => {
  it("returns the indexed keys with a 200", async () => {
    const deps = makeDeps();
    const app = createLiveUpdateApp(deps);

    const res = await app.request("/literature-notes", { headers: headers() });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      keys: ["ABCD2345", "ZZZ99999g17"],
    });
  });

  it("rejects an older protocol version with 426", async () => {
    const app = createLiveUpdateApp(makeDeps());

    const res = await app.request("/literature-notes", {
      headers: headers({ [PROTOCOL_VERSION_HEADER]: "3" }),
    });

    expect(res.status).toBe(426);
  });

  it("rejects a missing protocol version header with 426", async () => {
    const app = createLiveUpdateApp(makeDeps());
    const reqHeaders = headers();
    delete (reqHeaders as Record<string, string>)[PROTOCOL_VERSION_HEADER];

    const res = await app.request("/literature-notes", {
      headers: reqHeaders,
    });

    expect(res.status).toBe(426);
  });

  it("discards a request with a mismatched source id via 204", async () => {
    const app = createLiveUpdateApp(makeDeps());

    const res = await app.request("/literature-notes", {
      headers: headers({ [SOURCE_ID_HEADER]: "deadbeef" }),
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("discards a request when the install has no configured source id", async () => {
    const app = createLiveUpdateApp(makeDeps({ sourceId: () => null }));

    const res = await app.request("/literature-notes", {
      headers: headers(),
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("awaits whenIndexed so a startup-time query reflects the post-scan keys", async () => {
    let resolveScan!: () => void;
    const scanned = new Promise<void>((resolve) => {
      resolveScan = resolve;
    });
    let keys: string[] = [];
    const app = createLiveUpdateApp(
      makeDeps({
        noteIndex: {
          whenIndexed: () => scanned,
          getIndexedItemKeys: () => keys,
        },
      }),
    );

    const pending = app.request("/literature-notes", { headers: headers() });
    keys = ["ABCD2345"];
    resolveScan();

    const res = await pending;
    await expect(res.json()).resolves.toEqual({ keys: ["ABCD2345"] });
  });
});

describe("POST /notify", () => {
  it("dispatches a valid item/update event and acks 204", async () => {
    const onNotify = vi.fn();
    const app = createLiveUpdateApp(makeDeps({ onNotify }));
    const event = {
      event: "item/update",
      add: [{ itemID: 1, libraryID: 1 }],
      modify: [],
      trash: [],
    };

    const res = await app.request("/notify", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(res.status).toBe(204);
    expect(onNotify).toHaveBeenCalledWith(event);
  });

  it("rejects a malformed body with 400", async () => {
    const onNotify = vi.fn();
    const app = createLiveUpdateApp(makeDeps({ onNotify }));

    const res = await app.request("/notify", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ event: "bogus" }),
    });

    expect(res.status).toBe(400);
    expect(onNotify).not.toHaveBeenCalled();
  });
});

describe("PUT /literature-notes", () => {
  it("fires onUpdateMany with the parsed batch after decoupling", async () => {
    const onUpdateMany = vi.fn();
    const app = createLiveUpdateApp(makeDeps({ onUpdateMany }));
    const body = { items: [1, 2, 3], scope: "full" };

    const res = await app.request("/literature-notes", {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(204);
    // The handler decouples emission via delay(0); flush a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUpdateMany).toHaveBeenCalledWith({
      items: [1, 2, 3],
      scope: "full",
    });
  });
});
