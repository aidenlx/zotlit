// Materializes the Resolved CSL Style a native Pandoc run cites with, the whole
// `zotlit:csl` contract.

import { Clock, Effect, FileSystem, PlatformError, Schema } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withLogCategory } from "@/lib/effect-log-category";

import { CONTRACT_VERSION } from "./contract";
import type {
  DocumentPresentationFailure,
  StyleSource,
} from "./document-presentation";
import type { CslStyleFailure, ResolvedCslStyle } from "./styles";

/** The command every answer of this module names itself with. */
export const CSL_COMMAND = "zotlit:csl";

/** The device-wide store every materialized Resolved CSL Style stands in. */
const STORE_DIR = "zotlit-pandoc-csl";

const CSL_EXT = ".csl";

/** Extension of a style still being written, under a private name. */
export const CSL_STAGING_EXT = ".part";

export type CslErrorCode =
  /** Zotero has no installed style carrying the requested CSL ID. */
  | "style-missing"
  /** The requested style is dependent, and its independent parent is not installed. */
  | "parent-missing"
  /** A CSL file the requested style is read from refuses to be read. */
  | "style-unreadable"
  /** The content behind the requested style is not a standalone CSL style. */
  | "style-invalid"
  /** The Resolved CSL Style could not be written to the materialization store. */
  | "csl-write-failed"
  /** The command was given a parameter it does not take, or neither `style` nor `file`, or both. */
  | "flags-invalid"
  /** No vault note stands at the `file` path. */
  | "file-not-found"
  /** The note's `zotlit-csl` property holds no style ID. */
  | "style-property-invalid"
  /** The note's `lang` property holds no language tag. */
  | "language-property-invalid"
  /** The Imported Note's Profile is unavailable, so it selects no style. */
  | "profile-unavailable";

export interface CslError {
  code: CslErrorCode;
  /** The CSL ID the command resolved, absent where no style was selected. */
  styleId?: string;
  /** CSL ID of the independent parent, when the requested style names one. */
  parentId?: string;
  message: string;
}

/** A failed materialization, carried to the CLI boundary with its style identity. */
export class CslWriteError extends Schema.TaggedError<CslWriteError>()(
  "CslWriteError",
  {
    styleId: Schema.String,
    parentId: Schema.UndefinedOr(Schema.String),
    cause: Schema.instanceOf(PlatformError.PlatformError),
  },
) {}

/** The JSON diagnostic the CLI emits for a typed write failure. */
export function cslWriteFailedResponse({
  styleId,
  parentId,
  cause,
}: CslWriteError): CslResponse {
  return errorResponse([
    {
      code: "csl-write-failed",
      styleId,
      parentId,
      message: `Cannot write the resolved CSL style of "${styleId}" to "${cslStoreDirectory()}": ${describe(cause)}. Restore write access to that directory, then run the command again.`,
    },
  ]);
}

/**
 * Either the Resolved CSL Style of the requested CSL ID as a file citeproc
 * opens, or every failure that stopped it. The two never appear together.
 */
export type CslResponse = {
  contractVersion: number;
  /** The namespace `contractVersion` belongs to (ADR 0026). */
  command: typeof CSL_COMMAND;
} & (
  | {
      /** The CSL ID that was requested, whichever file the content came from. */
      styleId: string;
      /** CSL ID of the independent parent, when the requested style is dependent. */
      parentId?: string;
      /** Absolute path of the materialized Resolved CSL Style. */
      path: string;
      /** The style's title, as Zotero lists it. */
      title: string;
      /** Where a `file` request found the style; absent for a `style` request. */
      source?: StyleSource;
    }
  | {
      /** A `file` request whose note selects the Pandoc default style. */
      styleId: null;
      source: StyleSource;
    }
  | { errors: CslError[] }
);

/** What one note selects, or the reason it selects nothing. */
export type DocumentStyleRead =
  | { kind: "read"; styleId: string | null; source: StyleSource }
  | { kind: "file-not-found" }
  | DocumentPresentationFailure;

export interface CslPorts {
  /** The Resolved CSL Style of one installed CSL ID, from the shared resolver. */
  resolve: (
    styleId: string,
  ) => Effect.Effect<ResolvedCslStyle, never, FileSystem.FileSystem>;
  /**
   * Where the effective CSL content stands, as an absolute path.
   *
   * @default materializeCslStyle
   */
  materialize?: (
    xml: string,
  ) => Effect.Effect<
    string,
    PlatformError.PlatformError,
    FileSystem.FileSystem
  >;
}

