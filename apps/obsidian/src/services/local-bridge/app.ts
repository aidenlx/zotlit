// The Local Bridge's routes on the Local Server: the gates every `/v1/*` path
// passes, the session lifecycle behind them, and the operations a connected
// page runs. No server lifecycle here, and no vault write of its own — the Save
// route hands the checked request to the write boundary in `save.ts`.

import type { Context } from "hono";
import { Hono } from "hono/tiny";
import * as v from "valibot";

import {
  codeBootstrapRequestSchema,
  disconnectRequestSchema,
  LOCAL_BRIDGE_PATHS,
  saveSelectedProfileRequestSchema,
  selectedCitationStyleRequestSchema,
  selectedItemRequestSchema,
  templateDependenciesRequestSchema,
} from "@zotlit/workbench/bridge";
import type { ConnectionGrant } from "@zotlit/workbench/bridge";

import { getLogger } from "@/lib/log";

import {
  ProfileDocumentMissingError,
  SelectedItemUnavailableError,
} from "./reads";
import type { LocalBridgeReads } from "./reads";
import type { LocalBridgeSave, LocalBridgeSaveOutcome } from "./save";
import type { BridgeConnection, BridgeSessions } from "./sessions";

const logger = getLogger("local-bridge");

/** The grant as it stands now, without the credential the page already holds. */
export type ConnectionGrantDescription = Omit<ConnectionGrant, "credential">;

/** Every `/v1/*` path lives under this prefix, gates included. */
const BRIDGE_PATH_PREFIX = "/v1";

export interface LocalBridgeAppDeps {
  /** `false` when this build excludes web Workbench integration. */
  available(): boolean;
  /** `false` while the web Template Workbench toggle is off — every path refuses. */
  enabled(): boolean;
  /** The peer's address, or `undefined` when the runtime cannot name it. */
  peerAddress(context: Context): string | undefined;
  /** The websites allowed to hold a connection; fixed in code, never a setting. */
  allowedOrigins: readonly string[];
  sessions: BridgeSessions;
  /** The vault data every read operation answers from. */
  reads: LocalBridgeReads;
  /** The write boundary one Save passes before the vault changes. */
  save: LocalBridgeSave;
  /** Reads the versions and bindings in effect now, which every grant carries. */
  describeGrant(
    connection: BridgeConnection,
  ): Promise<ConnectionGrantDescription>;
}

/**
 * What the gates resolved for a route behind them: the allow-listed website the
 * request came from, and — on every path but the code exchange — the connection
 * the bearer credential proves. A handler reads these with `context.get(...)`
 * rather than re-checking the header itself.
 */
export type BridgeEnv = {
  Variables: { origin: string; connection: BridgeConnection };
};

