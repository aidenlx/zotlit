// Materializes the Resolved CSL Style a native Pandoc run cites with, the whole
// `zotlit:csl` contract.

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";

import { CONTRACT_VERSION } from "./contract";
import type { CslStyleFailure, ResolvedCslStyle } from "./styles";

const logger = getLogger(["pandoc", "csl"]);

/** The command every answer of this module names itself with. */
export const CSL_COMMAND = "zotlit:csl";

/** The device-wide store every materialized Resolved CSL Style stands in. */
const STORE_DIR = "zotlit-pandoc-csl";

const CSL_EXT = ".csl";

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
  | "csl-write-failed";

export interface CslError {
  code: CslErrorCode;
  /** The CSL ID the command was asked for. */
  styleId: string;
  /** CSL ID of the independent parent, when the requested style names one. */
  parentId?: string;
  message: string;
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
    }
  | { errors: CslError[] }
);

export interface CslPorts {
  /** The Resolved CSL Style of one installed CSL ID, from the shared resolver. */
  resolve: (styleId: string) => Promise<ResolvedCslStyle>;
  /**
   * Where the effective CSL content stands, as an absolute path.
   *
   * @default materializeCslStyle
   */
  materialize?: (xml: string) => Promise<string>;
}

/**
 * Resolve `styleId` to the absolute CSL file path citeproc opens, the whole
 * `zotlit:csl` contract. A native run carries no vault Citation Locale, so the
 * installed style keeps its own locale behavior.
 */
export async function resolveCslStyle(
  styleId: string,
  { resolve, materialize = materializeCslStyle }: CslPorts,
): Promise<CslResponse> {
  const style = await resolve(styleId);
  if (style.kind !== "installed") {
    return {
      contractVersion: CONTRACT_VERSION,
      command: CSL_COMMAND,
      errors: [
        style.kind === "failed"
          ? failure(style.reason, styleId, style.parentId)
          : failure("style-missing", styleId, undefined),
      ],
    };
  }

  let path: string;
  try {
    path = await materialize(style.xml);
  } catch (error) {
    logger.warn("Cannot materialize the Resolved CSL Style", {
      styleId,
      error,
    });
    return {
      contractVersion: CONTRACT_VERSION,
      command: CSL_COMMAND,
      errors: [
        {
          code: "csl-write-failed",
          styleId,
          parentId: style.parentId,
          message: `Cannot write the resolved CSL style of "${styleId}" to "${storeDirectory()}": ${describe(error)}. Restore write access to that directory, then run the command again.`,
        },
      ],
    };
  }
  logger.debug("Materialized the Resolved CSL Style", { styleId, path });
  return {
    contractVersion: CONTRACT_VERSION,
    command: CSL_COMMAND,
    styleId,
    parentId: style.parentId,
    path,
  };
}

/**
 * The absolute path the CSL content stands at, addressed by its own SHA-256:
 * identical content answers one path, and changed content answers another.
 *
 * The content is written under a private name and linked into place, so a run
 * reading the path never opens a half-written style, and content already
 * materialized is left exactly as it stands.
 */
export async function materializeCslStyle(
  xml: string,
  directory = storeDirectory(),
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const digest = createHash("sha256").update(xml).digest("hex");
  const path = join(directory, `${digest}${CSL_EXT}`);
  await using stack = new AsyncDisposableStack();
  const staging = stack.adopt(
    join(directory, `.${digest}-${randomUUID()}.part`),
    (file) =>
      rm(file, { force: true }).catch((error: unknown) => {
        logger.warn("Cannot remove a staged CSL style file", {
          staging: file,
          error,
        });
      }),
  );
  try {
    await writeFile(staging, xml, { flag: "wx" });
    await link(staging, path);
  } catch (error) {
    // The path already carries this exact content, which is the whole promise
    // a content address makes: another run materialized it first.
    if (!isErrno(error, "EEXIST")) throw error;
  }
  return path;
}

function storeDirectory(): string {
  return join(tmpdir(), STORE_DIR);
}

const MESSAGES: Record<
  Exclude<CslErrorCode, "csl-write-failed">,
  (styleId: string, parentId: string | undefined) => string
> = {
  "style-missing": (styleId) =>
    `Zotero has no installed CSL style carrying the ID "${styleId}". Install that style in Zotero, or correct the zotlit-csl property.`,
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

function failure(
  reason: CslStyleFailure,
  styleId: string,
  parentId: string | undefined,
): CslError {
  const code = CODES[reason];
  return {
    code,
    styleId,
    parentId,
    message: MESSAGES[code](styleId, parentId),
  };
}

function describe(error: unknown): string {
  return Error.isError(error) ? error.message : String(error);
}