export interface DocumentCslPorts extends CslPorts {
  /** The style the note at an absolute path selects, as the app reads it. */
  readStyle: (absolutePath: string) => DocumentStyleRead;
}

/**
 * Resolve the style the note at `absolutePath` renders with in Obsidian — its
 * own `zotlit-csl`, its Profile's style, or the vault style — to the CSL file
 * citeproc opens. The answer names where the style came from, so the filter can
 * tell the reader which style the run uses.
 */
export const resolveDocumentCslStyle = Effect.fn("Csl.resolveDocument")(
  function* (
    absolutePath: string,
    ports: DocumentCslPorts,
  ): Effect.fn.Return<CslResponse, CslWriteError, FileSystem.FileSystem> {
    const read = ports.readStyle(absolutePath);
    if (read.kind === "file-not-found")
      return errorResponse([
        {
          code: "file-not-found",
          message: `No vault note at "${absolutePath}".`,
        },
      ]);
    if (read.kind === "unusable")
      return errorResponse([documentError(read, absolutePath)]);
    const { styleId, source } = read;
    yield* Effect.logDebug("Resolving the style one note selects").pipe(
      Effect.annotateLogs({
        path: absolutePath,
        styleId,
        source: source.kind,
      }),
    );
    if (styleId === null) {
      return {
        contractVersion: CONTRACT_VERSION,
        command: CSL_COMMAND,
        styleId: null,
        source,
      };
    }
    const response = yield* resolveCslStyle(styleId, ports, source);
    return "errors" in response ? response : { ...response, source };
  },
  withLogCategory("pandoc", "csl"),
);

function documentError(
  unusable: DocumentPresentationFailure,
  absolutePath: string,
): CslError {
  switch (unusable.property) {
    case "style":
      return {
        code: "style-property-invalid",
        message: `The zotlit-csl property of "${absolutePath}" holds no CSL style ID. Set it to the ID of a style installed in Zotero, or remove it.`,
      };
    case "language":
      return {
        code: "language-property-invalid",
        message: `The lang property of "${absolutePath}" holds no language tag. Set it to a tag such as en-US, or remove it.`,
      };
    case "profile":
      return {
        code: "profile-unavailable",
        message: `The profile of "${absolutePath}" is unavailable, so the note selects no style. Switch the note to an available profile in Obsidian.`,
      };
    case "profile-style":
      return failure("style-missing", {
        styleId: unusable.styleId,
        source: { kind: "profile", label: unusable.label },
      });
  }
}

function errorResponse(errors: CslError[]): CslResponse {
  return { contractVersion: CONTRACT_VERSION, command: CSL_COMMAND, errors };
}

/** The answer to a request that names neither flag, or both. */
export const CSL_SELECTOR_MESSAGE =
  'Pass exactly one of style="<csl-id>" or file="<absolute-path>".';

export function flagsInvalidResponse(message: string): CslResponse {
  return errorResponse([{ code: "flags-invalid", message }]);
}

/**
 * Resolve `styleId` to the absolute CSL file path citeproc opens, the whole
 * `zotlit:csl` contract. A native run carries no vault Citation Locale, so the
 * installed style keeps its own locale behavior.
 */
export const resolveCslStyle = Effect.fn("Csl.resolve")(
  function* (
    styleId: string,
    { resolve, materialize = materializeCslStyle }: CslPorts,
    source: StyleSource = { kind: "note" },
  ): Effect.fn.Return<CslResponse, CslWriteError, FileSystem.FileSystem> {
    const style = yield* resolve(styleId);
    if (style.kind !== "installed") {
      return errorResponse([
        style.kind === "failed"
          ? failure(style.reason, { styleId, parentId: style.parentId, source })
          : failure("style-missing", { styleId, source }),
      ]);
    }

    const path = yield* materialize(style.xml).pipe(
      Effect.mapError(
        (cause) =>
          new CslWriteError({
            styleId,
            parentId: style.parentId,
            cause,
          }),
      ),
    );
    yield* Effect.logDebug("Materialized the Resolved CSL Style").pipe(
      Effect.annotateLogs({
        styleId,
        path,
      }),
    );
    return {
      contractVersion: CONTRACT_VERSION,
      command: CSL_COMMAND,
      styleId,
      parentId: style.parentId,
      path,
      title: style.title,
    };
  },
  withLogCategory("pandoc", "csl"),
);