export function createLocalBridgeApp(
  deps: LocalBridgeAppDeps,
): Hono<BridgeEnv> {
  const app = new Hono<BridgeEnv>();

  app.use(`${BRIDGE_PATH_PREFIX}/*`, async (context, next) => {
    // A wider Live Update hostname must never widen the Workbench, so the peer
    // itself is checked rather than the address the listener bound.
    const peer = deps.peerAddress(context);
    if (!isLoopbackAddress(peer)) {
      return refuse(context, {
        status: 403,
        code: "loopback-required",
        message: "Connect from this computer.",
      });
    }
    const origin = context.req.header("Origin");
    if (origin === undefined || !deps.allowedOrigins.includes(origin)) {
      return refuse(context, {
        status: 403,
        code: "origin-refused",
        message: "This website Origin is not approved.",
      });
    }
    context.set("origin", origin);
    // Emitted for the allow-listed origin alone: a browser check is not an
    // authorization, and an origin that got this far still faces every gate.
    context.header("Access-Control-Allow-Origin", origin);
    context.header("Vary", "Origin");
    context.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    context.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (!deps.available()) {
      return refuse(context, {
        status: 403,
        code: "bridge-disabled",
        message: "The web Template Workbench is turned off in this vault.",
      });
    }
    if (context.req.method === "OPTIONS") return context.body(null, 204);

    if (
      new URL(context.req.url).pathname === LOCAL_BRIDGE_PATHS.codeBootstrap
    ) {
      // The one path that answers without a bearer credential: it issues one,
      // so the toggle is what it has to be measured against.
      if (!deps.enabled()) {
        return refuse(context, {
          status: 403,
          code: "bridge-disabled",
          message: "The web Template Workbench is turned off in this vault.",
        });
      }
      await next();
      return;
    }

    // Turning the Workbench off revokes the live connection, so a credential
    // and a toggle are one question: whether a session still stands. Answering
    // it as 401 is what tells the page to offer Open from Obsidian again.
    const connection = deps.sessions.authorize(
      bearerCredential(context.req.header("Authorization")),
    );
    if (connection === undefined || !deps.enabled()) {
      return refuse(context, {
        status: 401,
        code: "session-revoked",
        message: "The Workbench Connection is no longer available.",
      });
    }
    context.set("connection", connection);
    await next();
  });

  app.post(LOCAL_BRIDGE_PATHS.codeBootstrap, async (context) => {
    const request = await parseBody(
      context.req.raw,
      codeBootstrapRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    const connection = deps.sessions.exchange(
      request.output.code,
      context.get("origin"),
    );
    if (connection === undefined) {
      return refuse(context, {
        status: 401,
        code: "invalid-one-time-code",
        message: "The connection code is invalid, used, or expired.",
      });
    }
    logger.info("Workbench Connection opened");
    return context.json({
      credential: connection.credential,
      ...(await deps.describeGrant(connection)),
    });
  });

  app.get(LOCAL_BRIDGE_PATHS.resumeSession, async (context) => {
    // The bearer gate already refused a credential the plugin no longer holds,
    // so reaching here means the grant stands: answer with the versions and
    // bindings in effect now, which is what the page re-checks.
    logger.debug("Workbench Connection resumed");
    return context.json(await deps.describeGrant(context.get("connection")));
  });

  app.post(LOCAL_BRIDGE_PATHS.disconnect, async (context) => {
    const request = await parseBody(context.req.raw, disconnectRequestSchema);
    if (!request.success) return invalidRequest(context, request.issues);
    deps.sessions.disconnect(context.get("connection").credential);
    logger.info("Workbench Connection ended by the page");
    return context.json({});
  });

  app.get(LOCAL_BRIDGE_PATHS.templateSchema, (context) => {
    const schema = deps.reads.templateSchema();
    logger.debug("Answered a Local Bridge read", { operation: "schema" });
    return context.json(schema);
  });

  app.post(LOCAL_BRIDGE_PATHS.selectedItem, async (context) => {
    const request = await parseBody(context.req.raw, selectedItemRequestSchema);
    if (!request.success) return invalidRequest(context, request.issues);
    const item = context.get("connection").item;
    if (item === null) {
      // The launch chose no Item, and the grant already said so: the page
      // renders its own Sample Item rather than one this vault picked.
      return refuse(context, {
        status: 409,
        code: "no-selected-item",
        message: "This Workbench Connection has no selected Item.",
      });
    }
    try {
      const snapshot = await deps.reads.selectedItem(item);
      logger.debug("Answered a Local Bridge read", {
        operation: "selected-item",
        itemKey: item.key,
      });
      return context.json(snapshot);
    } catch (error) {
      if (!(error instanceof SelectedItemUnavailableError)) throw error;
      return refuse(context, {
        status: 409,
        code: "item-unavailable",
        message: "The selected Item is no longer in this library.",
      });
    }
  });

  app.get(LOCAL_BRIDGE_PATHS.selectedProfile, async (context) => {
    const profileId = context.get("connection").profileId;
    try {
      const selected = await deps.reads.selectedProfile(profileId);
      logger.debug("Answered a Local Bridge read", {
        operation: "selected-profile",
        profileId,
      });
      return context.json(selected);
    } catch (error) {
      if (!(error instanceof ProfileDocumentMissingError)) throw error;
      return refuse(context, {
        status: 409,
        code: "document-missing",
        message: "The selected Profile document no longer exists.",
      });
    }
  });

  app.post(LOCAL_BRIDGE_PATHS.templateDependencies, async (context) => {
    const request = await parseBody(
      context.req.raw,
      templateDependenciesRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    const dependencies = await deps.reads.templateDependencies(
      request.output.source,
    );
    logger.debug("Answered a Local Bridge read", { operation: "dependencies" });
    return context.json(dependencies);
  });

  app.get(LOCAL_BRIDGE_PATHS.citationStyles, async (context) => {
    const styles = await deps.reads.citationStyles();
    logger.debug("Answered a Local Bridge read", {
      operation: "citation-styles",
    });
    return context.json(styles);
  });

  app.post(LOCAL_BRIDGE_PATHS.selectedCitationStyle, async (context) => {
    const request = await parseBody(
      context.req.raw,
      selectedCitationStyleRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    const style = await deps.reads.selectedCitationStyle(request.output);
    logger.debug("Answered a Local Bridge read", {
      operation: "selected-citation-style",
    });
    return context.json(style);
  });

  app.post(LOCAL_BRIDGE_PATHS.saveSelectedProfile, async (context) => {
    const request = await parseBody(
      context.req.raw,
      saveSelectedProfileRequestSchema,
    );
    if (!request.success) return invalidRequest(context, request.issues);
    const profileId = context.get("connection").profileId;
    let outcome: LocalBridgeSaveOutcome;
    try {
      outcome = await deps.save.saveSelectedProfile(profileId, request.output);
    } catch (error) {
      if (!(error instanceof ProfileDocumentMissingError)) throw error;
      return refuse(context, {
        status: 409,
        code: "document-missing",
        message: "The selected Profile document no longer exists.",
      });
    }
    if (outcome.state === "reference-refused") {
      return refuse(context, {
        status: 403,
        code: "document-reference-refused",
        message: "The document reference is outside this Workbench Connection.",
      });
    }
    if (outcome.state === "refused") {
      // A refusal the contract names is the answer itself, so the page can tell
      // the user which check stopped the Save and keep the draft.
      logger.debug("Refused a Local Bridge Save", {
        operation: "selected-profile:save",
        profileId,
        reason: outcome.reason,
      });
      return context.json(outcome);
    }
    logger.debug("Saved a Profile document from the web Workbench", {
      operation: "selected-profile:save",
      profileId,
    });
    return context.json(outcome);
  });

  // A fault the routes do not name still answers the one error shape the page
  // parses, and the record carries only the operation and fixed failure reason.
  app.onError((_error, context) => {
    logger.error("A Local Bridge operation failed", {
      operation: context.req.routePath,
      reason: "operation-failed",
    });
    return refuse(context, {
      status: 500,
      code: "operation-failed",
      message: "This operation failed in the plugin.",
    });
  });

  return app;
}

/** Loopback covers every `127.0.0.0/8` address, `::1`, and their mapped forms. */
function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const plain = address.startsWith("::ffff:") ? address.slice(7) : address;
  return (
    plain === "::1" || plain === "0:0:0:0:0:0:0:1" || plain.startsWith("127.")
  );
}

function bearerCredential(header: string | undefined): string | undefined {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) ? header.slice(prefix.length) : undefined;
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
): Response {
  return refuse(context, {
    status: 400,
    code: "invalid-request",
    message: issues[0]?.message ?? "The request body is invalid.",
  });
}

/**
 * The contract's error shape, which every refusal answers with. The reason is
 * logged; the source, the snapshot, and the credential never are.
 */
function refuse(
  context: Context,
  error: {
    readonly status: 400 | 401 | 403 | 409 | 500;
    readonly code: string;
    readonly message: string;
  },
): Response {
  logger.debug("Refused a Local Bridge request", {
    operation: new URL(context.req.url).pathname,
    reason: error.code,
  });
  return context.json(
    { error: { code: error.code, message: error.message } },
    error.status,
  );
}
