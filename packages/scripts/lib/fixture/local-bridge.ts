// Fixture-backed Local Bridge used before the Obsidian listener exists.

import { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";
import type { Context } from "hono";
import { Hono } from "hono/tiny";
import { randomUUID } from "node:crypto";
import * as v from "valibot";

import { CONTRACT_VERSION } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import annotationSchema from "@zotlit/db/contract/annotation.schema.json" with { type: "json" };
import filenameSchema from "@zotlit/db/contract/filename.schema.json" with { type: "json" };
import noteSchema from "@zotlit/db/contract/note.schema.json" with { type: "json" };
import {
  BRIDGE_CAPABILITIES,
  BRIDGE_VERSION,
  codeBootstrapRequestSchema,
  disconnectRequestSchema,
  LOCAL_BRIDGE_PATHS,
  loopbackBootstrapRequestSchema,
  saveSelectedProfileRequestSchema,
  selectedCitationStyleRequestSchema,
  selectedItemRequestSchema,
} from "@zotlit/workbench/bridge";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";

import type { FixtureLayout } from "./layout.ts";
import {
  listFixtureCitationStyles,
  resolveFixtureCitationStyle,
} from "./local-bridge-csl.ts";
import {
  FixtureProfileStore,
  fixtureProfileIdentity,
} from "./local-bridge-profile.ts";
import type { SelectedFixtureProfile } from "./local-bridge-profile.ts";

if (globalThis.Temporal === undefined) {
  globalThis.Temporal =
    TemporalPolyfill as unknown as typeof globalThis.Temporal;
}

const FIXTURE_INSTALLATION_ID = "fixture-installation";
const FIXTURE_VAULT_NAME = "ZotLit Fixture";
const FIXTURE_SOURCE_ID = "fixture-zotero-source";
const FIXTURE_PLUGIN_VERSION = "2.1.1";
const FIXTURE_ITEM_KEY = "IANNP5A2";
const FIXTURE_ITEM_TITLE = "Why Most Published Research Findings Are False";
const FIXTURE_INITIAL_CODE = "fixture-code";

export interface MockLocalBridgeOptions {
  readonly layout: FixtureLayout;
  readonly allowedOrigin: string;
}

export interface MockLocalBridgeControl {
  selectBuiltInDefaultForNewSessions(): void;
  conflictNextSave(): void;
  revokeSessions(): void;
  allowNewSessions(): void;
  issueOneTimeCode(): string;
}

export interface MockLocalBridge {
  readonly app: Hono;
  readonly control: MockLocalBridgeControl;
  readonly initialOneTimeCode: string;
}

export function createMockLocalBridge(
  options: MockLocalBridgeOptions,
): MockLocalBridge {
  const app = new Hono();
  const credentials = new Map<string, SelectedFixtureProfile>();
  const oneTimeCodes = new Set([FIXTURE_INITIAL_CODE]);
  const profiles = new FixtureProfileStore(options.layout);
  let selectedProfile: SelectedFixtureProfile = "books";
  let sessionsRevoked = false;

  app.use("/v1/*", async (context, next) => {
    const url = new URL(context.req.url);
    if (!isLoopback(url.hostname)) {
      return bridgeError(context, {
        status: 403,
        code: "loopback-required",
        message: "Use a loopback host.",
      });
    }
    if (context.req.header("Origin") !== options.allowedOrigin) {
      return bridgeError(context, {
        status: 403,
        code: "origin-refused",
        message: "This website Origin is not approved.",
      });
    }
    context.header("Access-Control-Allow-Origin", options.allowedOrigin);
    context.header("Vary", "Origin");
    context.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    context.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (context.req.method === "OPTIONS") return context.body(null, 204);

    if (!url.pathname.startsWith("/v1/bootstrap/")) {
      const credential = bearerCredential(context.req.header("Authorization"));
      if (
        sessionsRevoked ||
        credential === undefined ||
        !credentials.has(credential)
      ) {
        return bridgeError(context, {
          status: 401,
          code: "session-revoked",
          message: "The Workbench Connection is no longer available.",
        });
      }
    }
    await next();
  });

  app.post(LOCAL_BRIDGE_PATHS.codeBootstrap, async (context) => {
    const request = await parseBody(
      context.req.raw,
      codeBootstrapRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    if (!oneTimeCodes.delete(request.output.code)) {
      return bridgeError(context, {
        status: 401,
        code: "invalid-one-time-code",
        message: "The one-time code is invalid or already used.",
      });
    }
    return context.json(issueConnection(credentials, selectedProfile));
  });

  app.post(LOCAL_BRIDGE_PATHS.loopbackBootstrap, async (context) => {
    const request = await parseBody(
      context.req.raw,
      loopbackBootstrapRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    return context.json({
      state: "approved" as const,
      connection: issueConnection(credentials, selectedProfile),
    });
  });

  app.post(LOCAL_BRIDGE_PATHS.disconnect, async (context) => {
    const request = await parseBody(context.req.raw, disconnectRequestSchema);
    if (!request.success) return invalidRequest(context, request.issues);
    const credential = bearerCredential(context.req.header("Authorization"));
    if (credential !== undefined) credentials.delete(credential);
    return context.json({});
  });

  app.get(LOCAL_BRIDGE_PATHS.templateSchema, (context) =>
    context.json({
      note: noteSchema,
      annotation: annotationSchema,
      filename: filenameSchema,
    }),
  );

  app.post(LOCAL_BRIDGE_PATHS.selectedItem, async (context) => {
    const request = await parseBody(context.req.raw, selectedItemRequestSchema);
    if (!request.success) return invalidRequest(context, request.issues);
    using resources = new DisposableStack();
    const client = resources.adopt(
      createClient(options.layout.databasePath, {
        connection: { readOnly: true },
      }),
      (value) => value.$client.close(),
    );
    return context.json(
      exportItemSnapshot(
        client,
        { library: { type: "personal" }, key: FIXTURE_ITEM_KEY },
        {
          provenance: {
            kind: "connected",
            installationId: FIXTURE_INSTALLATION_ID,
            vault: FIXTURE_VAULT_NAME,
          },
        },
      ),
    );
  });

  app.get(LOCAL_BRIDGE_PATHS.selectedProfile, async (context) => {
    const selected = await profiles.read(sessionProfile(context, credentials));
    if (selected.document.state === "missing") return documentMissing(context);
    return context.json(selected);
  });

  app.post(LOCAL_BRIDGE_PATHS.saveSelectedProfile, async (context) => {
    const request = await parseBody(
      context.req.raw,
      saveSelectedProfileRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    const result = await profiles.save(
      sessionProfile(context, credentials),
      request.output,
    );
    if (result.state === "reference-refused") {
      return bridgeError(context, {
        status: 403,
        code: "document-reference-refused",
        message: "The document reference is outside this Workbench Connection.",
      });
    }
    return context.json(result);
  });

  app.get(LOCAL_BRIDGE_PATHS.templateDependencies, async (context) => {
    const bundle = await profiles.readDependencies(
      sessionProfile(context, credentials),
    );
    return bundle === undefined
      ? documentMissing(context)
      : context.json(bundle);
  });

  app.get(LOCAL_BRIDGE_PATHS.citationStyles, async (context) =>
    context.json(await listFixtureCitationStyles(options.layout.dataDir)),
  );

  app.post(LOCAL_BRIDGE_PATHS.selectedCitationStyle, async (context) => {
    const request = await parseBody(
      context.req.raw,
      selectedCitationStyleRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    return context.json(
      await resolveFixtureCitationStyle(options.layout.dataDir, request.output),
    );
  });

  return {
    app,
    initialOneTimeCode: FIXTURE_INITIAL_CODE,
    control: {
      selectBuiltInDefaultForNewSessions() {
        selectedProfile = "default";
      },
      conflictNextSave() {
        profiles.conflictNextSave();
      },
      revokeSessions() {
        sessionsRevoked = true;
        credentials.clear();
      },
      allowNewSessions() {
        sessionsRevoked = false;
      },
      issueOneTimeCode() {
        const code = randomUUID();
        oneTimeCodes.add(code);
        return code;
      },
    },
  };
}

function issueConnection(
  credentials: Map<string, SelectedFixtureProfile>,
  selectedProfile: SelectedFixtureProfile,
) {
  const credential = randomUUID();
  credentials.set(credential, selectedProfile);
  return {
    credential,
    installation: {
      id: FIXTURE_INSTALLATION_ID,
      vault: FIXTURE_VAULT_NAME,
      zoteroSourceId: FIXTURE_SOURCE_ID,
    },
    pluginVersion: FIXTURE_PLUGIN_VERSION,
    bridgeVersion: BRIDGE_VERSION,
    templateDataContractVersion: CONTRACT_VERSION,
    capabilities: [...BRIDGE_CAPABILITIES],
    selectedItem: { key: FIXTURE_ITEM_KEY, title: FIXTURE_ITEM_TITLE },
    selectedProfile: fixtureProfileIdentity(selectedProfile),
  };
}

function bearerCredential(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) ? header.slice(prefix.length) : undefined;
}

function sessionProfile(
  context: Context,
  credentials: ReadonlyMap<string, SelectedFixtureProfile>,
): SelectedFixtureProfile {
  const credential = bearerCredential(context.req.header("Authorization"));
  const selected =
    credential === undefined ? undefined : credentials.get(credential);
  if (selected === undefined) {
    throw new Error("Authenticated route has no scoped session.");
  }
  return selected;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

async function parseBody<
  TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(request: Request, schema: TSchema): Promise<v.SafeParseResult<TSchema>> {
  try {
    return v.safeParse(schema, await request.json());
  } catch {
    return v.safeParse(schema, undefined);
  }
}

function invalidRequest(
  context: Context,
  issues: readonly v.BaseIssue<unknown>[],
) {
  return bridgeError(context, {
    status: 400,
    code: "invalid-request",
    message: issues[0]?.message ?? "The request body is invalid.",
  });
}

function documentMissing(context: Context) {
  return bridgeError(context, {
    status: 409,
    code: "document-missing",
    message: "The selected Profile document no longer exists.",
  });
}

function bridgeError(
  context: Context,
  error: {
    readonly status: 400 | 401 | 403 | 409;
    readonly code: string;
    readonly message: string;
  },
) {
  return context.json(
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}
