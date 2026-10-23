// Typed errors the template service raises: an inert JavaScript-Templates
// artifact an operation requires, a refused Shared Partial name, and a call to
// a Shared Partial the vault holds no document for. Also where an engine says
// a Template failed, as offsets into the source it read.

import { regex } from "arkregex";

import { MissingTemplateError } from "@zotlit/templates/facade";
import {
  renderFailureCause,
  renderFailureSpan,
} from "@zotlit/workbench/render";

import { Schema } from "@/lib/effect";

import type { PartialNameRefusal } from "./defaults";

/**
 * Thrown when an operation requires an artifact the JavaScript Templates gate
 * keeps inert: dispatching a render to a name whose winning file is an inert
 * `.eta.md`, or consuming the compiled frontmatter set while it excludes
 * `javascript`-language fields. The message is a localized user message naming
 * the artifact, ready to surface verbatim in operation failure toasts.
 */
export class InertTemplateError extends Error {
  readonly _tag = "InertTemplateError";
  /**
   * The inert Template's name. Absent in exactly one case: the inert artifact
   * is the managed-frontmatter field set, which is a field list rather than a
   * named Template (see `TemplateService.frontmatterFields`). Every failure
   * raised on a render path carries a name.
   */
  readonly templateName: string | undefined;

  constructor(message: string, templateName?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InertTemplateError";
    this.templateName = templateName;
  }
}

/**
 * Thrown when a name breaks the Shared Partial rule every entry point shares:
 * letters, digits, and hyphens, free of the reserved names, and unique in the
 * vault. Every entry point judges the name with `partialNameRefusal` before it
 * calls, so this is the service's last guard: the message reads in a log, and
 * `refusal` names the clause that refused.
 */
export class PartialNameError extends Error {
  readonly _tag = "PartialNameError";
  readonly partialName: string;
  readonly refusal: PartialNameRefusal;

  constructor(partialName: string, refusal: PartialNameRefusal) {
    super(`Refused the Shared Partial name '${partialName}': ${refusal}`);
    this.name = "PartialNameError";
    this.partialName = partialName;
    this.refusal = refusal;
  }
}

/**
 * A {@link MissingTemplateError} raised while a Profile document rendered,
 * carrying the vault path of the document whose call named the partial. The
 * refusal notice routes Open template workbench there, so the reader lands on
 * the call to repair rather than on the Default Profile.
 *
 * Subclasses rather than wraps, so every `instanceof MissingTemplateError`
 * reader — the Workbench diagnostic envelope, the preview, the notice — keeps
 * seeing the failure it already handles.
 */
export class MissingPartialError extends MissingTemplateError {
  readonly documentPath: string;

  constructor(documentPath: string, templateName: string, cause: unknown) {
    super(templateName, { cause });
    this.documentPath = documentPath;
  }
}

/** Where in a Template's source an engine stopped; `to` is exclusive. */
export interface EngineFaultSpan {
  readonly source: string;
  /** The registered Template name the engine named, when it named one. */
  readonly template?: string;
  readonly from: number;
  readonly to: number;
}

/** Eta writes `at line L col C`; liquidjs writes `line:L, col:C`. */
const ENGINE_POSITION = regex(
  "(?:at line (?<etaLine>\\d+) col (?<etaColumn>\\d+)|line:(?<liquidLine>\\d+), col:(?<liquidColumn>\\d+))",
);

/**
 * The span an engine reported for `error`. liquidjs carries the token it
 * stopped on, with the source it tokenized; Eta writes the line and column
 * into its message alone, so that position addresses `source`, the text the
 * caller compiled. Undefined where the engine named no position, such as a
 * JavaScript syntax error inside an Eta tag.
 */
export function engineFaultSpan(
  error: unknown,
  source?: string,
): EngineFaultSpan | undefined {
  const site = renderFailureSpan(error);
  if (site?.kind === "span") {
    const template = renderFailureCause(error)?.at?.template;
    return {
      source: site.source,
      ...(template === undefined ? {} : { template }),
      from: site.from,
      to: site.to,
    };
  }
  if (source === undefined || !(error instanceof Error)) return undefined;
  return reportedFaultSpan(error.message, source);
}

/**
 * The position an engine wrote into `message`, as a one-character span in
 * `source`, the text it compiled. Undefined where the message names none.
 */
export function reportedFaultSpan(
  message: string,
  source: string,
): EngineFaultSpan | undefined {
  const groups = ENGINE_POSITION.exec(message)?.groups;
  if (!groups) return undefined;
  const line = Number(groups.etaLine ?? groups.liquidLine);
  const column = Number(groups.etaColumn ?? groups.liquidColumn);
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return undefined;
  const lineStart = lines
    .slice(0, line - 1)
    .reduce((offset, text) => offset + text.length + 1, 0);
  const from = lineStart + Math.min(column - 1, lines[line - 1]!.length);
  return { source, from, to: Math.min(from + 1, source.length) };
}

/** A host operation failed at the Template service boundary. */
export class TemplateOperationError extends Schema.TaggedError<TemplateOperationError>()(
  "TemplateOperationError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

/** A template engine or a lazy render-data getter failed. */
export class TemplateRenderError extends Schema.TaggedError<TemplateRenderError>()(
  "TemplateRenderError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

/** Plain callers keep the original external exception and its diagnostic shape. */
export function plainTemplateError(error: unknown): unknown {
  return error instanceof TemplateOperationError ||
    error instanceof TemplateRenderError
    ? error.cause
    : error;
}
