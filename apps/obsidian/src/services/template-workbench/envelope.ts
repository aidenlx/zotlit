// The JSON envelope every Workbench command answers with, and its diagnostics.
//
// Diagnostic `message` and `hint` text stays literal English: `code` is the
// stable machine surface agent scripts read, the message is context for a human
// reading the transcript, and the hint is the recovery action the agent acts on.
// Command and flag help text is localized (see `register.ts`).

import type { ContractRoot, TemplateSlot } from "@zotlit/db";
import type {
  FrontmatterLanguage,
  FrontmatterMergeStrategy,
} from "@zotlit/templates/constants";
import { TemplateError } from "@zotlit/templates/facade";
import type { TemplateLanguage } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";

import { InertTemplateError } from "@/services/template/errors";
import { errorContext } from "@/services/template/service";
import type {
  CompileError,
  TemplateFileStatus,
} from "@/services/template/service";

import type { TemplateDataLoadResult } from "./data";
import type { SchemaAsset } from "./schema";

/**
 * The wire format of the `zotlit:template-*` and `zotlit:frontmatter-*`
 * commands, versioned on its own (ADR 0026). The value has stood since
 * 2.0.0-beta.4, when `@zotlit/db`'s `CONTRACT_VERSION` still stamped this
 * envelope as well.
 */
export const CONTRACT_VERSION = 2;

/** Identity of the vault and Zotero source a command answered from. */
export interface WorkbenchIdentity {
  vault: {
    name: string;
    /** Absolute path of the vault folder on this device. */
    path: string;
  };
  source: {
    id: string | null;
    databasePath: string;
  };
}

/**
 * The documented diagnostic codes of this CLI Contract, each defined with
 * the recovery action its diagnostic carries. This record is the single source
 * of both, so a new code arrives with its own hint.
 */
export const DIAGNOSTIC_HINTS = {
  INVALID_SELECTOR:
    "Correct the parameter named in details.parameter, then run the command again.",
  TARGET_MISMATCH:
    "Confirm the intended Zotero source with the user before you read or render again.",
  TEMPLATE_NOT_READY:
    "Run the command again after a short wait; when the message reports a failed start, ask the user to check the plugin log.",
  KEY_NOT_FOUND:
    "Select an Indexed Key that exists in the connected Zotero source.",
  NO_PARENT_ITEM:
    "Select the parent Item, or a child object that has a parent Item.",
  ANNOTATION_REQUIRED:
    "Select an Annotation key for the annotation root, or select another root.",
  ANNOTATION_ATTACHMENT_MISSING:
    "Open the Annotation in Zotero and confirm that its parent Attachment exists, then run the command again.",
  ETA_OPT_IN_REQUIRED:
    "Use a Liquid Template, or ask the user to enable JavaScript Templates in ZotLit settings.",
  TEMPLATE_COMPILE_ERROR:
    "Correct the syntax of the Template named in details.template, then render again.",
  TEMPLATE_RENDER_ERROR:
    "Read the message to find the failed expression, correct the Template or the selected object, then run the command again.",
  EXPRESSION_COMPILE_ERROR:
    "Correct the syntax of the expression named in expr, then evaluate it again.",
  RESERVED_KEY:
    "Choose a field key ZotLit does not manage; the reservedKeys list from frontmatter-status names every key that is off limits.",
  FIELD_NOT_FOUND:
    "Run frontmatter-status to see the configured keys, then use one of them.",
} as const satisfies Record<string, string>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  /** The recovery action for `code`, taken from `DIAGNOSTIC_HINTS`. */
  hint: string;
  details?:
    | { parameter: string }
    | { target: "source"; expected: string; actual: string | null }
    | { key: string }
    /** `context` is the liquidjs caret-annotated source excerpt, present when
     *  the underlying error carried one. */
    | { template: string; context?: string };
}

/**
 * Report a fault with the recovery action its code defines. Every diagnostic is
 * built here, so `hint` can never disagree with `code`.
 */
export function diagnostic(
  code: DiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  return { code, message, hint: DIAGNOSTIC_HINTS[code], details };
}

/** The commands the Workbench answers. */
export type WorkbenchCommand =
  | `zotlit:template-${
      | "status"
      | "data"
      | "schema"
      | "render"
      | "guide"
      | "source"}`
  | `zotlit:frontmatter-${"status" | "eval" | "set" | "remove" | "reorder"}`;

