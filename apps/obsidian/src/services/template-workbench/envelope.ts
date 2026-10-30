import type { ContractRoot } from "@zotlit/db";
import type {
  FrontmatterLanguage,
  FrontmatterMergeStrategy,
} from "@zotlit/templates/constants";
// The JSON envelope every Workbench command answers with, and its diagnostics.
//
// Diagnostic `message` and `hint` text stays literal English: `code` is the
// stable machine surface agent scripts read, the message is context for a human
// reading the transcript, and the hint is the recovery action the agent acts on.
// Command and flag help text is localized (see `register.ts`).
import { MissingTemplateError, TemplateError } from "@zotlit/templates/facade";
import type { TemplateLanguage } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";

import { createRenderedCliDiagnostics, lineColumn } from "@/lib/cli-diagnostic";
import type { FaultFacts, RenderedDiagnostic } from "@/lib/cli-diagnostic";
import { UNKNOWN_PROFILE_HINT } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import type { ProfileDiagnostic } from "@/services/profile/service";
import {
  engineFaultSpan,
  InertTemplateError,
} from "@/services/template/errors";
import type { EngineFaultSpan } from "@/services/template/errors";
import type {
  CompileError,
  TemplateFileStatus,
} from "@/services/template/service";

import type { TemplateDataLoadResult } from "./data";
import type { SchemaAsset } from "./schema";
import type { RenderTemplate } from "./vocabulary";

/**
 * The wire format of the `zotlit:template-*` and `zotlit:frontmatter-*`
 * commands, versioned on its own (ADR 0026). Version 5 reports each Profile
 * row's `id` as a `ProfileSelector` (`"default"` for the built-in default
 * Profile) instead of `null`. Version 6 adds complete Profile checking and
 * retained attempt evidence with disclosure-independent component statuses.
 * Version 7 retires legacy authoring commands in favor of document checks, and
 * carries the refused document identities and the two refusal answer shapes
 * that ADR 0058 added to it while it was still unreleased. A refusal added to a
 * published contract moves the version instead. Version 8 gives every
 * diagnostic the Diagnostic Report of the Item Query CLI (ADR 0070):
 * `severity`, `report`, `location`, `excerpt`, `found`, `expected`, and
 * `suggestions`, with `hint` the most specific recovery action.
 */
export const CONTRACT_VERSION = 8;

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
  COMMAND_RETIRED:
    "Use ZotLit's legacy template conversion in settings, then edit the Template Document directly. Use template-inspect to select it, template-data for optional field discovery, and template-check to verify the result. Retained legacy records are managed by the conversion workflow.",
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
  DOCUMENT_NOT_FOUND:
    "Restore the referenced document, select another document, or provide a source override.",
  UNKNOWN_PROFILE_STAMP: UNKNOWN_PROFILE_HINT,
  DUPLICATE_MANAGED_BLOCK:
    "Keep at most one Managed Block in the document, then render it again.",
  MISSING_ANNOTATION_SECTION:
    "Add one standalone --- zotlit:annotation --- line after the note source. Its annotation source extends to EOF and can be empty; template-source template=annotation provides the built-in Liquid source.",
  DUPLICATE_ANNOTATION_SECTION:
    "Keep one --- zotlit:annotation --- header, followed by the annotation source through EOF.",
  UNKNOWN_SECTION_HEADER:
    "Use the exact standalone --- zotlit:annotation --- header. The note source starts after the manifest.",
  RESERVED_ANNOTATION_PARTIAL:
    "Rename the manifest partial named 'annotation' and update its calls. The Annotation Section supplies Profile annotation rendering.",
  DOCUMENT_INVALID:
    "Correct the document validation error, then inspect or render it again.",
  RESERVED_PARTIAL_NAME:
    "Rename the Shared Partial file to a name ZotLit does not already use. 'citation' names the Citation Template, and 'filename', 'note', 'annotation', and 'content' name the Literature Note Template slots.",
  MISSING_PARTIAL:
    "Create zotlit-partial.<name>.md in the template folder for the partial named in details.template, or correct the name the template calls.",
  BUNDLED_PARTIAL:
    "The partial named in details.template is still carried in a Profile document's manifest. Open that document in the Template Workbench and run Unpack partials, which writes zotlit-partial.<name>.md and clears the manifest entry.",
} as const satisfies Record<string, string>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_HINTS;

/**
 * A failure, as the Diagnostic Report every rendered `zotlit:*` namespace
 * shares. `hint` is the recovery action to follow: the most specific one the
 * fault gives, else `DIAGNOSTIC_HINTS[code]`, which then stays the last line
 * of `report`.
 */
export interface Diagnostic extends RenderedDiagnostic<DiagnosticCode> {
  details?:
    | { parameter: string }
    | { target: "source"; expected: string; actual: string | null }
    | { key: string }
    /** `line` and `column` are 1-based in the source the report names on
     *  its `-->` line. `context` repeats the excerpt and caret lines of
     *  `report` for version-7 readers. */
    | { template: string; line?: number; column?: number; context?: string };
}

