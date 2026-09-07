import { describe, expect, it } from "vitest";

import { LOCAL_BRIDGE_PATHS } from "@zotlit/workbench/bridge";

import { createLocalBridgeApp } from "./app";
import type { ConnectionGrantDescription } from "./app";
import { PRERELEASE_DOCS_ORIGIN, STABLE_DOCS_ORIGIN } from "./origins";
import { BridgeSessions } from "./sessions";
import type { BridgeConnection } from "./sessions";

const OTHER_ORIGIN = "https://zotlit.example.com";

/** A fixed clock the test moves by hand, so a code's expiry is not a wait. */
class TestClock {
  #instant = Temporal.Instant.from("2026-09-07T10:00:00Z");

  now = (): Temporal.Instant => this.#instant;

  advance(duration: Temporal.DurationLike): void {
    this.#instant = this.#instant.add(duration);
  }
}

/**
 * The grant the plugin would describe, kept fixed here: this suite is about the
 * gates and the lifecycle, and `service.test.ts` covers what the grant carries.
 */
function grantOf(connection: BridgeConnection): ConnectionGrantDescription {
  return {
    installation: { id: "install-1", vault: "Research" },
    pluginVersion: "2.1.1",
    bridgeVersion: 2,
    templateDataContractVersion: 7,
    capabilities: ["selected-profile:read"],
    selectedItem: connection.item,
    selectedProfile: { id: connection.profileId, name: "Books" },
    profileDefaults: {
      folder: "literatures",
      citationStyle: null,
      importFolder: "zotero_notes",
      importColoredHighlights: false,
      importAnnotationsAsTemplate: false,
    },
  };
}

/** The shape a bridge call takes here: plain headers, so nothing spreads wrong. */
interface CallInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

interface Harness {
  request(path: string, init?: CallInit): Promise<Response>;
  sessions: BridgeSessions;
  clock: TestClock;
  /** Mint a code and spend it, answering the credential the page would hold. */
  connect(): Promise<string>;
  setEnabled(value: boolean): void;
  setPeer(address: string | undefined): void;
}

function setup(): Harness {
  const clock = new TestClock();
  const sessions = new BridgeSessions(() => {}, clock.now);
  let enabled = true;
  let peer: string | undefined = "127.0.0.1";
  const app = createLocalBridgeApp({
    enabled: () => enabled,
    peerAddress: () => peer,
    allowedOrigins: [STABLE_DOCS_ORIGIN, PRERELEASE_DOCS_ORIGIN],
    sessions,
    describeGrant: (connection) => Promise.resolve(grantOf(connection)),
  });
  const request = async (
    path: string,
    init: CallInit = {},
  ): Promise<Response> =>
    await app.request(path, {
      ...init,
      headers: { Origin: STABLE_DOCS_ORIGIN, ...init.headers },
    });
  return {
    request,
    sessions,
    clock,
    setEnabled: (value) => (enabled = value),
    setPeer: (address) => (peer = address),
    async connect() {
      const code = sessions.mintCode({
        origin: STABLE_DOCS_ORIGIN,
        profileId: "books",
        item: { key: "IANNP5A2", title: "Why research findings are false" },
      });
      const res = await request(LOCAL_BRIDGE_PATHS.codeBootstrap, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      const grant = (await res.json()) as { credential: string };
      return grant.credential;
    },
  };
}

function authorized(credential: string): Record<string, string> {
  return { Authorization: `Bearer ${credential}` };
}

describe("the bridge gates", () => {
  it("refuses a peer that is not on this computer", async () => {
    const bridge = setup();
    bridge.setPeer("192.168.1.24");

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.codeBootstrap, {
      method: "POST",
      body: JSON.stringify({ code: "anything" }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: { code: "loopback-required", message: expect.any(String) },
    });
    // A refusal for a peer we never approved carries no CORS grant either.
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  it("refuses a website outside the allow-list, CORS headers included", async () => {
    const bridge = setup();

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      headers: { Origin: OTHER_ORIGIN },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: { code: "origin-refused", message: expect.any(String) },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  it("answers preflight for the allow-listed website only", async () => {
    const bridge = setup();

    const allowed = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      method: "OPTIONS",
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      STABLE_DOCS_ORIGIN,
    );
    expect(allowed.headers.get("Vary")).toBe("Origin");
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization",
    );

    const refused = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      method: "OPTIONS",
      headers: { Origin: OTHER_ORIGIN },
    });
    expect(refused.status).toBe(403);
  });

  it("requires a bearer credential everywhere but the code exchange", async () => {
    const bridge = setup();

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: "session-revoked", message: expect.any(String) },
    });
    // The allow-listed website still gets the headers it needs to read that.
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      STABLE_DOCS_ORIGIN,
    );
  });

  it("reads the peer from the socket, not from a header", async () => {
    const bridge = setup();
    bridge.setPeer("192.168.1.24");

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "X-Real-IP": "127.0.0.1",
        Host: "127.0.0.1",
      },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: { code: "loopback-required", message: expect.any(String) },
    });
  });

  it("refuses every path while the web Template Workbench is off", async () => {
    const bridge = setup();
    const credential = await bridge.connect();
    bridge.setEnabled(false);

    // The toggle revoked the connection, so the page reads the one answer it
    // acts on: the session is gone, open a fresh one from Obsidian.
    const resumed = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      headers: authorized(credential),
    });
    expect(resumed.status).toBe(401);
    await expect(resumed.json()).resolves.toEqual({
      error: { code: "session-revoked", message: expect.any(String) },
    });

    const exchanged = await bridge.request(LOCAL_BRIDGE_PATHS.codeBootstrap, {
      method: "POST",
      body: JSON.stringify({ code: "anything" }),
    });
    expect(exchanged.status).toBe(403);
    await expect(exchanged.json()).resolves.toEqual({
      error: { code: "bridge-disabled", message: expect.any(String) },
    });
  });
});

