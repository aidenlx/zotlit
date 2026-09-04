import getPort from "get-port";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BRIDGE_VERSION,
  LOCAL_BRIDGE_ORIGIN,
  LOCAL_BRIDGE_PATHS,
  LocalBridgeClient,
  LocalBridgeUnavailableError,
} from "@zotlit/workbench/bridge";

import { buildFixture } from "./build.ts";
import { getFixtureLayout } from "./layout.ts";
import { startMockLocalBridge } from "./local-bridge-server.ts";
import { createMockLocalBridge } from "./local-bridge.ts";

import { getWorkspaceRoot } from "#package-roots";

const ORIGIN = "https://zotlit.aidenlx.site";
const PARENT_STYLE_ID = "http://www.zotero.org/styles/fixture-parent";
const DEPENDENT_STYLE_ID = "http://www.zotero.org/styles/fixture-dependent";
const PARENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>Fixture parent</title><id>${PARENT_STYLE_ID}</id></info>
  <citation><layout><text variable="citation-number"/></layout></citation>
</style>`;
const DEPENDENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" default-locale="de-DE">
  <info>
    <title>Fixture dependent</title><id>${DEPENDENT_STYLE_ID}</id>
    <link href="${PARENT_STYLE_ID}" rel="independent-parent"/>
  </info>
</style>`;