const rendered = createRenderedCliDiagnostics<
  typeof DIAGNOSTIC_HINTS,
  Diagnostic["details"]
>(DIAGNOSTIC_HINTS, "INVALID_SELECTOR");

/** Report a fault with the recovery action registered for its code. */
export function diagnostic(
  code: DiagnosticCode,
  message: string,
  details?: Diagnostic["details"],
): Diagnostic {
  return rendered.diagnostic(code, message, details);
}

/**
 * Report a fault with the facts a more specific report reads: a span in a
 * source, a path, or a more specific recovery action.
 */
export function faultDiagnostic(
  code: DiagnosticCode,
  message: string,
  facts: FaultFacts & { details?: Diagnostic["details"] },
): Diagnostic {
  return rendered.faultDiagnostic(code, message, facts);
}

export const { rejectionDiagnostic } = rendered;

/** The commands the Workbench answers. */
export type WorkbenchCommand =
  | `zotlit:template-${
      | "status"
      | "data"
      | "schema"
      | "render"
      | "document-render"
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

/** One Profile row in template-status. */
export interface LiteratureNoteProfileRow {
  id: ProfileSelector;
  label: string;
  document: string | null;
  bindings?: ResolvedLiteratureNoteProfileBindings;
}

/** One installed or referenced Literature Note Template document. */
export interface LiteratureNoteDocumentRow {
  reference: string;
  path: string | null;
  validation:
    | {
        state: "valid";
        manifest: object;
        hasManagedBlock: boolean;
      }
    | { state: "invalid" | "missing"; diagnostic: Diagnostic };
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
      profiles?: readonly LiteratureNoteProfileRow[];
      profileDiagnostics?: readonly ProfileDiagnostic[];
      documents?: readonly LiteratureNoteDocumentRow[];
      /** The object a Template reads as `zt`. */
      zt?: unknown;
      discovery?: object;
      markdown?: string;
      render?: { create: string; update: string | null };
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
 * @param template - The Template the render command invoked: a Legacy
 *   Template File slot, or the Citation Template. The data command passes
 *   `null`: reading a data root runs no Template of its own, so
 *   `details.template` then appears only when the error itself names one (see
 *   the label the annotation root's citation getter attaches).
 */
export function templateFaultDiagnostic(
  error: unknown,
  options: {
    template: RenderTemplate | null;
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

  // The engine reached a name nothing is registered under, which for a
  // template is a Shared Partial the vault holds no document for.
  if (error instanceof MissingTemplateError) {
    return missingPartialDiagnostic(error.templateName, message);
  }

  const compileError =
    named === null ? undefined : options.compileErrors.get(named);
  if (compileError !== undefined) {
    return sourceFaultDiagnostic("TEMPLATE_COMPILE_ERROR", {
      message: compileError.message,
      template: named,
      at: compileError.at,
      action: (where) => `Correct the syntax at ${where}, then render again.`,
    });
  }
  return sourceFaultDiagnostic("TEMPLATE_RENDER_ERROR", {
    message,
    template: named,
    at: engineFaultSpan(error),
    action: (where, found) =>
      `Correct ${JSON.stringify(found)} at ${where}, or the selected object, then run the command again.`,
  });
}

/**
 * A Template fault at the span the engine reported: the report excerpts the
 * span's line, `details` names the Template, line, and column, and `hint`
 * names the place to correct.
 */
function sourceFaultDiagnostic(
  code: "TEMPLATE_COMPILE_ERROR" | "TEMPLATE_RENDER_ERROR",
  fault: {
    message: string;
    template: string | null;
    at: EngineFaultSpan | undefined;
    action: (where: string, found: string) => string;
  },
): Diagnostic {
  const { template, at } = fault;
  if (at === undefined) {
    return diagnostic(
      code,
      fault.message,
      template === null ? undefined : { template },
    );
  }
  // A fault inside a called template is in that template's source, which the
  // engine names; the report names the source its excerpt and line come from.
  const name = at.template ?? template ?? "template";
  const { line, column } = lineColumn(at.source, at.from);
  const found = at.source.slice(at.from, at.to);
  // The engine's own excerpt follows its first line; the report draws it.
  const message = fault.message.split("\n")[0]!.replace(/:$/, ".");
  const value = faultDiagnostic(code, message, {
    hint: fault.action(`${name}:${line}:${column}`, found),
    at: { source: at.source, span: { from: at.from, to: at.to }, name },
  });
  return {
    ...value,
    details: {
      template: template ?? name,
      line,
      column,
      context: value.report.slice(2, 4).join("\n"),
    },
  };
}

/** A call to a Shared Partial the vault holds no document for. */
export function missingPartialDiagnostic(
  name: string,
  message: string,
): Diagnostic {
  return faultDiagnostic("MISSING_PARTIAL", message, {
    details: { template: name },
    hint: `Create zotlit-partial.${name}.md in the template folder, or correct the name '${name}' that the template calls.`,
  });
}
