// The Template Workbench commands and their response boundaries.
import type { CliData } from "obsidian";

import type {
  CitationTemplateData,
  CitationVariant,
  ContractRoot,
  TemplateSlot,
} from "@zotlit/db";
import type { FrontmatterLanguage } from "@zotlit/templates/constants";
import { LiteratureNoteTemplateError } from "@zotlit/templates/facade";
import type { RootVariableUse } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";
import {
  ContractMetadataError,
  serializeTemplateData,
} from "@zotlit/workbench/explorer";

import type { CliCommandHandler } from "@/lib/cli-command";
import { catchRejection } from "@/lib/cli-params";
import type { CliRejection } from "@/lib/cli-params";
import { Effect } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { DEFAULT_PROFILE, parseProfileSelector } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import type { ProfileDiagnostic } from "@/services/profile/service";
import { InertTemplateError } from "@/services/template/errors";
import type {
  CitationTemplateStatus,
  CompileError,
  LiteratureNoteTemplateStatus,
  ResolvedLiteratureNoteTemplate,
  SettleOutcome,
  SharedPartialDocument,
  TemplateFileStatus,
} from "@/services/template/service";

import type {
  CitationDataLoadResult,
  CitationSelector,
  TemplateDataError,
  TemplateDataLoadResult,
} from "./data";
import { discoverTemplateData } from "./discovery";
import {
  dataLoadDiagnostic,
  diagnostic,
  envelope,
  faultDiagnostic,
  initFailedDiagnostic,
  notSettledDiagnostic,
  rejectionDiagnostic,
  templateFaultDiagnostic,
} from "./envelope";
import type {
  Diagnostic,
  DiagnosticCode,
  LiteratureNoteDocumentRow,
  LiteratureNoteProfileRow,
  WorkbenchCommand,
  WorkbenchIdentity,
} from "./envelope";
import { renderGuide } from "./guide";
import type { selectInspectionNote } from "./inspect";
import { INSPECT_DIAGNOSTICS } from "./inspect-contract";
import {
  parseDataRequest,
  parseDocumentRenderRequest,
  parseGuideRequest,
  parseStatusRequest,
  targetMismatch,
} from "./request";

export type { WorkbenchIdentity } from "./envelope";

export const TEMPLATE_STATUS_COMMAND =
  "zotlit:template-status" as const satisfies WorkbenchCommand;
export const TEMPLATE_DATA_COMMAND =
  "zotlit:template-data" as const satisfies WorkbenchCommand;
export const TEMPLATE_SCHEMA_COMMAND =
  "zotlit:template-schema" as const satisfies WorkbenchCommand;
export const TEMPLATE_RENDER_COMMAND =
  "zotlit:template-render" as const satisfies WorkbenchCommand;
export const TEMPLATE_DOCUMENT_RENDER_COMMAND =
  "zotlit:template-document-render" as const satisfies WorkbenchCommand;
export const TEMPLATE_GUIDE_COMMAND =
  "zotlit:template-guide" as const satisfies WorkbenchCommand;
export const TEMPLATE_SOURCE_COMMAND =
  "zotlit:template-source" as const satisfies WorkbenchCommand;
export const FRONTMATTER_STATUS_COMMAND =
  "zotlit:frontmatter-status" as const satisfies WorkbenchCommand;
export const FRONTMATTER_EVAL_COMMAND =
  "zotlit:frontmatter-eval" as const satisfies WorkbenchCommand;
export const FRONTMATTER_SET_COMMAND =
  "zotlit:frontmatter-set" as const satisfies WorkbenchCommand;
export const FRONTMATTER_REMOVE_COMMAND =
  "zotlit:frontmatter-remove" as const satisfies WorkbenchCommand;
export const FRONTMATTER_REORDER_COMMAND =
  "zotlit:frontmatter-reorder" as const satisfies WorkbenchCommand;

const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