/** One configured Managed Frontmatter field, as `frontmatter-status` reports
 *  it: the raw configuration plus whether the JavaScript Templates gate
 *  currently leaves it inert. */
export type FrontmatterFieldRow = Pick<
  FrontmatterField,
  "key" | "expr" | "language" | "merge"
> & { inert: boolean };

/**
 * One frontmatter entry as `frontmatter-eval` reports it, in YAML write order:
 * a configured field's evaluated value, or a system field's item-derived
 * value. `language` and `merge` are `null` for a system field, which has
 * neither.
 */
export interface FrontmatterEvalRow {
  key: string;
  /** Absent when `error` is present, or when the field is `inert`. */
  value?: unknown;
  source: "system" | "user";
  language: FrontmatterLanguage | null;
  merge: FrontmatterMergeStrategy | null;
  /** `true` for a `"javascript"` field left uncompiled by the JavaScript
   *  Templates gate — the same marker `frontmatter-status` reports. */
  inert?: boolean;
  /** The field's expression raised this at evaluation time, in place of `value`. */
  error?: { message: string };
}

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
      /** The installed ZotLit version that answered the command. */
      pluginVersion?: string;
      /** Where each root's contract schema is published, keyed by root. */
      schemas?: Readonly<Record<ContractRoot, SchemaAsset>>;
      javascriptTemplatesEnabled?: boolean;
      templates?: readonly TemplateFileStatus[];
      /** The object a Template reads as `zt`. */
      zt?: unknown;
      markdown?: string;
      language?: TemplateLanguage;
      source?: string;
      /** Configured Managed Frontmatter fields, in configuration order. */
      fields?: readonly FrontmatterFieldRow[];
      /** Frontmatter keys the system owns; user expressions cannot target them. */
      reservedKeys?: readonly string[];
      /** `frontmatter-eval`'s set-mode rows, in YAML write order. */
      entries?: readonly FrontmatterEvalRow[];
      /** `frontmatter-eval`'s ad-hoc mode result. Absent when `error` is present. */
      value?: unknown;
      /** `frontmatter-eval`'s ad-hoc mode runtime error, in place of `value`. */
      error?: { message: string };
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

export function notSettledDiagnostic(timeoutMs: number): Diagnostic {
  return diagnostic(
    "TEMPLATE_NOT_READY",
    `Template compilation did not settle within ${timeoutMs} ms.`,
  );
}

export function initFailedDiagnostic(): Diagnostic {
  return diagnostic(
    "TEMPLATE_NOT_READY",
    "Template compilation failed to start; check the plugin log.",
  );
}

export function dataLoadDiagnostic(
  result: Exclude<TemplateDataLoadResult, { kind: "data" }>,
  key: string,
): Diagnostic {
  const code = {
    "not-found": "KEY_NOT_FOUND",
    "no-parent-item": "NO_PARENT_ITEM",
    "annotation-required": "ANNOTATION_REQUIRED",
    "annotation-attachment-missing": "ANNOTATION_ATTACHMENT_MISSING",
  } as const;
  return diagnostic(
    code[result.kind],
    result.kind === "not-found"
      ? `No Zotero object matches '${key}'.`
      : result.kind === "no-parent-item"
        ? `The Zotero object '${key}' has no parent Item.`
        : result.kind === "annotation-required"
          ? `The Zotero object '${key}' is not an Annotation.`
          : `The Annotation '${key}' has no parent Attachment row.`,
    { key },
  );
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
    compileErrors: ReadonlyMap<string, CompileError>;
  },
): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const named =
    error instanceof TemplateError || error instanceof InertTemplateError
      ? (error.templateName ?? options.template)
      : options.template;

  if (error instanceof InertTemplateError) {
    const details = named === null ? undefined : { template: named };
    return diagnostic("ETA_OPT_IN_REQUIRED", message, details);
  }

  const compileError =
    named === null ? undefined : options.compileErrors.get(named);
  if (compileError !== undefined) {
    return diagnostic(
      "TEMPLATE_COMPILE_ERROR",
      compileError.message,
      named === null
        ? undefined
        : { template: named, context: compileError.context },
    );
  }
  return diagnostic(
    "TEMPLATE_RENDER_ERROR",
    message,
    named === null
      ? undefined
      : { template: named, context: errorContext(error) },
  );
}