/**
 * The absolute path the CSL content stands at, addressed by its own SHA-256:
 * identical content answers one path, and changed content answers another.
 *
 * The content is written under a private name and linked into place, so a run
 * reading the path never opens a half-written style, and content already
 * materialized is left exactly as it stands.
 */
export const materializeCslStyle = Effect.fn("Csl.materialize")(
  function* (xml: string, directory = cslStoreDirectory()) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true });
    const digest = createHash("sha256").update(xml).digest("hex");
    const path = join(directory, `${digest}${CSL_EXT}`);
    const staging = join(
      directory,
      `.${digest}-${randomUUID()}${CSL_STAGING_EXT}`,
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          fs.remove(staging, { force: true }).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.logWarning("Cannot remove a staged CSL style file").pipe(
                Effect.annotateLogs({
                  staging,
                  error,
                }),
              ),
            ),
          ),
        );
        yield* fs.writeFileString(staging, xml, { flag: "wx" });
        // An existing content address already holds the complete style.
        yield* fs
          .link(staging, path)
          .pipe(
            Effect.catchReason("PlatformError", "AlreadyExists", () =>
              restamp(path),
            ),
          );
        return path;
      }),
    );
  },
  withLogCategory("pandoc", "csl"),
);

/**
 * Move the entry's timestamp to now, so the store reaper ages a style from its
 * last use rather than from its first materialization — a style still in use is
 * then never evicted out from under the Pandoc run about to open it.
 *
 * A failed restamp only costs an early eviction, and an early eviction only
 * costs one rewrite, so it never fails the resolve.
 */
const restamp = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const now = (yield* Clock.currentTimeMillis) / 1000;
  yield* fs.utimes(path, now, now).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.logDebug("Cannot restamp a materialized CSL style").pipe(
        Effect.annotateLogs({
          path,
          error,
        }),
      ),
    ),
  );
});

/**
 * The store both {@link materializeCslStyle} and the store reaper address, so
 * the layout rule stands in one place.
 *
 * @see reapCslStore
 */
export function cslStoreDirectory(parent = tmpdir()): string {
  return join(parent, STORE_DIR);
}

/** The place a reader corrects to select another style. */
function styleRepair(source: StyleSource): string {
  switch (source.kind) {
    case "note":
      return "correct the zotlit-csl property";
    case "profile":
      return `choose another citation and references style for the ${source.label ?? "default"} profile`;
    case "vault":
      return "choose another citation and references style in the ZotLit settings";
  }
}

const MESSAGES: Record<
  CslStyleFailureCode,
  (styleId: string, parentId: string | undefined, source: StyleSource) => string
> = {
  "style-missing": (styleId, _parentId, source) =>
    `Zotero has no installed CSL style carrying the ID "${styleId}". Install that style in Zotero, or ${styleRepair(source)}.`,
  "parent-missing": (styleId, parentId) =>
    `The CSL style "${styleId}" depends on "${parentId}", which Zotero has not installed. Reinstall "${styleId}" in Zotero so that it brings its independent parent.`,
  "style-unreadable": (styleId) =>
    `A CSL file the style "${styleId}" is read from refuses to be read. Restore read access to the Zotero styles directory, then run the command again.`,
  "style-invalid": (styleId) =>
    `The content behind the CSL style "${styleId}" is no standalone CSL style. Reinstall that style in Zotero.`,
};

/** The CLI code of one resolver failure, which names the repair it asks for. */
const CODES = {
  "style-missing": "style-missing",
  "parent-missing": "parent-missing",
  unreadable: "style-unreadable",
  invalid: "style-invalid",
} as const satisfies Record<CslStyleFailure, CslErrorCode>;

type CslStyleFailureCode = (typeof CODES)[CslStyleFailure];

function failure(
  reason: CslStyleFailure,
  {
    styleId,
    parentId,
    source,
  }: { styleId: string; parentId?: string; source: StyleSource },
): CslError {
  const code = CODES[reason];
  return {
    code,
    styleId,
    parentId,
    message: MESSAGES[code](styleId, parentId, source),
  };
}

function describe(error: unknown): string {
  return Error.isError(error) ? error.message : String(error);
}
