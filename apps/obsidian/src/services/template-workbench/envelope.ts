// The JSON envelope every Workbench command answers with, and its diagnostics.
//
// Diagnostic `message` text stays literal English: `code` is the stable machine
// surface agent scripts read, and the message is context for a human reading
// the transcript. Command and flag help text is localized (see `register.ts`).

import { CONTRACT_VERSION, type TemplateSlot } from "@zotlit/db";
import { TemplateError } from "@zotlit/templates/facade";

import { InertTemplateError } from "@/services/template/errors";
import { type TemplateFileStatus } from "@/services/template/service";

import { type TemplateDataLoadResult } from "./data";

/** Identity of the vault and Zotero source a command answered from. */
export interface WorkbenchIdentity {
  vault: {
    id: string;
    path: string;
  };
  source: {
    id: string | null;
    databasePath: string;
  };
}

/** The nine documented diagnostic codes of contract version 1. */
export type DiagnosticCode =
  | "INVALID_SELECTOR"
  | "TARGET_MISMATCH"
  | "TEMPLATE_NOT_READY"
  | "KEY_NOT_FOUND"
  | "NO_PARENT_ITEM"
  | "ANNOTATION_REQUIRED"
  | "ETA_OPT_IN_REQUIRED"
  | "TEMPLATE_COMPILE_ERROR"
  | "TEMPLATE_RENDER_ERROR";

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  details?:
    | { parameter: string }
    | { target: "vault" | "source"; expected: string; actual: string | null }
    | { key: string }
    | { template: string };
}

/** Reserved by contract version 1: `warnings` is documented, always present on
 *  a render response, and always empty. */
export const NO_WARNINGS: readonly string[] = [];

/** The four commands the Workbench answers. */
export type WorkbenchCommand = `zotlit:template-${
  | "status"
  | "data"
  | "schema"
  | "render"}`;

/** The facts a command echoes back beside its result, all optional because a
 *  selector-level failure is answered before any of them is resolved. */
interface EnvelopeFacts {
  request?: object;
  identity?: WorkbenchIdentity;
  template?: object;
  warnings?: readonly string[];
}

/**
 * Everything an envelope carries after `contractVersion` and `command`. `ok`
 * discriminates, so a failure cannot carry a result and a result cannot carry
 * a diagnostic. Field order is the literal's own order, so each call site
 * lists its fields in the order the contract documents them.
 */
export type EnvelopeTail =
  | (EnvelopeFacts & { ok: false; diagnostic: Diagnostic })
  | (EnvelopeFacts & {
      ok: true;
      javascriptTemplatesEnabled?: boolean;
      templates?: readonly TemplateFileStatus[];
      data?: unknown;
      markdown?: string;
    });

export function envelope(
  command: WorkbenchCommand,
  tail: EnvelopeTail,
): string {
  return json({ contractVersion: CONTRACT_VERSION, command, ...tail });
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function invalidSelectorDiagnostic(
  parameter: string,
  message: string,
): Diagnostic {
  return { code: "INVALID_SELECTOR", message, details: { parameter } };
}

export function notSettledDiagnostic(timeoutMs: number): Diagnostic {
  return {
    code: "TEMPLATE_NOT_READY",
    message: `Template compilation did not settle within ${timeoutMs} ms.`,
  };
}

export function initFailedDiagnostic(): Diagnostic {
  return {
    code: "TEMPLATE_NOT_READY",
    message: "Template compilation failed to start; check the plugin log.",
  };
}

export function dataLoadDiagnostic(
  result: Exclude<TemplateDataLoadResult, { kind: "data" }>,
  key: string,
): Diagnostic {
  const code = {
    "not-found": "KEY_NOT_FOUND",
    "no-parent-item": "NO_PARENT_ITEM",
    "annotation-required": "ANNOTATION_REQUIRED",
  } as const;
  return {
    code: code[result.kind],
    message:
      result.kind === "not-found"
        ? `No Zotero object matches '${key}'.`
        : result.kind === "no-parent-item"
          ? `The Zotero object '${key}' has no parent Item.`
          : `The Zotero object '${key}' is not an Annotation.`,
    details: { key },
  };
}

/**
 * Classify a fault raised while a command evaluated Template data or rendered
 * a Template.
 *
 * @param template - The slot the render command invoked. The data command
 *   passes `null`: reading a data root runs no Template of its own, so
 *   `details.template` then appears only when the error itself names one (see
 *   the `cite` label the annotation root's citation getter attaches).
 */
export function templateFaultDiagnostic(
  error: unknown,
  options: {
    template: TemplateSlot | null;
    compileErrors: ReadonlyMap<string, string>;
  },
): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const named =
    error instanceof TemplateError || error instanceof InertTemplateError
      ? (error.templateName ?? options.template)
      : options.template;
  const details = named === null ? undefined : { template: named };

  if (error instanceof InertTemplateError) {
    return { code: "ETA_OPT_IN_REQUIRED", message, details };
  }

  const compileError =
    named === null ? undefined : options.compileErrors.get(named);
  if (compileError !== undefined) {
    return { code: "TEMPLATE_COMPILE_ERROR", message: compileError, details };
  }
  return { code: "TEMPLATE_RENDER_ERROR", message, details };
}
