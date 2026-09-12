// The error report one failed render is copied as. Both hosts read the same
// record through the same serializer, so Technical details shows exactly the
// text Copy error report puts on the clipboard.
//
// The evidence is taken at the failure boundary, before a diagnostic reduces
// the engine's error to one message, and it is paired with the attempt that
// produced it. Nothing here reads live application state: a report describes
// the attempt it was captured from and stays readable after later edits,
// selection changes, and other previews.
//
// A document the parser refuses is a failure of the same kind with no engine
// behind it, so it is reported through the same record and the same text:
// what it does have is captured, and the rest is marked unavailable.

import type { WorkbenchProblem } from "#/document/controller";

import type {
  RenderCaller,
  RenderDiagnostic,
  RenderEngineLocation,
  RenderIdentity,
} from "./result";
import { templateSourceRevision } from "./result";

/** What a report says where the failed attempt could supply no value. */
export const REPORT_UNAVAILABLE = "unavailable";

/**
 * The engine's own account of one failure, kept whole. Eta wraps rather than
 * subclasses and liquidjs links its cause non-enumerably, so the chain behind
 * the thrown error carries detail the outermost message alone does not.
 *
 * A document problem has no engine behind it: the parser's own condition takes
 * the message, the text it named takes the reported location, and the fields
 * only a thrown error can fill stay absent.
 */
export interface EngineEvidence {
  /** The outermost error's message, exactly as the engine wrote it. */
  readonly message: string;
  /** The outermost error's name, which Eta copies from the error it wrapped. */
  readonly name?: string;
  readonly stack?: string;
  /** Every further message in the chain, outermost first. */
  readonly causes?: readonly string[];
  /** The caret-annotated source excerpt an engine attached to its error. */
  readonly context?: string;
  /** The template, line, or column the engine itself named. */
  readonly reportedLocation?: string;
}

/**
 * What names the Workbench a failure happened in. Each host answers for its
 * own document, preview root, selection, and versions; a value it cannot
 * supply is left out and reported as unavailable.
 */
export interface WorkbenchReportContext {
  /** The Template Document the attempt rendered — a vault path or a draft reference. */
  readonly document?: string;
  /** The template language that document declares. */
  readonly language?: string;
  /** What the preview rendered — a Literature Note, an Annotation, Citation text, a Shared Partial. */
  readonly root?: string;
  /** The Zotero Item, Annotation, or built-in example the render read. */
  readonly selection?: string;
  readonly zotlitVersion?: string;
  /** The application around the Workbench, with its version. */
  readonly hostVersion?: string;
  /** The template engine behind the render. */
  readonly engineVersion?: string;
}

/**
 * One failed attempt, frozen. Held by the diagnostic it explains, so the
 * report a reader inspects and copies describes that attempt however much
 * the document, the selection, or another preview has moved on since.
 */
export interface RenderReport {
  /** The code the failure reached the reader as. */
  readonly code: string;
  /** The engine's own detail; absent where the failure carried none. */
  readonly evidence?: EngineEvidence;
  /**
   * Where the failure belongs, kept apart from what the engine reported: an
   * engine line is not automatically a line in the open caller.
   */
  readonly engineLocation?: string;
  readonly caller?: string;
  readonly repairTarget?: string;
  /** The document section that failed, as the diagnostic named it. */
  readonly section?: string;
  /** When the failure was captured, as an ISO-8601 instant. */
  readonly capturedAt: string;
  /** Whether a deliberate Run or an automatic check started the attempt. */
  readonly trigger: "explicit" | "automatic";
  /**
   * Which published result of its scheduler this was. Two attempts over
   * identical bytes are still two attempts, so the source revision alone
   * never stands as an attempt identity. Absent for a document problem, which
   * no render ever reached.
   */
  readonly sequence?: number;
  /** The source, paper, and preview selection that attempt rendered. */
  readonly identity: RenderIdentity;
  readonly context: WorkbenchReportContext;
}

/**
 * Every `Error` reachable from `error`, breadth-first. Three link kinds carry
 * a template failure out of the engines:
 *  - `cause` — Eta wraps rather than subclasses;
 *  - `originalError` — liquidjs defines it non-enumerably on its render errors;
 *  - `errors` when it is an array — one duck-typed check covering both
 *    `AggregateError` and liquidjs's `LiquidErrors` batch.
 *
 * A link that is no `Error` is still walked through, because an engine may
 * hand its own error on inside a plain wrapper; only the errors themselves
 * come back. Both the report and the attribution classifier read this one
 * walk, so the evidence and the blame follow the same chain.
 */
export function errorChain(error: unknown): readonly Error[] {
  const found: Error[] = [];
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const link = pending.shift();
    if (link === null || typeof link !== "object" || seen.has(link)) continue;
    seen.add(link);
    if (Error.isError(link)) found.push(link);
    const {
      cause,
      originalError,
      errors: batch,
    } = link as Record<string, unknown>;
    pending.push(cause, originalError, ...(Array.isArray(batch) ? batch : []));
  }
  return found;
}

