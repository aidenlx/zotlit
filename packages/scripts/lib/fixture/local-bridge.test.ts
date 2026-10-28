import { describe, it } from "@effect/vitest";
import type { ServerType } from "@hono/node-server";
import { Context, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import getPort from "get-port";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import {
  BRIDGE_VERSION,
  DOCS_DEV_SERVER_ORIGIN,
  LOCAL_BRIDGE_PATHS,
  LocalBridgeClient,
  LocalBridgeStorage,
  connectFragment,
  layerLocalBridgeClient,
  localBridgeOrigin,
} from "@zotlit/workbench/bridge";

import { buildFixture, FIXTURE_PARTIAL_NAME } from "./build.ts";
import { getFixtureLayout } from "./layout.ts";
import { startMockLocalBridge } from "./local-bridge-server.ts";
import { createMockLocalBridge } from "./local-bridge.ts";

import { getWorkspaceRoot } from "#package-roots";

const ORIGIN = "https://zotlit.aidenlx.site";
/** The Citation Template the Fixture Vault holds: the shipped default with the
 *  Spec's visible edit on the alternate branch. */
const FIXTURE_CITATION_SOURCE = `{% if zt.variant == "alt" %}
  cf. {{ zt.citations | pandoc_cite: "prefer-author-in-text" }}
{% else %}
  {{ zt.citations | pandoc_cite }}
{% endif %}
`;
/** The port a launch URL names, which the in-process app answers on. */
const PORT = 23_120;
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
const UNTITLED_STYLE_ID = "http://www.zotero.org/styles/fixture-untitled";
const UNTITLED_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><id>${UNTITLED_STYLE_ID}</id></info>
  <citation><layout><text variable="citation-number"/></layout></citation>
</style>`;

describe("LocalBridgeClient against the mock Local Bridge", () => {
  it.effect(
    "connects on the port the launch URL named, after a browser CORS preflight",
    () =>
      Effect.gen(function* () {
        const fixture = yield* bridgeFixture;
        const port = yield* Effect.promise(() => getPort());
        const bridge = yield* Effect.acquireRelease(
          Effect.sync(() =>
            startMockLocalBridge({
              layout: fixture.layout,
              allowedOrigin: ORIGIN,
              port,
            }),
          ),
          ({ server }) => Effect.promise(() => closeServer(server)),
        );

        const preflight = yield* HttpClient.execute(
          HttpClientRequest.make("OPTIONS")(
            `${localBridgeOrigin(port)}${LOCAL_BRIDGE_PATHS.codeBootstrap}`,
            {
              headers: {
                "Access-Control-Request-Headers": "content-type",
                "Access-Control-Request-Method": "POST",
              },
            },
          ),
        ).pipe(Effect.provide(browserHttp));
        expect(preflight.status).toBe(204);
        expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);

        const client = yield* clientOver(browserHttp);
        // Nothing but the fragment says where the bridge is: the page reaches
        // the listener on the port Obsidian bound for this launch.
        expect(
          yield* client.connectFromFragment(
            connectFragment(bridge.initialOneTimeCode, port),
          ),
        ).toMatchObject({
          state: "connected",
          installation: { vault: "ZotLit Fixture" },
        });
        expect(yield* client.readSelectedProfile).toMatchObject({
          profile: { name: "Books" },
          document: { state: "present" },
        });
      }),
  );

  it.effect(
    "exchanges a Connection code once, and refuses a reused or unknown one",
    () =>
      Effect.gen(function* () {
        const fixture = yield* bridgeFixture;
        const bridge = createMockLocalBridge({
          layout: fixture.layout,
          allowedOrigin: ORIGIN,
        });
        const code = bridge.control.issueOneTimeCode();

        expect(
          yield* (yield* clientFor(bridge)).connectFromFragment(
            connectFragment(code, PORT),
          ),
        ).toMatchObject({ state: "connected" });

        for (const refused of [code, "never-issued"]) {
          const client = yield* clientFor(bridge);
          expect(
            yield* Effect.flip(
              client.connectFromFragment(connectFragment(refused, PORT)),
            ),
          ).toMatchObject({
            _tag: "LocalBridgeStatusError",
            status: 401,
            code: "invalid-one-time-code",
          });
        }
      }),
  );

  it.effect("refuses a launch URL that names no port", () =>
    Effect.gen(function* () {
      const fixture = yield* bridgeFixture;
      const bridge = createMockLocalBridge({
        layout: fixture.layout,
        allowedOrigin: ORIGIN,
      });
      const client = yield* clientFor(bridge);

      expect(
        yield* Effect.flip(
          client.connectFromFragment(
            `#zotlit-connect=${bridge.initialOneTimeCode}`,
          ),
        ),
      ).toMatchObject({ _tag: "LocalBridgeDecodeError" });
    }),
  );

  it.effect(
    "allows the docs dev server by default, so a local page connects unflagged",
    () =>
      Effect.gen(function* () {
        const fixture = yield* bridgeFixture;
        const bridge = createMockLocalBridge({ layout: fixture.layout });

        const allowed = yield* Effect.promise(async () =>
          bridge.app.request(
            `${localBridgeOrigin(PORT)}${LOCAL_BRIDGE_PATHS.codeBootstrap}`,
            {
              method: "POST",
              headers: {
                Origin: DOCS_DEV_SERVER_ORIGIN,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ code: bridge.initialOneTimeCode }),
            },
          ),
        );
        expect(allowed.status).toBe(200);
      }),
  );

  it.effect("runs every approved operation over a code-bootstrap session", () =>
    Effect.gen(function* () {
      const { layout } = yield* bridgeFixture;
      const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });
      const storage = memoryStorage();
      const client = yield* clientFor(bridge, { storage });

      expect(
        yield* client.connectFromFragment(
          connectFragment(bridge.initialOneTimeCode, PORT),
        ),
      ).toMatchObject({
        state: "connected",
        installation: { id: "fixture-installation", vault: "ZotLit Fixture" },
        bridgeVersion: BRIDGE_VERSION,
        capabilities: expect.arrayContaining([
          "selected-item:read",
          "selected-profile:save",
        ]),
      });

      const schemas = yield* client.readTemplateSchema;
      expect(Object.keys(schemas)).toEqual(["note", "annotation", "filename"]);
      expect(schemas.note).toMatchObject({
        $id: "urn:zotlit:template-contract:v3:note",
      });

      const snapshot = yield* client.loadSelectedItem;
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

      const profile = yield* client.readSelectedProfile;
      expect(profile).toMatchObject({
        profile: { id: "V1StGXR8Z5jd", name: "Books" },
        document: { reference: "profile:V1StGXR8Z5jd", state: "present" },
      });
      if (profile.document.state !== "present") {
        throw new Error("Fixture Books Profile must have a document.");
      }

      const dependencies = yield* client.readTemplateDependencies({
        source: profile.source,
      });
      // The Fixture Books Profile calls the vault's own Shared Partial, which
      // the bundle resolves from the template folder.
      expect(dependencies.templates).toEqual([
        expect.objectContaining({ name: FIXTURE_PARTIAL_NAME }),
      ]);
      expect(dependencies.diagnostics).toEqual([]);
      expect(yield* client.listCitationStyles).toContainEqual({
        id: "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
        title: "China National Standard GB/T 7714-1987 (numeric, 中文)",
      });
      expect(
        yield* client.readSelectedCitationStyle({
          styleId: "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
          locale: "en-US",
        }),
      ).toMatchObject({
        kind: "installed",
        styleId: "http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
        locale: "en-US",
        xml: expect.stringContaining("<style"),
      });

      const restored = yield* clientFor(bridge, { storage });
      expect(yield* restored.readTemplateSchema).toHaveProperty("note");

      bridge.control.selectBuiltInDefaultForNewSessions();
      expect(yield* client.readSelectedProfile).toMatchObject({
        profile: { id: "V1StGXR8Z5jd" },
      });

      const edited = `${profile.source}\nFixture edit`;
      const saved = yield* client.saveSelectedProfile({
        reference: profile.document.reference,
        expected: { state: "revision", revision: profile.document.revision },
        source: edited,
      });
      expect(saved).toMatchObject({ state: "saved" });
      if (saved.state !== "saved") throw new Error("Expected a saved result.");

      expect(
        yield* client.saveSelectedProfile({
          reference: profile.document.reference,
          expected: { state: "revision", revision: profile.document.revision },
          source: `${edited}\nStale edit`,
        }),
      ).toEqual({
        state: "refused",
        reason: "revision-conflict",
        currentRevision: saved.revision,
      });

      yield* client.disconnect;
      expect((yield* client.current).connection).toEqual({
        state: "disconnected",
      });
    }),
  );

  it.effect("enforces absent creation of the built-in Default", () =>
    Effect.gen(function* () {
      const { layout } = yield* bridgeFixture;
      const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });
      bridge.control.selectBuiltInDefaultForNewSessions();
      const client = yield* clientFor(bridge);

      expect(
        yield* client.connectFromFragment(
          connectFragment(bridge.initialOneTimeCode, PORT),
        ),
      ).toMatchObject({ state: "connected" });
      const profile = yield* client.readSelectedProfile;
      expect(profile.document).toMatchObject({
        reference: "profile:default",
        state: "built-in-absent",
      });

      const request = {
        reference: profile.document.reference,
        expected: { state: "absent" },
        source: profile.source,
      } as const;
      const results = yield* Effect.all(
        [
          client.saveSelectedProfile(request),
          client.saveSelectedProfile(request),
        ],
        { concurrency: "unbounded" },
      );
      expect(results).toContainEqual(
        expect.objectContaining({ state: "saved" }),
      );
      expect(results).toContainEqual(
        expect.objectContaining({
          state: "refused",
          reason: "document-exists",
        }),
      );
    }),
  );

  it.effect(
    "reports scripted conflicts, revocation, and version mismatch",
    () =>
      Effect.gen(function* () {
        const { layout } = yield* bridgeFixture;
        const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });
        const client = yield* clientFor(bridge);
        yield* client.connectFromFragment(
          connectFragment(bridge.initialOneTimeCode, PORT),
        );
        const profile = yield* client.readSelectedProfile;
        if (profile.document.state !== "present") {
          throw new Error("Fixture Books Profile must have a document.");
        }

        bridge.control.conflictNextSave();
        expect(
          yield* client.saveSelectedProfile({
            reference: profile.document.reference,
            expected: {
              state: "revision",
              revision: profile.document.revision,
            },
            source: profile.source,
          }),
        ).toMatchObject({
          state: "refused",
          reason: "revision-conflict",
        });

        const changed = yield* client.readSelectedProfile;
        if (changed.document.state !== "present") {
          throw new Error("Fixture Books Profile must have a document.");
        }
        yield* Effect.promise(() =>
          rm(join(layout.vaultDir, "templates", "zotlit-profile.books.md")),
        );
        expect(
          yield* client.saveSelectedProfile({
            reference: changed.document.reference,
            expected: {
              state: "revision",
              revision: changed.document.revision,
            },
            source: changed.source,
          }),
        ).toEqual({
          state: "refused",
          reason: "revision-conflict",
        });

        bridge.control.revokeSessions();
        expect(yield* Effect.flip(client.loadSelectedItem)).toMatchObject({
          _tag: "LocalBridgeUnavailableError",
          reason: "revoked",
        });
        expect((yield* client.current).connection).toEqual({
          state: "unavailable",
          reason: "revoked",
        });

        const incompatible = yield* clientFor(bridge, {
          expectedBridgeVersion: 999,
        });
        bridge.control.allowNewSessions();
        const code = bridge.control.issueOneTimeCode();
        expect(
          yield* incompatible.connectFromFragment(connectFragment(code, PORT)),
        ).toEqual({
          state: "unavailable",
          reason: "version-mismatch",
          expected: {
            bridgeVersion: 999,
            templateDataContractVersion: CONTRACT_VERSION,
          },
          received: {
            bridgeVersion: BRIDGE_VERSION,
            templateDataContractVersion: CONTRACT_VERSION,
          },
        });
        expect(
          yield* Effect.flip(incompatible.readTemplateSchema),
        ).toMatchObject({
          _tag: "LocalBridgeUnavailableError",
          reason: "not-connected",
        });
      }),
  );

  it.effect("re-checks a kept credential against the bridge running now", () =>
    Effect.gen(function* () {
      const fixture = yield* bridgeFixture;
      const bridge = createMockLocalBridge({
        layout: fixture.layout,
        allowedOrigin: ORIGIN,
      });
      const storage = memoryStorage();
      const client = yield* clientFor(bridge, { storage });
      yield* client.connectFromFragment(
        connectFragment(bridge.initialOneTimeCode, PORT),
      );

      // The tab a reload or a lost connection left behind, holding the grant.
      const returning = yield* clientFor(bridge, { storage });
      expect(yield* returning.resume).toMatchObject({
        state: "connected",
        installation: { vault: "ZotLit Fixture" },
        // The vault's own binding defaults, which is what an unset binding
        // inherits rather than the plugin's built-in values.
        profileDefaults: {
          folder: "literatures",
          citationStyle: null,
          importFolder: "zotero_notes",
          importColoredHighlights: false,
          importAnnotationsAsTemplate: false,
        },
      });

      // A bridge that came back on another version is measured against this
      // page now, rather than accepted from the versions the grant was issued
      // under.
      bridge.control.reportBridgeVersion(BRIDGE_VERSION + 1);
      expect(yield* (yield* clientFor(bridge, { storage })).resume).toEqual({
        state: "unavailable",
        reason: "version-mismatch",
        expected: {
          bridgeVersion: BRIDGE_VERSION,
          templateDataContractVersion: CONTRACT_VERSION,
        },
        received: {
          bridgeVersion: BRIDGE_VERSION + 1,
          templateDataContractVersion: CONTRACT_VERSION,
        },
      });

      // A tab that kept no grant is left to bootstrap instead.
      expect(
        yield* (yield* clientFor(bridge, { storage: memoryStorage() })).resume,
      ).toBeNull();
    }),
  );

  it.effect("refuses incompatible and browser-unsupported Profile source", () =>
    Effect.gen(function* () {
      const fixture = yield* bridgeFixture;
      const bridge = createMockLocalBridge({
        layout: fixture.layout,
        allowedOrigin: ORIGIN,
      });
      const client = yield* clientFor(bridge);
      yield* client.connectFromFragment(
        connectFragment(bridge.initialOneTimeCode, PORT),
      );
      const profile = yield* client.readSelectedProfile;
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
      const refused = { state: "refused", reason: "unsupported-profile" };

      expect(
        yield* save(
          profile.source.replace(
            `contract: ${CONTRACT_VERSION}`,
            "contract: 999",
          ),
        ),
      ).toMatchObject(refused);
      expect(
        yield* save(
          profile.source.replace(
            `contract: ${CONTRACT_VERSION}\n`,
            `contract: ${CONTRACT_VERSION}\nlanguage: eta\n`,
          ),
        ),
      ).toMatchObject(refused);
      expect(
        yield* save(
          profile.source.replace(
            "frontmatter:\n",
            "frontmatter:\n  - key: scripted\n    js: zt.title\n",
          ),
        ),
      ).toMatchObject(refused);
      expect(
        yield* save(
          profile.source.replace(
            "frontmatter:\n",
            "partials:\n  - name: shared\n    language: eta\n    source: '<%= zt.title %>'\nfrontmatter:\n",
          ),
        ),
      ).toMatchObject(refused);
      expect(
        yield* save(
          profile.source.replace(
            `contract: ${CONTRACT_VERSION}\n`,
            `contract: ${CONTRACT_VERSION}\nminAppVersion: 99.0.0\n`,
          ),
        ),
      ).toMatchObject(refused);
    }),
  );

  it.effect(
    "bundles the draft's own dependencies and diagnoses unavailable ones",
    () =>
      Effect.gen(function* () {
        const fixture = yield* bridgeFixture;
        const bridge = createMockLocalBridge({
          layout: fixture.layout,
          allowedOrigin: ORIGIN,
        });
        const client = yield* clientFor(bridge);
        yield* client.connectFromFragment(
          connectFragment(bridge.initialOneTimeCode, PORT),
        );
        const profile = yield* client.readSelectedProfile;
        if (profile.document.state !== "present") {
          throw new Error("Fixture Books Profile must have a document.");
        }

        // The draft, never saved: the bundle answers the source the request
        // carries, so a preview matches the document on screen.
        const withDependencies = profile.source
          .replace(
            "frontmatter:\n",
            `partials:
  - name: summary
    language: liquid
    source: "{% render 'citation' %}"
  - name: unused
    language: liquid
    source: Unused
frontmatter:\n`,
          )
          .replace(
            "## Book details",
            "{% render 'summary' %}\n\n## Book details",
          );
        expect(
          yield* client.readTemplateDependencies({ source: withDependencies }),
        ).toEqual({
          templates: [
            expect.objectContaining({ name: FIXTURE_PARTIAL_NAME }),
            {
              name: "citation",
              language: "liquid",
              source: FIXTURE_CITATION_SOURCE,
            },
            {
              name: "summary",
              language: "liquid",
              source: "{% render 'citation' %}",
            },
          ],
          diagnostics: [],
        });
        // The saved file calls the vault's Shared Partial and nothing else,
        // which is what the draft added to.
        expect(
          yield* client.readTemplateDependencies({ source: profile.source }),
        ).toEqual({
          templates: [expect.objectContaining({ name: FIXTURE_PARTIAL_NAME })],
          diagnostics: [],
        });

        const missingDependency = withDependencies.replace(
          "{% render 'summary' %}",
          "{% render 'missing' %}",
        );
        expect(
          yield* client.readTemplateDependencies({ source: missingDependency }),
        ).toMatchObject({
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
          .replace("{% render 'citation' %}", "<%~ include('citation') %>");
        expect(
          yield* client.readTemplateDependencies({
            source: unsupportedDependency,
          }),
        ).toMatchObject({
          templates: [
            expect.objectContaining({ name: FIXTURE_PARTIAL_NAME }),
            {
              name: "citation",
              language: "liquid",
              source: FIXTURE_CITATION_SOURCE,
            },
          ],
          diagnostics: [
            {
              code: "unsupported-dependency",
              message: expect.stringContaining("summary"),
            },
          ],
        });
      }),
  );

  it.effect("refuses a Save the vault could not compile or resolve", () =>
    Effect.gen(function* () {
      const fixture = yield* bridgeFixture;
      const bridge = createMockLocalBridge({
        layout: fixture.layout,
        allowedOrigin: ORIGIN,
      });
      const client = yield* clientFor(bridge);
      yield* client.connectFromFragment(
        connectFragment(bridge.initialOneTimeCode, PORT),
      );
      const profile = yield* client.readSelectedProfile;
      if (profile.document.state !== "present") {
        throw new Error("Fixture Books Profile must have a document.");
      }
      const expected = {
        state: "revision",
        revision: profile.document.revision,
      } as const;

      // Liquid the engine cannot parse never reaches the file, so the vault is
      // left holding a Profile every later render can still run.
      expect(
        yield* client.saveSelectedProfile({
          reference: profile.document.reference,
          expected,
          source: `${profile.source}\n{% for %}`,
        }),
      ).toEqual({ state: "refused", reason: "invalid-source" });

      // A call no vault can answer is refused the same way the bundle reports
      // it.
      expect(
        yield* client.saveSelectedProfile({
          reference: profile.document.reference,
          expected,
          source: `${profile.source}\n{% render 'missing' %}`,
        }),
      ).toEqual({ state: "refused", reason: "invalid-source" });

      // Neither refusal wrote anything, so the revision the vault answers for
      // is the one both Saves were checked against.
      expect(yield* client.readSelectedProfile).toMatchObject({
        document: { revision: profile.document.revision },
      });
    }),
  );

  it.effect("serializes saves that start from the same Profile revision", () =>
    Effect.gen(function* () {
      const fixture = yield* bridgeFixture;
      const bridge = createMockLocalBridge({
        layout: fixture.layout,
        allowedOrigin: ORIGIN,
      });
      const client = yield* clientFor(bridge);
      yield* client.connectFromFragment(
        connectFragment(bridge.initialOneTimeCode, PORT),
      );
      const profile = yield* client.readSelectedProfile;
      if (profile.document.state !== "present") {
        throw new Error("Fixture Books Profile must have a document.");
      }
      const request = {
        reference: profile.document.reference,
        expected: { state: "revision", revision: profile.document.revision },
      } as const;
      const results = yield* Effect.all(
        [
          client.saveSelectedProfile({
            ...request,
            source: `${profile.source}\nA`,
          }),
          client.saveSelectedProfile({
            ...request,
            source: `${profile.source}\nB`,
          }),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.filter(({ state }) => state === "saved")).toHaveLength(1);
      expect(results).toContainEqual(
        expect.objectContaining({
          state: "refused",
          reason: "revision-conflict",
        }),
      );
    }),
  );

  it.effect(
    "resolves a visible dependent CSL style through its hidden parent",
    () =>
      Effect.gen(function* () {
        const fixture = yield* bridgeFixture;
        const styles = join(fixture.layout.dataDir, "styles");
        yield* Effect.promise(async () => {
          await mkdir(join(styles, "hidden"), { recursive: true });
          await writeFile(
            join(styles, "dependent.csl"),
            DEPENDENT_STYLE,
            "utf8",
          );
          await writeFile(
            join(styles, "hidden", "parent.csl"),
            PARENT_STYLE,
            "utf8",
          );
          await writeFile(
            join(styles, "my-private-draft.csl"),
            UNTITLED_STYLE,
            "utf8",
          );
        });
        const bridge = createMockLocalBridge({
          layout: fixture.layout,
          allowedOrigin: ORIGIN,
        });
        const client = yield* clientFor(bridge);
        yield* client.connectFromFragment(
          connectFragment(bridge.initialOneTimeCode, PORT),
        );

        const listed = yield* client.listCitationStyles;
        expect(listed).toContainEqual({
          id: DEPENDENT_STYLE_ID,
          title: "Fixture dependent",
        });
        // A style with no title lists under its ID; its file name stays on the
        // host.
        expect(listed).toContainEqual({
          id: UNTITLED_STYLE_ID,
          title: UNTITLED_STYLE_ID,
        });
        expect(
          yield* client.readSelectedCitationStyle({
            styleId: DEPENDENT_STYLE_ID,
          }),
        ).toMatchObject({
          kind: "installed",
          styleId: DEPENDENT_STYLE_ID,
          parentId: PARENT_STYLE_ID,
          locale: "de-DE",
          xml: expect.stringContaining('default-locale="de-DE"'),
        });
      }),
  );

  it.effect("accepts only the approved Origin on a loopback host", () =>
    Effect.gen(function* () {
      const { layout } = yield* bridgeFixture;
      const bridge = createMockLocalBridge({ layout, allowedOrigin: ORIGIN });

      const wrongOrigin = yield* Effect.promise(async () =>
        bridge.app.request(
          `${localBridgeOrigin(PORT)}${LOCAL_BRIDGE_PATHS.codeBootstrap}`,
          {
            method: "POST",
            headers: { Origin: "https://example.invalid" },
          },
        ),
      );
      expect(wrongOrigin.status).toBe(403);

      const nonLoopback = yield* Effect.promise(async () =>
        bridge.app.request(
          `http://192.0.2.1:${PORT}${LOCAL_BRIDGE_PATHS.codeBootstrap}`,
          { method: "POST", headers: { Origin: ORIGIN } },
        ),
      );
      expect(nonLoopback.status).toBe(403);
    }),
  );
});

/** HTTP over the network as a page on `ORIGIN` sends it. */
const browserHttp = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(
      FetchHttpClient.RequestInit,
      FetchHttpClient.RequestInit.of({ headers: { Origin: ORIGIN } }),
    ),
  ),
);