describe("a Connection code", () => {
  it("is spent by the first exchange and refused on the second", async () => {
    const bridge = setup();
    const code = bridge.sessions.mintCode({
      origin: STABLE_DOCS_ORIGIN,
      profileId: "default",
      item: null,
    });
    const spend = (): Promise<Response> =>
      bridge.request(LOCAL_BRIDGE_PATHS.codeBootstrap, {
        method: "POST",
        body: JSON.stringify({ code }),
      });

    const first = await spend();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      credential: expect.any(String),
      bridgeVersion: 2,
      selectedItem: null,
      selectedProfile: { id: "default" },
    });

    const second = await spend();
    expect(second.status).toBe(401);
    await expect(second.json()).resolves.toEqual({
      error: { code: "invalid-one-time-code", message: expect.any(String) },
    });
  });

  it("is refused from a website other than the one it was minted for", async () => {
    const bridge = setup();
    const code = bridge.sessions.mintCode({
      origin: STABLE_DOCS_ORIGIN,
      profileId: "default",
      item: null,
    });

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.codeBootstrap, {
      method: "POST",
      headers: { Origin: PRERELEASE_DOCS_ORIGIN },
      body: JSON.stringify({ code }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: "invalid-one-time-code", message: expect.any(String) },
    });
  });

  it("is refused once two minutes have passed", async () => {
    const bridge = setup();
    const code = bridge.sessions.mintCode({
      origin: STABLE_DOCS_ORIGIN,
      profileId: "default",
      item: null,
    });
    bridge.clock.advance({ minutes: 2, seconds: 1 });

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.codeBootstrap, {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: "invalid-one-time-code", message: expect.any(String) },
    });
  });

  it("answers a version-2 grant naming what the launch chose", async () => {
    const bridge = setup();
    const code = bridge.sessions.mintCode({
      origin: STABLE_DOCS_ORIGIN,
      profileId: "books",
      item: { key: "IANNP5A2", title: "Why research findings are false" },
    });

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.codeBootstrap, {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    const grant = (await res.json()) as Record<string, unknown>;
    expect(grant).toMatchObject({
      bridgeVersion: 2,
      installation: { id: "install-1", vault: "Research" },
      selectedItem: {
        key: "IANNP5A2",
        title: "Why research findings are false",
      },
      selectedProfile: { id: "books", name: "Books" },
    });
    // The Zotero source id left the grant in contract version 2.
    expect(grant).not.toHaveProperty("zoteroSourceId");
    expect(grant["credential"]).not.toBe(code);
  });
});

describe("a live Workbench Connection", () => {
  it("resumes with the grant minus the credential", async () => {
    const bridge = setup();
    const credential = await bridge.connect();

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      headers: authorized(credential),
    });

    expect(res.status).toBe(200);
    const resumed = (await res.json()) as Record<string, unknown>;
    expect(resumed).not.toHaveProperty("credential");
    expect(resumed).toMatchObject({
      bridgeVersion: 2,
      selectedProfile: { id: "books" },
    });
  });

  it("answers 401 on every path after the page disconnects", async () => {
    const bridge = setup();
    const credential = await bridge.connect();

    const ended = await bridge.request(LOCAL_BRIDGE_PATHS.disconnect, {
      method: "POST",
      headers: authorized(credential),
      body: JSON.stringify({}),
    });
    expect(ended.status).toBe(200);
    expect(bridge.sessions.connection).toBe(null);

    for (const path of [
      LOCAL_BRIDGE_PATHS.resumeSession,
      LOCAL_BRIDGE_PATHS.selectedProfile,
    ]) {
      const res = await bridge.request(path, {
        headers: authorized(credential),
      });
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({
        error: { code: "session-revoked", message: expect.any(String) },
      });
    }
  });

  it("hands the vault to the newer exchange and revokes the older tab", async () => {
    const bridge = setup();
    const older = await bridge.connect();
    const newer = await bridge.connect();

    expect(newer).not.toBe(older);
    const stale = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      headers: authorized(older),
    });
    expect(stale.status).toBe(401);
    const live = await bridge.request(LOCAL_BRIDGE_PATHS.resumeSession, {
      headers: authorized(newer),
    });
    expect(live.status).toBe(200);
  });

  it("refuses the data operations that have not landed yet", async () => {
    const bridge = setup();
    const credential = await bridge.connect();

    const res = await bridge.request(LOCAL_BRIDGE_PATHS.selectedItem, {
      method: "POST",
      headers: authorized(credential),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toEqual({
      error: { code: "not-implemented", message: expect.any(String) },
    });
  });
});