interface TemplateWorkbenchDeps {
  /** The installed ZotLit version, reported by the status command. */
  pluginVersion: string;
  getIdentity: () => WorkbenchIdentity | Promise<WorkbenchIdentity>;
  selectNote: (
    name: string,
  ) => Promise<ReturnType<typeof selectInspectionNote>>;
  loadData: (
    indexedKey: string,
    root: ContractRoot,
    options?: { note?: string },
  ) => Effect.Effect<TemplateDataLoadResult, TemplateDataError>;
  /** Citation Template data for one example set or one chosen Item. */
  loadCitation: (
    selector: CitationSelector,
    variant: CitationVariant,
  ) => Effect.Effect<CitationDataLoadResult, TemplateDataError>;
  settleTimeoutMs?: number;
  templates: {
    readonly javascriptTemplatesEnabled: boolean;
    readonly compileErrors: ReadonlyMap<string, CompileError>;
    getTemplateFileStatuses: () => readonly TemplateFileStatus[];
    getCitationTemplateStatus: () => CitationTemplateStatus;
    getPartialDocument: (name: string) => SharedPartialDocument | null;
    render: (name: string, data: object) => string;
    renderFilename: (data: object) => string;
    renderCitationData: (data: CitationTemplateData) => string;
    waitUntilSettled: (timeoutMs: number) => Promise<SettleOutcome>;
    analyzeRootVariables: (name: string) => RootVariableUse[] | null;
    getTemplateSource: (name: TemplateSlot) => Promise<string>;
  };
  frontmatter: {
    /**
     * Configured Managed Frontmatter fields in configuration order, the keys
     * left inert by the JavaScript Templates gate, and the gate's current
     * state. Non-throwing counterpart to the plugin's compiled-fields
     * accessor, which throws when any field is inert.
     */
    read: () => {
      fields: readonly FrontmatterField[];
      inertKeys: readonly string[];
      javascriptTemplatesEnabled: boolean;
    };
    /**
     * Evaluate `fields` over `zt`, gate-aware: a `"javascript"` field is
     * skipped (never compiled) while the gate is off, its key reported in
     * `inertKeys` rather than `values`/`errors`. Non-throwing counterpart to
     * the plugin's frontmatter write path, for `frontmatter-eval`.
     */
    evaluate: (
      fields: readonly FrontmatterField[],
      zt: object,
    ) => {
      values: Readonly<Record<string, unknown>>;
      errors: Readonly<Record<string, string>>;
      inertKeys: readonly string[];
    };
    /** Compile-check a single ad-hoc expression; `null` when it compiles. */
    validateExpr: (
      expr: string,
      language: FrontmatterLanguage,
    ) => string | null;
    /**
     * Upsert `fields` through the plugin's settings service, so the settings
     * modal, compilation lifecycle, and sync all observe the change. Callers
     * validate the candidate list (reserved keys, non-empty, compile-checked)
     * before calling; this never receives — and so never stores — a field the
     * settings modal would have refused.
     */
    write: (fields: readonly FrontmatterField[]) => void;
  };
  literatureNotes?: {
    readProfiles: () => {
      defaultProfile:
        | {
            readonly document?: string;
            readonly bindings?: ResolvedLiteratureNoteProfileBindings;
          }
        | undefined;
      diagnostics?: readonly ProfileDiagnostic[];
      profiles: readonly {
        readonly id: string;
        readonly label: string;
        readonly document?: string;
        readonly bindings?: ResolvedLiteratureNoteProfileBindings;
      }[];
    };
    getDocumentStatuses: () => readonly LiteratureNoteTemplateStatus[];
    getDocument: (
      reference: string,
    ) =>
      | Pick<
          ResolvedLiteratureNoteTemplate,
          "renderForCreate" | "renderForUpdate"
        >
      | undefined;
    renderSource: (
      source: string,
      data: object,
    ) => { create: string; update: string | null };
  };
}

export type TemplateWorkbenchHandlers = Record<
  | typeof TEMPLATE_STATUS_COMMAND
  | typeof TEMPLATE_DATA_COMMAND
  | typeof TEMPLATE_DOCUMENT_RENDER_COMMAND
  | typeof TEMPLATE_GUIDE_COMMAND,
  CliCommandHandler
>;