describe("LocalBridgeClient against the mock Local Bridge", () => {
  it("connects through the loopback server after a browser CORS preflight", async () => {
    await using fixture = await createBridgeFixture();
    const port = await getPort();
    const bridge = startMockLocalBridge({
      layout: fixture.layout,
      allowedOrigin: ORIGIN,
      port,
    });
    using stack = new DisposableStack();
    stack.adopt(bridge.server, (server) => server.close());
    const baseUrl = `http://127.0.0.1:${port}`;

    const preflight = await fetch(
      `${baseUrl}${LOCAL_BRIDGE_PATHS.loopbackBootstrap}`,
      {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Headers": "content-type",
          "Access-Control-Request-Method": "POST",
        },
      },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);

    const client = new LocalBridgeClient({
      baseUrl,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Origin", ORIGIN);
        return fetch(input, { ...init, headers });
      },
      storage: memoryStorage(),
      compatibility: {
        bridgeVersion: BRIDGE_VERSION,
        templateDataContractVersion: 2,
      },
    });
    await expect(client.connectFromLoopback()).resolves.toMatchObject({
      state: "connected",
      installation: { vault: "ZotLit Fixture" },
    });
    await expect(client.readSelectedProfile()).resolves.toMatchObject({
      profile: { name: "Books" },
      document: { state: "present" },
    });
  });

  it("runs every approved operation over a code-bootstrap session", async () => {
    await using fixture = await createBridgeFixture();
    const { layout } = fixture;
    const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });
    const storage = memoryStorage();
    const client = clientFor(bridge, { storage });

    await expect(
      client.connectFromFragment(
        `#zotlit-connect=${bridge.initialOneTimeCode}`,
      ),
    ).resolves.toMatchObject({
      state: "connected",
      installation: { id: "fixture-installation", vault: "ZotLit Fixture" },
      bridgeVersion: BRIDGE_VERSION,
      capabilities: expect.arrayContaining([
        "selected-item:read",
        "selected-profile:save",
      ]),
    });

    const schemas = await client.readTemplateSchema();
    expect(Object.keys(schemas)).toEqual(["note", "annotation", "filename"]);
    expect(schemas.note).toMatchObject({
      $id: "urn:zotlit:template-contract:v2:note",
    });

    const snapshot = await client.loadSelectedItem();
    expect(snapshot).toMatchObject({
      item: {
        key: "IANNP5A2",
        title: "Why Most Published Research Findings Are False",
      },
      provenance: {
        kind: "connected",
        installationId: "fixture-installation",
        vault: "ZotLit Fixture",
      },
    });

    const profile = await client.readSelectedProfile();
    expect(profile).toMatchObject({
      profile: { id: "V1StGXR8Z5jd", name: "Books" },
      document: { reference: "profile:V1StGXR8Z5jd", state: "present" },
    });
    if (profile.document.state !== "present") {
      throw new Error("Fixture Books Profile must have a document.");
    }

    const dependencies = await client.readTemplateDependencies();
    expect(dependencies.templates).toHaveLength(0);
    expect(dependencies.diagnostics).toEqual([]);
    await expect(client.listCitationStyles()).resolves.toContainEqual({
      id: "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
      title: "China National Standard GB/T 7714-1987 (numeric, 中文)",
    });
    await expect(
      client.readSelectedCitationStyle({
        styleId: "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
        locale: "en-US",
      }),
    ).resolves.toMatchObject({
      kind: "installed",
      styleId: "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
      locale: "en-US",
      xml: expect.stringContaining("<style"),
    });

    const restored = clientFor(bridge, { storage });
    await expect(restored.readTemplateSchema()).resolves.toHaveProperty("note");

    bridge.control.selectBuiltInDefaultForNewSessions();
    await expect(client.readSelectedProfile()).resolves.toMatchObject({
      profile: { id: "V1StGXR8Z5jd" },
    });

    const edited = `${profile.source}\nFixture edit`;
    const saved = await client.saveSelectedProfile({
      reference: profile.document.reference,
      expected: { state: "revision", revision: profile.document.revision },
      source: edited,
    });
    expect(saved).toMatchObject({ state: "saved" });
    if (saved.state !== "saved") throw new Error("Expected a saved result.");

    await expect(
      client.saveSelectedProfile({
        reference: profile.document.reference,
        expected: { state: "revision", revision: profile.document.revision },
        source: `${edited}\nStale edit`,
      }),
    ).resolves.toEqual({
      state: "refused",
      reason: "revision-conflict",
      currentRevision: saved.revision,
    });

    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(client.connection).toEqual({ state: "disconnected" });
  });

  it("auto-approves browser-first bootstrap and enforces absent creation", async () => {
    await using fixture = await createBridgeFixture();
    const { layout } = fixture;
    const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });
    bridge.control.selectBuiltInDefaultForNewSessions();
    const client = clientFor(bridge);

    await expect(client.connectFromLoopback()).resolves.toMatchObject({
      state: "connected",
    });
    const profile = await client.readSelectedProfile();
    expect(profile.document).toMatchObject({
      reference: "profile:default",
      state: "built-in-absent",
    });

    const request = {
      reference: profile.document.reference,
      expected: { state: "absent" },
      source: profile.source,
    } as const;
    const results = await Promise.all([
      client.saveSelectedProfile(request),
      client.saveSelectedProfile(request),
    ]);
    expect(results).toContainEqual(expect.objectContaining({ state: "saved" }));
    expect(results).toContainEqual(
      expect.objectContaining({
        state: "refused",
        reason: "document-exists",
      }),
    );
  });

  it("reports scripted conflicts, revocation, and version mismatch", async () => {
    await using fixture = await createBridgeFixture();
    const { layout } = fixture;
    const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });
    const client = clientFor(bridge);
    await client.connectFromFragment(
      `#zotlit-connect=${bridge.initialOneTimeCode}`,
    );
    const profile = await client.readSelectedProfile();
    if (profile.document.state !== "present") {
      throw new Error("Fixture Books Profile must have a document.");
    }

    bridge.control.conflictNextSave();
    await expect(
      client.saveSelectedProfile({
        reference: profile.document.reference,
        expected: { state: "revision", revision: profile.document.revision },
        source: profile.source,
      }),
    ).resolves.toMatchObject({
      state: "refused",
      reason: "revision-conflict",
    });

    const changed = await client.readSelectedProfile();
    if (changed.document.state !== "present") {
      throw new Error("Fixture Books Profile must have a document.");
    }
    await rm(join(layout.vaultDir, "templates", "zotlit-profile.books.md"));
    await expect(
      client.saveSelectedProfile({
        reference: changed.document.reference,
        expected: { state: "revision", revision: changed.document.revision },
        source: changed.source,
      }),
    ).resolves.toEqual({
      state: "refused",
      reason: "revision-conflict",
    });

    bridge.control.revokeSessions();
    await expect(client.loadSelectedItem()).rejects.toBeInstanceOf(
      LocalBridgeUnavailableError,
    );
    expect(client.connection).toEqual({
      state: "unavailable",
      reason: "revoked",
    });

    const incompatible = clientFor(bridge, { expectedBridgeVersion: 999 });
    bridge.control.allowNewSessions();
    const code = bridge.control.issueOneTimeCode();
    await expect(
      incompatible.connectFromFragment(`#zotlit-connect=${code}`),
    ).resolves.toEqual({
      state: "unavailable",
      reason: "version-mismatch",
      expected: { bridgeVersion: 999, templateDataContractVersion: 2 },
      received: {
        bridgeVersion: BRIDGE_VERSION,
        templateDataContractVersion: 2,
      },
    });
    await expect(incompatible.readTemplateSchema()).rejects.toBeInstanceOf(
      LocalBridgeUnavailableError,
    );
  });

  it("refuses incompatible and browser-unsupported Profile source", async () => {
    await using fixture = await createBridgeFixture();
    const bridge = createMockLocalBridge({
      layout: fixture.layout,
      allowedOrigin: ORIGIN,
    });
    const client = clientFor(bridge);
    await client.connectFromFragment(
      `#zotlit-connect=${bridge.initialOneTimeCode}`,
    );
    const profile = await client.readSelectedProfile();
    if (profile.document.state !== "present") {
      throw new Error("Fixture Books Profile must have a document.");
    }
    const document = profile.document;
    const save = (source: string) =>
      client.saveSelectedProfile({
        reference: document.reference,
        expected: { state: "revision", revision: document.revision },
        source,
      });

    await expect(
      save(profile.source.replace("contract: 2", "contract: 999")),
    ).resolves.toMatchObject({
      state: "refused",
      reason: "unsupported-profile",
    });
    await expect(
      save(
        profile.source.replace("contract: 2\n", "contract: 2\nlanguage: eta\n"),
      ),
    ).resolves.toMatchObject({
      state: "refused",
      reason: "unsupported-profile",
    });
    await expect(
      save(
        profile.source.replace(
          "frontmatter:\n",
          "frontmatter:\n  - key: scripted\n    js: zt.title\n",
        ),
      ),
    ).resolves.toMatchObject({
      state: "refused",
      reason: "unsupported-profile",
    });
    await expect(
      save(
        profile.source.replace(
          "frontmatter:\n",
          "partials:\n  - name: shared\n    language: eta\n    source: '<%= zt.title %>'\nfrontmatter:\n",
        ),
      ),
    ).resolves.toMatchObject({
      state: "refused",
      reason: "unsupported-profile",
    });
    await expect(
      save(
        profile.source.replace(
          "contract: 2\n",
          "contract: 2\nminAppVersion: 99.0.0\n",
        ),
      ),
    ).resolves.toMatchObject({
      state: "refused",
      reason: "unsupported-profile",
    });
  });

  it("bundles reachable dependencies and diagnoses unavailable ones", async () => {
    await using fixture = await createBridgeFixture();
    const bridge = createMockLocalBridge({
      layout: fixture.layout,
      allowedOrigin: ORIGIN,
    });
    const client = clientFor(bridge);
    await client.connectFromFragment(
      `#zotlit-connect=${bridge.initialOneTimeCode}`,
    );
    const profile = await client.readSelectedProfile();
    if (profile.document.state !== "present") {
      throw new Error("Fixture Books Profile must have a document.");
    }

    const withDependencies = profile.source
      .replace(
        "frontmatter:\n",
        `partials:
  - name: summary
    language: liquid
    source: "{% render 'cite' %}"
  - name: unused
    language: liquid
    source: Unused
frontmatter:\n`,
      )
      .replace("## Book details", "{% render 'summary' %}\n\n## Book details");
    const saved = await client.saveSelectedProfile({
      reference: profile.document.reference,
      expected: { state: "revision", revision: profile.document.revision },
      source: withDependencies,
    });
    expect(saved).toMatchObject({ state: "saved" });
    await expect(client.readTemplateDependencies()).resolves.toEqual({
      templates: [
        {
          name: "cite",
          language: "liquid",
          source: "{{ zt.citations | pandoc_cite }}\n",
        },
        {
          name: "summary",
          language: "liquid",
          source: "{% render 'cite' %}",
        },
      ],
      diagnostics: [],
    });

    if (saved.state !== "saved") throw new Error("Expected a saved result.");
    const missingDependency = withDependencies.replace(
      "{% render 'summary' %}",
      "{% render 'missing' %}",
    );
    await client.saveSelectedProfile({
      reference: profile.document.reference,
      expected: { state: "revision", revision: saved.revision },
      source: missingDependency,
    });
    await expect(client.readTemplateDependencies()).resolves.toMatchObject({
      templates: [],
      diagnostics: [
        {
          code: "missing-dependency",
          message: expect.stringContaining("missing"),
        },
      ],
    });

    const unsupportedDependency = withDependencies
      .replace("language: liquid", "language: eta")
      .replace("{% render 'cite' %}", "<%~ include('cite') %>");
    await writeFile(
      join(fixture.layout.vaultDir, "templates", "zotlit-profile.books.md"),
      unsupportedDependency,
      "utf8",
    );
    await expect(client.readTemplateDependencies()).resolves.toMatchObject({
      templates: [
        {
          name: "cite",
          language: "liquid",
          source: "{{ zt.citations | pandoc_cite }}\n",
        },
      ],
      diagnostics: [
        {
          code: "unsupported-dependency",
          message: expect.stringContaining("summary"),
        },
      ],
    });
  });

  it("serializes saves that start from the same Profile revision", async () => {
    await using fixture = await createBridgeFixture();
    const bridge = createMockLocalBridge({
      layout: fixture.layout,
      allowedOrigin: ORIGIN,
    });
    const client = clientFor(bridge);
    await client.connectFromFragment(
      `#zotlit-connect=${bridge.initialOneTimeCode}`,
    );
    const profile = await client.readSelectedProfile();
    if (profile.document.state !== "present") {
      throw new Error("Fixture Books Profile must have a document.");
    }
    const request = {
      reference: profile.document.reference,
      expected: { state: "revision", revision: profile.document.revision },
    } as const;
    const results = await Promise.all([
      client.saveSelectedProfile({
        ...request,
        source: `${profile.source}\nA`,
      }),
      client.saveSelectedProfile({
        ...request,
        source: `${profile.source}\nB`,
      }),
    ]);
    expect(results.filter(({ state }) => state === "saved")).toHaveLength(1);
    expect(results).toContainEqual(
      expect.objectContaining({
        state: "refused",
        reason: "revision-conflict",
      }),
    );
  });

  it("resolves a visible dependent CSL style through its hidden parent", async () => {
    await using fixture = await createBridgeFixture();
    const styles = join(fixture.layout.dataDir, "styles");
    await mkdir(join(styles, "hidden"), { recursive: true });
    await writeFile(join(styles, "dependent.csl"), DEPENDENT_STYLE, "utf8");
    await writeFile(join(styles, "hidden", "parent.csl"), PARENT_STYLE, "utf8");
    const bridge = createMockLocalBridge({
      layout: fixture.layout,
      allowedOrigin: ORIGIN,
    });
    const client = clientFor(bridge);
    await client.connectFromFragment(
      `#zotlit-connect=${bridge.initialOneTimeCode}`,
    );

    await expect(client.listCitationStyles()).resolves.toContainEqual({
      id: DEPENDENT_STYLE_ID,
      title: "Fixture dependent",
    });
    await expect(
      client.readSelectedCitationStyle({ styleId: DEPENDENT_STYLE_ID }),
    ).resolves.toMatchObject({
      kind: "installed",
      styleId: DEPENDENT_STYLE_ID,
      parentId: PARENT_STYLE_ID,
      locale: "de-DE",
      xml: expect.stringContaining('default-locale="de-DE"'),
    });
  });

  it("accepts only the approved Origin on a loopback host", async () => {
    await using fixture = await createBridgeFixture();
    const { layout } = fixture;
    const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });

    const wrongOrigin = await bridge.app.request(
      `${LOCAL_BRIDGE_ORIGIN}/v1/bootstrap/probe`,
      {
        method: "POST",
        headers: { Origin: "https://example.invalid" },
      },
    );
    expect(wrongOrigin.status).toBe(403);

    const nonLoopback = await bridge.app.request(
      "http://192.0.2.1:23120/v1/bootstrap/probe",
      { method: "POST", headers: { Origin: ORIGIN } },
    );
    expect(nonLoopback.status).toBe(403);
  });
});

function clientFor(
  bridge: ReturnType<typeof createMockLocalBridge>,
  options: {
    expectedBridgeVersion?: number;
    storage?: ReturnType<typeof memoryStorage>;
  } = {},
): LocalBridgeClient {
  return new LocalBridgeClient({
    baseUrl: LOCAL_BRIDGE_ORIGIN,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Origin", ORIGIN);
      return bridge.app.request(input, { ...init, headers });
    },
    storage: options.storage ?? memoryStorage(),
    compatibility: {
      bridgeVersion: options.expectedBridgeVersion ?? BRIDGE_VERSION,
      templateDataContractVersion: 2,
    },
  });
}

async function createBridgeFixture(): Promise<
  AsyncDisposable & { layout: ReturnType<typeof getFixtureLayout> }
> {
  const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
  const scratch = join(workspaceRoot, "tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "local-bridge-test-"));
  const layout = getFixtureLayout(root);
  await buildFixture(layout);
  return {
    layout,
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function memoryStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