function readString(source: object, key: string): string | undefined {
  const value: unknown = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: object, key: string): number | undefined {
  const value: unknown = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** The caret-annotated source excerpt on `error`, when it carries one. */
function engineContext(error: Error): string | undefined {
  return readString(error, "context");
}

/**
 * The location the engine named for itself: the template it was rendering,
 * and the line it reached. Engines name their own registered template, which
 * is not necessarily a file the reader has open, so this stays evidence
 * rather than a navigation target.
 */
function engineReportedLocation(error: Error): string | undefined {
  const token: unknown = (error as { token?: unknown }).token;
  const where =
    readString(error, "templateName") ??
    readString(error, "filepath") ??
    readString(error, "path") ??
    (token !== null && typeof token === "object"
      ? readString(token, "file")
      : undefined);
  const line =
    readNumber(error, "line") ??
    readNumber(error, "lineNo") ??
    readNumber(error, "lineNumber");
  if (where === undefined)
    return line === undefined ? undefined : `line ${line}`;
  return line === undefined ? where : `${where}:${line}`;
}

/**
 * What the engine said about one failure, captured before any conversion to a
 * message-only diagnostic.
 */
export function engineEvidence(error: unknown): EngineEvidence {
  const chain = errorChain(error);
  const head = chain[0];
  if (head === undefined) return { message: String(error) };
  const causes = chain
    .slice(1)
    .map(({ message }) => message)
    .filter((message) => message.length > 0);
  const context = chain.map(engineContext).find((found) => found !== undefined);
  const reportedLocation = chain
    .map(engineReportedLocation)
    .find((found) => found !== undefined);
  return {
    message: head.message,
    ...(head.name ? { name: head.name } : {}),
    ...(head.stack === undefined ? {} : { stack: head.stack }),
    ...(causes.length > 0 ? { causes } : {}),
    ...(context === undefined ? {} : { context }),
    ...(reportedLocation === undefined ? {} : { reportedLocation }),
  };
}

/** The section of the document a diagnostic named, as the report reads it. */
function reportSection(diagnostic: RenderDiagnostic): string | undefined {
  return diagnostic.position === undefined
    ? diagnostic.part
    : `property ${diagnostic.position}`;
}

/** The engine's own location, as one line of the report. */
function reportEngineLocation(
  engine: RenderEngineLocation | undefined,
): string | undefined {
  if (engine === undefined) return undefined;
  const { template, line, column } = engine;
  if (line === undefined) return template;
  return column === undefined
    ? `${template}:${line}`
    : `${template}:${line}:${column}`;
}

/** The calling template, named by whichever of its two names the failure gave. */
function reportCaller(caller: RenderCaller | undefined): string | undefined {
  return caller === undefined
    ? undefined
    : (caller.document ?? caller.template);
}

/**
 * The verified call a repair goes in, as offsets into the source that render
 * read. Offsets rather than a line, because the reader's own document is what
 * those offsets address and the report carries its revision beside them.
 */
function reportRepairTarget(
  callSite: RenderDiagnostic["callSite"],
): string | undefined {
  return callSite === undefined
    ? undefined
    : `offset ${callSite.from}-${callSite.to}`;
}

/**
 * The identity fields alone, copied out of the result that carries them. A
 * report serializes this defined context rather than a live result object.
 */
function reportIdentity(identity: RenderIdentity): RenderIdentity {
  const {
    previewMode,
    sourceRevision,
    snapshotRevision,
    annotationId,
    annotationRevision,
    citationVariant,
    citationExample,
    partialContext,
    partialProfile,
  } = identity;
  return {
    ...(previewMode === undefined ? {} : { previewMode }),
    sourceRevision,
    snapshotRevision,
    ...(annotationId === undefined ? {} : { annotationId }),
    ...(annotationRevision === undefined ? {} : { annotationRevision }),
    ...(citationVariant === undefined ? {} : { citationVariant }),
    ...(citationExample === undefined ? {} : { citationExample }),
    ...(partialContext === undefined ? {} : { partialContext }),
    ...(partialProfile === undefined ? {} : { partialProfile }),
  };
}

/**
 * The report one diagnostic carries from here on. Every value is read once,
 * at capture, so nothing in it can be rewritten from later application state.
 */
export function captureRenderReport({
  diagnostic,
  identity,
  trigger,
  sequence,
  capturedAt,
  context,
}: {
  readonly diagnostic: RenderDiagnostic;
  readonly identity: RenderIdentity;
  readonly trigger: "explicit" | "automatic";
  readonly sequence: number;
  readonly capturedAt: string;
  readonly context: WorkbenchReportContext;
}): RenderReport {
  const section = reportSection(diagnostic);
  const engineLocation = reportEngineLocation(diagnostic.engine);
  const caller = reportCaller(diagnostic.caller);
  const repairTarget = reportRepairTarget(diagnostic.callSite);
  return {
    code: diagnostic.code,
    ...(diagnostic.evidence === undefined
      ? {}
      : { evidence: diagnostic.evidence }),
    ...(engineLocation === undefined ? {} : { engineLocation }),
    ...(caller === undefined ? {} : { caller }),
    ...(repairTarget === undefined ? {} : { repairTarget }),
    ...(section === undefined ? {} : { section }),
    capturedAt,
    trigger,
    sequence,
    identity: reportIdentity(identity),
    context,
  };
}

/**
 * The report one document problem carries. The parser found it in the source
 * this Workbench holds rather than in a render, so what a thrown error would
 * have filled — name, stack, causes, excerpt, engine location, caller, repair
 * target, attempt number — is left absent and reported as unavailable. Every
 * value is read once, at capture, the same as a render report's.
 */
export function captureProblemReport({
  problem,
  message,
  source,
  capturedAt,
  context,
}: {
  readonly problem: WorkbenchProblem;
  /** The problem's own condition, in the language the reader is reading. */
  readonly message: string;
  /** The document text it was found in, which stamps the source revision. */
  readonly source: string;
  readonly capturedAt: string;
  readonly context: WorkbenchReportContext;
}): RenderReport {
  const { range } = problem;
  return {
    code: problem.code,
    evidence: {
      message,
      ...(range === undefined
        ? {}
        : { reportedLocation: `offset ${range.from}-${range.to}` }),
    },
    section: problem.slice,
    capturedAt,
    // The parser reads the document on every change; no deliberate Run of the
    // reader's own reached this problem.
    trigger: "automatic",
    identity: {
      sourceRevision: templateSourceRevision(source),
      // No render ran, so no paper was ever read for this one.
      snapshotRevision: "",
    },
    context,
  };
}

/** `Label: value`, or the explicit unavailable marker in place of a blank. */
function field(label: string, value: string | undefined): string {
  return `${label}: ${value === undefined || value.length === 0 ? REPORT_UNAVAILABLE : value}`;
}

/**
 * A value that carries its own line breaks — an engine message, a caret
 * excerpt, a stack. It follows its label on its own lines so it survives the
 * report byte for byte.
 */
function block(label: string, value: string | undefined): string {
  return value === undefined || value.length === 0
    ? field(label, undefined)
    : `${label}:\n${value}`;
}

/** `key=value` for every selection dimension the attempt actually rendered. */
function renderOptions(identity: RenderIdentity): string | undefined {
  const options = [
    identity.previewMode === undefined ? null : `mode=${identity.previewMode}`,
    identity.citationVariant === undefined
      ? null
      : `citation variant=${identity.citationVariant}`,
    identity.citationExample === undefined
      ? null
      : `citation example=${identity.citationExample}`,
    identity.partialContext === undefined
      ? null
      : `partial context=${identity.partialContext}`,
    identity.partialProfile === undefined
      ? null
      : `partial profile=${identity.partialProfile}`,
  ].filter((option) => option !== null);
  return options.length === 0 ? undefined : options.join(", ");
}

/** The paper and example the attempt rendered against, as the report names them. */
function reportSelection(
  identity: RenderIdentity,
  context: WorkbenchReportContext,
): string | undefined {
  const parts = [
    context.selection === undefined ? null : `item=${context.selection}`,
    identity.annotationId === undefined
      ? null
      : `annotation=${identity.annotationId}@${identity.annotationRevision ?? REPORT_UNAVAILABLE}`,
  ].filter((entry) => entry !== null);
  return parts.length === 0 ? undefined : parts.join(", ");
}

/**
 * The one text a report reads and copies as. English throughout: the report
 * travels to an issue or the community, where one format keeps the evidence
 * comparable, and the engine's own words are untranslated anyway.
 */
export function formatRenderReport(report: RenderReport): string {
  const { evidence, identity, context } = report;
  return [
    "ZotLit template error report",
    "",
    block("Engine message", evidence?.message),
    "",
    field("Problem code", report.code),
    field("Engine name", evidence?.name),
    field("Reported location", evidence?.reportedLocation),
    field("Engine location", report.engineLocation),
    field("Calling template", report.caller),
    field("Repair target", report.repairTarget),
    field("Document section", report.section),
    "",
    block("Cause", evidence?.causes?.join("\n")),
    "",
    block("Source excerpt", evidence?.context),
    "",
    block("Stack", evidence?.stack),
    "",
    field("Captured at", report.capturedAt),
    field("Trigger", report.trigger),
    field(
      "Attempt",
      report.sequence === undefined ? undefined : String(report.sequence),
    ),
    field("Template document", context.document),
    field("Template language", context.language),
    field("Rendering root", context.root),
    field("Render options", renderOptions(identity)),
    field("Selection", reportSelection(identity, context)),
    field("Source revision", identity.sourceRevision),
    field("Snapshot revision", identity.snapshotRevision),
    field("ZotLit version", context.zotlitVersion),
    field("Host version", context.hostVersion),
    field("Engine version", context.engineVersion),
  ].join("\n");
}