/**
 * A page's client over `http`, built in the test's Scope, keeping its grant in
 * `storage` and measured against `expectedBridgeVersion`.
 */
function clientOver(
  http: Layer.Layer<HttpClient.HttpClient>,
  options: {
    expectedBridgeVersion?: number;
    storage?: LocalBridgeStorage["Service"];
  } = {},
) {
  const layer = layerLocalBridgeClient({
    bridgeVersion: options.expectedBridgeVersion ?? BRIDGE_VERSION,
    templateDataContractVersion: CONTRACT_VERSION,
  }).pipe(
    Layer.provide([
      http,
      Layer.succeed(LocalBridgeStorage, options.storage ?? memoryStorage()),
    ]),
  );
  return Effect.map(Layer.build(layer), (context) =>
    Context.get(context, LocalBridgeClient),
  );
}

/** A page's client answered in process by the mock bridge's own app. */
function clientFor(
  bridge: ReturnType<typeof createMockLocalBridge>,
  options: Parameters<typeof clientOver>[1] = {},
) {
  const app: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", ORIGIN);
    return bridge.app.request(input, { ...init, headers });
  };
  return clientOver(
    FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, app)),
    ),
    options,
  );
}

/** A built Fixture in the workspace scratch, removed when the test ends. */
const bridgeFixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
    const scratch = join(workspaceRoot, ".scratch");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(join(scratch, "local-bridge-test-"));
    try {
      const layout = getFixtureLayout(root);
      await buildFixture(layout);
      return { root, layout };
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }),
  ({ root }) =>
    Effect.promise(() => rm(root, { recursive: true, force: true })),
);

/**
 * Shuts the loopback server down and waits for it: `close()` only stops new
 * connections, so the Fixture directory outlives every request still in flight.
 * Keep-alive sockets the browser client left open are ended first, which is
 * what lets `close()` settle at all.
 */
function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    if ("closeAllConnections" in server) server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function memoryStorage(): LocalBridgeStorage["Service"] {
  const values = new Map<string, string>();
  return LocalBridgeStorage.of({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  });
}