export function createTemplateWorkbenchHandlers(
  deps: TemplateWorkbenchDeps,
): TemplateWorkbenchHandlers {
  const settleTimeoutMs = deps.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;

  const settleDiagnostic = (
    outcome: Exclude<SettleOutcome, "settled">,
  ): Diagnostic =>
    outcome === "timeout"
      ? notSettledDiagnostic(settleTimeoutMs)
      : initFailedDiagnostic();

  const getIdentity = () => Effect.promise(async () => deps.getIdentity());
  const waitUntilSettled = () =>
    Effect.promise(() => deps.templates.waitUntilSettled(settleTimeoutMs));

  /**
   * The preamble both item-backed commands share: parse the selector, resolve
   * the connected identity, assert the caller's target, and wait for observed
   * Template edits to compile. `run` sees a valid request and a confirmed
   * target, and owns the rest of its command's envelopes. `span` names the
   * command's trace span.
   */
  const gated = <T extends object>(
    { command, span }: { command: WorkbenchCommand; span: string },
    parse: (params: CliData) => Effect.Effect<T, CliRejection>,
    run: (
      request: T,
      identity: WorkbenchIdentity,
    ) => Effect.Effect<string, unknown>,
  ): CliCommandHandler =>
    Effect.fn(span)(function* (params: CliData) {
      const request = yield* parse(params);

      const identity = yield* getIdentity();
      const mismatch = targetMismatch(params, identity);
      if (mismatch) {
        return envelope(command, {
          ok: false,
          request,
          identity,
          diagnostic: mismatch,
        });
      }

      const outcome = yield* waitUntilSettled();
      if (outcome !== "settled") {
        return envelope(command, {
          ok: false,
          request,
          identity,
          diagnostic: settleDiagnostic(outcome),
        });
      }
      return yield* run(request, identity);
    }, answerRejection(command));

  return {
    [TEMPLATE_STATUS_COMMAND]: Effect.fn("TemplateWorkbenchCli.status")(
      function* (params: CliData) {
        yield* parseStatusRequest(params);

        const outcome = yield* waitUntilSettled();
        if (outcome !== "settled") {
          return envelope(TEMPLATE_STATUS_COMMAND, {
            ok: false,
            diagnostic: settleDiagnostic(outcome),
          });
        }

        return envelope(TEMPLATE_STATUS_COMMAND, {
          ok: true,
          pluginVersion: deps.pluginVersion,
          identity: yield* getIdentity(),
          javascriptTemplatesEnabled: deps.templates.javascriptTemplatesEnabled,
          templates: deps.templates.getTemplateFileStatuses(),
          ...(deps.literatureNotes
            ? literatureNoteAuthoringState(deps.literatureNotes)
            : {}),
        });
      },
      answerRejection(TEMPLATE_STATUS_COMMAND),
    ),

    [TEMPLATE_DATA_COMMAND]: gated(
      { command: TEMPLATE_DATA_COMMAND, span: "TemplateWorkbenchCli.data" },
      parseDataRequest,
      (request, identity) =>
        Effect.gen(function* () {
          let selector: CitationSelector;
          let noteContext: { note: string; profile: string } | undefined;
          if ("note" in request) {
            const note = request.note;
            const selected = yield* Effect.promise(() => deps.selectNote(note));
            if (selected.error) {
              const problem = INSPECT_DIAGNOSTICS[selected.error];
              return envelope(TEMPLATE_DATA_COMMAND, {
                ok: false,
                request,
                identity,
                diagnostic: diagnostic(
                  "INVALID_SELECTOR",
                  `${problem.message} ${problem.hint}`,
                  { parameter: "note" },
                ),
              });
            }
            selector = { key: selected.note.key };
            noteContext = {
              note: selected.note.path,
              profile: selected.profile,
            };
          } else {
            selector =
              "example" in request
                ? { example: request.example }
                : { key: request.key };
          }
          const echoed = {
            request,
            identity,
            selection: {
              ...selector,
              root: request.root,
              ...noteContext,
            },
          };
          const result = yield* loadFailure(
            "example" in selector || request.root === "citation"
              ? deps.loadCitation(selector, "main")
              : deps.loadData(
                  selector.key,
                  request.root,
                  noteContext ? { note: noteContext.note } : undefined,
                ),
          );
          if (result.kind !== "data") {
            return envelope(TEMPLATE_DATA_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: dataLoadDiagnostic(result, selectedObject(selector)),
            });
          }

          let data: unknown;
          try {
            if (!request.full) {
              const discovery = discoverTemplateData(
                result.data,
                request.root,
                request,
              );
              if ("error" in discovery)
                return envelope(TEMPLATE_DATA_COMMAND, {
                  ok: false,
                  ...echoed,
                  diagnostic: diagnostic("INVALID_SELECTOR", discovery.error!, {
                    parameter: "path",
                  }),
                });
              return envelope(TEMPLATE_DATA_COMMAND, {
                ok: true,
                ...echoed,
                discovery,
              });
            }
            data = serializeTemplateData(result.data, request.root);
          } catch (error) {
            // A missing contract entry means the committed IR no longer matches
            // the data shapes this build shipped — a plugin defect, not a fault
            // the caller can correct from a diagnostic.
            if (error instanceof ContractMetadataError) {
              yield* Effect.logError(
                "Template data contract metadata is missing",
              ).pipe(
                Effect.annotateLogs({
                  error,
                  command: TEMPLATE_DATA_COMMAND,
                  selected: selectedObject(selector),
                  root: request.root,
                }),
                withLogCategory("template-workbench"),
              );
              return yield* Effect.die(error);
            }
            return envelope(TEMPLATE_DATA_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: templateFaultDiagnostic(error, {
                template: null,
                compileErrors: deps.templates.compileErrors,
              }),
            });
          }

          return envelope(TEMPLATE_DATA_COMMAND, {
            ok: true,
            ...echoed,
            zt: data,
          });
        }),
    ),

    [TEMPLATE_DOCUMENT_RENDER_COMMAND]: gated(
      {
        command: TEMPLATE_DOCUMENT_RENDER_COMMAND,
        span: "TemplateWorkbenchCli.documentRender",
      },
      parseDocumentRenderRequest,
      (request, identity) =>
        Effect.gen(function* () {
          const echoed = { request, identity };
          const literatureNotes = deps.literatureNotes;
          if (!literatureNotes) {
            return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: diagnostic(
                "DOCUMENT_INVALID",
                "Literature Note document rendering is unavailable.",
              ),
            });
          }

          let render: (data: object) => {
            create: string;
            update: string | null;
          };
          let document: { name: string; source?: string };
          if ("source" in request) {
            document = { name: "source", source: request.source };
            render = (data) =>
              literatureNotes.renderSource(request.source, data);
          } else {
            const reference =
              "document" in request
                ? request.document
                : profileDocumentReference(literatureNotes, request.profile);
            if (typeof reference !== "string") {
              return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
                ok: false,
                ...echoed,
                diagnostic: reference,
              });
            }
            document = { name: reference };
            let resolved;
            try {
              resolved = literatureNotes.getDocument(reference);
            } catch (error) {
              return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
                ok: false,
                ...echoed,
                diagnostic: literatureNoteDocumentDiagnostic(error, document),
              });
            }
            if (!resolved) {
              return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
                ok: false,
                ...echoed,
                diagnostic: documentNotFoundDiagnostic(reference),
              });
            }
            render = (data) => ({
              create: resolved.renderForCreate(data),
              update: resolved.renderForUpdate(data),
            });
          }

          const result = yield* loadFailure(deps.loadData(request.key, "note"));
          if (result.kind !== "data") {
            return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: dataLoadDiagnostic(result, request.key),
            });
          }
          try {
            return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
              ok: true,
              ...echoed,
              render: render(result.data),
            });
          } catch (error) {
            return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: literatureNoteDocumentDiagnostic(error, document),
            });
          }
        }),
    ),

    [TEMPLATE_GUIDE_COMMAND]: (params: CliData) =>
      parseGuideRequest(params).pipe(
        Effect.map(renderGuide),
        answerRejection(TEMPLATE_GUIDE_COMMAND),
      ),
  };
}

/**
 * A load that failed fails the command with what failed, which Obsidian
 * prints as the command's error.
 */
const loadFailure = <A>(load: Effect.Effect<A, TemplateDataError>) =>
  Effect.mapError(load, ({ cause }) => cause);

/** A rejected request answers its diagnostic envelope. */
const answerRejection = (command: WorkbenchCommand) =>
  catchRejection((rejected) =>
    envelope(command, { ok: false, diagnostic: rejectionDiagnostic(rejected) }),
  );

function literatureNoteAuthoringState(
  literatureNotes: NonNullable<TemplateWorkbenchDeps["literatureNotes"]>,
): {
  profiles: readonly LiteratureNoteProfileRow[];
  documents: readonly LiteratureNoteDocumentRow[];
  profileDiagnostics: readonly ProfileDiagnostic[];
} {
  const state = literatureNotes.readProfiles();
  const profiles: LiteratureNoteProfileRow[] = [
    ...(state.defaultProfile
      ? [
          {
            id: DEFAULT_PROFILE,
            label: "Default",
            document: state.defaultProfile.document ?? null,
            bindings: state.defaultProfile.bindings,
          } satisfies LiteratureNoteProfileRow,
        ]
      : []),
    ...state.profiles.map((profile) => ({
      id: profile.id as ProfileId,
      label: profile.label,
      document: profile.document ?? null,
      bindings: profile.bindings,
    })),
  ];
  const documents = new Map<string, LiteratureNoteDocumentRow>();
  for (const status of literatureNotes.getDocumentStatuses()) {
    documents.set(
      status.reference,
      status.validation.state === "valid"
        ? {
            reference: status.reference,
            path: status.path,
            validation: status.validation,
          }
        : {
            reference: status.reference,
            path: status.path,
            validation: {
              state: "invalid",
              diagnostic: literatureNoteDocumentDiagnosticCode(
                status.validation.error,
                { name: status.path },
              ),
            },
          },
    );
  }
  for (const profile of profiles) {
    if (profile.document && !documents.has(profile.document)) {
      documents.set(profile.document, {
        reference: profile.document,
        path: null,
        validation: {
          state: "missing",
          diagnostic: documentNotFoundDiagnostic(profile.document),
        },
      });
    }
  }
  return {
    profiles,
    profileDiagnostics: state.diagnostics ?? [],
    documents: [...documents.values()].sort((a, b) =>
      a.reference.localeCompare(b.reference),
    ),
  };
}

/** Parse a `--profile` argument's text, then resolve its document reference. */
function profileDocumentReference(
  literatureNotes: NonNullable<TemplateWorkbenchDeps["literatureNotes"]>,
  text: string,
): string | Diagnostic {
  const selector = parseProfileSelector(text);
  const state = literatureNotes.readProfiles();
  const found =
    selector === undefined
      ? undefined
      : selector === DEFAULT_PROFILE
        ? state.defaultProfile
        : state.profiles.find((candidate) => candidate.id === selector);
  if (!found) {
    return diagnostic(
      "UNKNOWN_PROFILE_STAMP",
      `No Literature Note Profile has the stamped ID '${text}'.`,
    );
  }
  if (!found.document) {
    return diagnostic(
      "DOCUMENT_NOT_FOUND",
      `Profile '${text}' uses the built-in Literature Note Template and has no document reference.`,
    );
  }
  return found.document;
}

function documentNotFoundDiagnostic(reference: string): Diagnostic {
  return diagnostic(
    "DOCUMENT_NOT_FOUND",
    `Literature Note Template document '${reference}' was not found.`,
  );
}

/**
 * A Template Document fault. `document` names the document and, when the
 * caller holds it, its source, so the report excerpts the place the parser
 * found the fault.
 */
function literatureNoteDocumentDiagnostic(
  error: unknown,
  document?: { name: string; source?: string },
): Diagnostic {
  if (error instanceof InertTemplateError) {
    return diagnostic("ETA_OPT_IN_REQUIRED", error.message);
  }
  if (error instanceof LiteratureNoteTemplateError) {
    return literatureNoteDocumentDiagnosticCode(error, document);
  }
  return diagnostic(
    "DOCUMENT_INVALID",
    error instanceof Error ? error.message : String(error),
  );
}

const DOCUMENT_FAULT_CODES = {
  "duplicate-managed-block": "DUPLICATE_MANAGED_BLOCK",
  "missing-annotation-section": "MISSING_ANNOTATION_SECTION",
  "duplicate-annotation-section": "DUPLICATE_ANNOTATION_SECTION",
  "unknown-section-header": "UNKNOWN_SECTION_HEADER",
  "reserved-annotation-partial": "RESERVED_ANNOTATION_PARTIAL",
} as const satisfies Partial<Record<string, DiagnosticCode>>;

function literatureNoteDocumentDiagnosticCode(
  fault: {
    code: string;
    message: string;
    recovery?: string;
    offset?: number;
    manifestPath?: readonly (string | number)[];
  },
  document?: { name: string; source?: string },
): Diagnostic {
  const code =
    DOCUMENT_FAULT_CODES[fault.code as keyof typeof DOCUMENT_FAULT_CODES] ??
    "DOCUMENT_INVALID";
  const { offset } = fault;
  const span = offset === undefined ? undefined : { from: offset, to: offset };
  const source = document?.source;
  const value = faultDiagnostic(code, fault.message, {
    ...(fault.recovery === undefined ? {} : { hint: fault.recovery }),
    ...(fault.manifestPath?.length
      ? { path: manifestPathText(fault.manifestPath) }
      : {}),
    ...(span !== undefined && source !== undefined
      ? { at: { source, span, name: document!.name } }
      : {}),
  });
  // Without the source there is no excerpt, but the offset still locates it.
  return span === undefined || source !== undefined
    ? value
    : { ...value, location: { ...value.location, span } };
}

/** A manifest node path in accessor form, such as `frontmatter[2].key`. */
function manifestPathText(path: readonly (string | number)[]): string {
  return path
    .map((key, index) =>
      typeof key === "number" ? `[${key}]` : index === 0 ? key : `.${key}`,
    )
    .join("");
}

/**
 * What a request selected, as a message names it: the Indexed Key, or the
 * example set standing in for one. A Legacy Template File slot takes no
 * example set, and a built-in example set is synthesized rather than looked
 * up, so only the key half ever reaches a load failure.
 */
function selectedObject(
  request: { key: string } | { example: string },
): string {
  return "key" in request ? request.key : request.example;
}
