// The Template Workbench commands and their response boundaries.

import type { CliData, CliHandler } from "obsidian";

import { TEMPLATE_SLOT_ROOTS } from "@zotlit/db";
import type { ContractRoot, TemplateSlot } from "@zotlit/db";
import type { FrontmatterLanguage } from "@zotlit/templates/constants";
import { LiteratureNoteTemplateError } from "@zotlit/templates/facade";
import type { RootVariableUse } from "@zotlit/templates/facade";
import type { FrontmatterField } from "@zotlit/templates/frontmatter";

import { FIELD_ZOTERO_KEY, RESERVED_KEYS } from "@/lib/constants";
import { getLogger } from "@/lib/log";
import { InertTemplateError } from "@/services/template/errors";
import type {
  CompileError,
  LiteratureNoteTemplateStatus,
  ResolvedLiteratureNoteTemplate,
  SettleOutcome,
  TemplateFileStatus,
} from "@/services/template/service";

import type { TemplateDataLoadResult } from "./data";
import {
  dataLoadDiagnostic,
  diagnostic,
  envelope,
  initFailedDiagnostic,
  notSettledDiagnostic,
  templateFaultDiagnostic,
} from "./envelope";
import type {
  Diagnostic,
  FrontmatterEvalRow,
  FrontmatterFieldRow,
  LiteratureNoteDocumentRow,
  LiteratureNoteProfileRow,
  WorkbenchCommand,
  WorkbenchIdentity,
} from "./envelope";
import { renderGuide } from "./guide";
import {
  parseDataRequest,
  parseDocumentRenderRequest,
  parseFrontmatterEvalRequest,
  parseFrontmatterRemoveRequest,
  parseFrontmatterReorderRequest,
  parseFrontmatterSetRequest,
  parseFrontmatterStatusRequest,
  parseGuideRequest,
  parseRenderRequest,
  parseSchemaRequest,
  parseSourceRequest,
  parseStatusRequest,
  targetMismatch,
} from "./request";
import type { ParsedRequest } from "./request";
import { schemaAssets } from "./schema";
import { ContractMetadataError, serializeTemplateData } from "./serialize";

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

/** The ad-hoc mode's single synthetic field key: `frontmatter-eval` never
 *  reports this key back, so any literal never collides with it. */
const ADHOC_FIELD_KEY = "zotlit:frontmatter-eval/adhoc";

const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;
const logger = getLogger("template-workbench");

interface TemplateWorkbenchDeps {
  /** The installed ZotLit version, reported by the status command. */
  pluginVersion: string;
  getIdentity: () => WorkbenchIdentity | Promise<WorkbenchIdentity>;
  loadData: (
    indexedKey: string,
    root: ContractRoot,
  ) => Promise<TemplateDataLoadResult>;
  settleTimeoutMs?: number;
  templates: {
    readonly javascriptTemplatesEnabled: boolean;
    readonly compileErrors: ReadonlyMap<string, CompileError>;
    getTemplateFileStatuses: () => readonly TemplateFileStatus[];
    render: (name: string, data: object) => string;
    renderFilename: (data: object) => string;
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
      defaultProfile: { readonly document?: string };
      profiles: readonly {
        readonly id: string;
        readonly label: string;
        readonly document?: string;
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
  | typeof TEMPLATE_SCHEMA_COMMAND
  | typeof TEMPLATE_RENDER_COMMAND
  | typeof TEMPLATE_DOCUMENT_RENDER_COMMAND
  | typeof TEMPLATE_GUIDE_COMMAND
  | typeof TEMPLATE_SOURCE_COMMAND
  | typeof FRONTMATTER_STATUS_COMMAND
  | typeof FRONTMATTER_EVAL_COMMAND
  | typeof FRONTMATTER_SET_COMMAND
  | typeof FRONTMATTER_REMOVE_COMMAND
  | typeof FRONTMATTER_REORDER_COMMAND,
  CliHandler
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

  /**
   * The preamble both item-backed commands share: parse the selector, resolve
   * the connected identity, assert the caller's target, and wait for observed
   * Template edits to compile. `run` sees a valid request and a confirmed
   * target, and owns the rest of its command's envelopes.
   */
  const gated =
    <T extends object>(
      command: WorkbenchCommand,
      parse: (params: CliData) => ParsedRequest<T>,
      run: (request: T, identity: WorkbenchIdentity) => Promise<string>,
    ): CliHandler =>
    async (params: CliData): Promise<string> => {
      const request = parse(params);
      if (request.kind === "invalid") {
        return envelope(command, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }

      const identity = await deps.getIdentity();
      const mismatch = targetMismatch(params, identity);
      if (mismatch) {
        return envelope(command, {
          ok: false,
          request: request.value,
          identity,
          diagnostic: mismatch,
        });
      }

      const outcome = await deps.templates.waitUntilSettled(settleTimeoutMs);
      if (outcome !== "settled") {
        return envelope(command, {
          ok: false,
          request: request.value,
          identity,
          diagnostic: settleDiagnostic(outcome),
        });
      }
      return await run(request.value, identity);
    };

  /**
   * Render `slot` the way production renders it — `filename` through the
   * template service's own `renderFilename`, so the Workbench reports the
   * single trimmed line note creation would use as a file name.
   */
  const renderSlot = (slot: TemplateSlot, data: object): string =>
    slot === "filename"
      ? deps.templates.renderFilename(data)
      : deps.templates.render(slot, data);

  return {
    [TEMPLATE_STATUS_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseStatusRequest(params);
      if (request.kind === "invalid") {
        return envelope(TEMPLATE_STATUS_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }

      const outcome = await deps.templates.waitUntilSettled(settleTimeoutMs);
      if (outcome !== "settled") {
        return envelope(TEMPLATE_STATUS_COMMAND, {
          ok: false,
          diagnostic: settleDiagnostic(outcome),
        });
      }

      return envelope(TEMPLATE_STATUS_COMMAND, {
        ok: true,
        pluginVersion: deps.pluginVersion,
        identity: await deps.getIdentity(),
        javascriptTemplatesEnabled: deps.templates.javascriptTemplatesEnabled,
        templates: deps.templates.getTemplateFileStatuses(),
        ...(deps.literatureNotes
          ? literatureNoteAuthoringState(deps.literatureNotes)
          : {}),
      });
    },

    [TEMPLATE_DATA_COMMAND]: gated(
      TEMPLATE_DATA_COMMAND,
      parseDataRequest,
      async (request, identity) => {
        const echoed = { request, identity };
        const result = await deps.loadData(request.key, request.root);
        if (result.kind !== "data") {
          return envelope(TEMPLATE_DATA_COMMAND, {
            ok: false,
            ...echoed,
            diagnostic: dataLoadDiagnostic(result, request.key),
          });
        }

        let data: unknown;
        try {
          data = serializeTemplateData(result.data, request.root);
        } catch (error) {
          // A missing contract entry means the committed IR no longer matches
          // the data shapes this build shipped — a plugin defect, not a fault
          // the caller can correct from a diagnostic.
          if (error instanceof ContractMetadataError) {
            logger.error("Template data contract metadata is missing", {
              error,
              command: TEMPLATE_DATA_COMMAND,
              key: request.key,
              root: request.root,
            });
            throw error;
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
      },
    ),

    [TEMPLATE_RENDER_COMMAND]: gated(
      TEMPLATE_RENDER_COMMAND,
      parseRenderRequest,
      async (request, identity) => {
        const echoed = {
          request,
          identity,
          template: templateIdentity(
            deps.templates.getTemplateFileStatuses(),
            request.template,
          ),
          warnings: rootVariableWarnings(
            deps.templates.analyzeRootVariables(request.template),
          ),
        };
        const result = await deps.loadData(
          request.key,
          TEMPLATE_SLOT_ROOTS[request.template],
        );
        if (result.kind !== "data") {
          return envelope(TEMPLATE_RENDER_COMMAND, {
            ok: false,
            ...echoed,
            diagnostic: dataLoadDiagnostic(result, request.key),
          });
        }

        try {
          const markdown = renderSlot(request.template, result.data);
          if (request.format === "markdown") return markdown;
          return envelope(TEMPLATE_RENDER_COMMAND, {
            ok: true,
            ...echoed,
            markdown,
          });
        } catch (error) {
          return envelope(TEMPLATE_RENDER_COMMAND, {
            ok: false,
            ...echoed,
            diagnostic: templateFaultDiagnostic(error, {
              template: request.template,
              compileErrors: deps.templates.compileErrors,
            }),
          });
        }
      },
    ),

    [TEMPLATE_DOCUMENT_RENDER_COMMAND]: gated(
      TEMPLATE_DOCUMENT_RENDER_COMMAND,
      parseDocumentRenderRequest,
      async (request, identity) => {
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
        if ("source" in request) {
          render = (data) => literatureNotes.renderSource(request.source, data);
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
          let document;
          try {
            document = literatureNotes.getDocument(reference);
          } catch (error) {
            return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: literatureNoteDocumentDiagnostic(error),
            });
          }
          if (!document) {
            return envelope(TEMPLATE_DOCUMENT_RENDER_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: documentNotFoundDiagnostic(reference),
            });
          }
          render = (data) => ({
            create: document.renderForCreate(data),
            update: document.renderForUpdate(data),
          });
        }

        const result = await deps.loadData(request.key, "note");
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
            diagnostic: literatureNoteDocumentDiagnostic(error),
          });
        }
      },
    ),

    [TEMPLATE_GUIDE_COMMAND]: (params: CliData): string => {
      const request = parseGuideRequest(params);
      if (request.kind === "invalid") {
        return envelope(TEMPLATE_GUIDE_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }
      return renderGuide(request.value);
    },

    [TEMPLATE_SCHEMA_COMMAND]: (params: CliData): string => {
      const request = parseSchemaRequest(params);
      if (request.kind === "invalid") {
        return envelope(TEMPLATE_SCHEMA_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }
      return envelope(TEMPLATE_SCHEMA_COMMAND, {
        ok: true,
        pluginVersion: deps.pluginVersion,
        schemas: schemaAssets(deps.pluginVersion),
      });
    },

    [TEMPLATE_SOURCE_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseSourceRequest(params);
      if (request.kind === "invalid") {
        return envelope(TEMPLATE_SOURCE_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }

      const outcome = await deps.templates.waitUntilSettled(settleTimeoutMs);
      if (outcome !== "settled") {
        return envelope(TEMPLATE_SOURCE_COMMAND, {
          ok: false,
          diagnostic: settleDiagnostic(outcome),
        });
      }

      const identity = await deps.getIdentity();
      const template = templateIdentity(
        deps.templates.getTemplateFileStatuses(),
        request.value,
      );
      const source = await deps.templates.getTemplateSource(request.value);
      return envelope(TEMPLATE_SOURCE_COMMAND, {
        ok: true,
        identity,
        template,
        source,
      });
    },

    [FRONTMATTER_STATUS_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseFrontmatterStatusRequest(params);
      if (request.kind === "invalid") {
        return envelope(FRONTMATTER_STATUS_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }

      const { fields, inertKeys, javascriptTemplatesEnabled } =
        deps.frontmatter.read();

      return envelope(FRONTMATTER_STATUS_COMMAND, {
        ok: true,
        identity: await deps.getIdentity(),
        javascriptTemplatesEnabled,
        fields: fields.map((field) => frontmatterFieldRow(field, inertKeys)),
        reservedKeys: [...RESERVED_KEYS],
      });
    },

    [FRONTMATTER_EVAL_COMMAND]: gated(
      FRONTMATTER_EVAL_COMMAND,
      parseFrontmatterEvalRequest,
      async (request, identity) => {
        const echoed = { request, identity };

        if (request.adhoc) {
          const { expr, language } = request.adhoc;
          const gateOrCompileError = validateGateAndCompile(deps, {
            expr,
            language,
            gateMessage:
              "Evaluating a javascript expression requires the JavaScript Templates gate; this device has it disabled.",
          });
          if (gateOrCompileError) {
            return envelope(FRONTMATTER_EVAL_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: gateOrCompileError,
            });
          }

          const result = await deps.loadData(request.key, "note");
          if (result.kind !== "data") {
            return envelope(FRONTMATTER_EVAL_COMMAND, {
              ok: false,
              ...echoed,
              diagnostic: dataLoadDiagnostic(result, request.key),
            });
          }

          const { values, errors } = deps.frontmatter.evaluate(
            [{ key: ADHOC_FIELD_KEY, expr, language, merge: "replace" }],
            result.data,
          );
          const error = errors[ADHOC_FIELD_KEY];
          return envelope(FRONTMATTER_EVAL_COMMAND, {
            ok: true,
            ...echoed,
            ...(error === undefined
              ? { value: values[ADHOC_FIELD_KEY] }
              : { error: { message: error } }),
          });
        }

        const result = await deps.loadData(request.key, "note");
        if (result.kind !== "data") {
          return envelope(FRONTMATTER_EVAL_COMMAND, {
            ok: false,
            ...echoed,
            diagnostic: dataLoadDiagnostic(result, request.key),
          });
        }

        const { fields } = deps.frontmatter.read();
        const configured = fields.filter(
          (field) => !RESERVED_KEYS.has(field.key),
        );
        const { values, errors, inertKeys } = deps.frontmatter.evaluate(
          configured,
          result.data,
        );

        const entries = configured.map((field) =>
          frontmatterEvalRow(field, { values, errors, inertKeys }),
        );
        entries.push(...systemFrontmatterRows(result.data));

        return envelope(FRONTMATTER_EVAL_COMMAND, {
          ok: true,
          ...echoed,
          warnings: gateWarnings(inertKeys),
          entries,
        });
      },
    ),

    [FRONTMATTER_SET_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseFrontmatterSetRequest(params);
      if (request.kind === "invalid") {
        return envelope(FRONTMATTER_SET_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }
      const { field } = request.value;
      const echoed = {
        request: request.value,
        identity: await deps.getIdentity(),
      };

      if (RESERVED_KEYS.has(field)) {
        return envelope(FRONTMATTER_SET_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: diagnostic(
            "RESERVED_KEY",
            `'${field}' is managed by ZotLit and cannot be used as a Managed Frontmatter field key.`,
            { key: field },
          ),
        });
      }

      const { fields } = deps.frontmatter.read();
      const existing = fields.find((candidate) => candidate.key === field);

      const expr = request.value.expr ?? existing?.expr;
      if (expr === undefined) {
        return envelope(FRONTMATTER_SET_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: diagnostic(
            "INVALID_SELECTOR",
            "expr is required for a new field.",
            { parameter: "expr" },
          ),
        });
      }
      const language = request.value.language ?? existing?.language ?? "liquid";
      const merge = request.value.merge ?? existing?.merge ?? "replace";

      const gateOrCompileError = validateGateAndCompile(deps, {
        expr,
        language,
        gateMessage:
          "Writing a javascript field requires the JavaScript Templates gate; this device has it disabled.",
      });
      if (gateOrCompileError) {
        return envelope(FRONTMATTER_SET_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: gateOrCompileError,
        });
      }

      const nextField: FrontmatterField = { key: field, expr, language, merge };
      const nextFields = existing
        ? fields.map((candidate) =>
            candidate.key === field ? nextField : candidate,
          )
        : [...fields, nextField];
      deps.frontmatter.write(nextFields);

      const after = deps.frontmatter.read();
      return envelope(FRONTMATTER_SET_COMMAND, {
        ok: true,
        ...echoed,
        fields: after.fields.map((f) =>
          frontmatterFieldRow(f, after.inertKeys),
        ),
      });
    },

    [FRONTMATTER_REMOVE_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseFrontmatterRemoveRequest(params);
      if (request.kind === "invalid") {
        return envelope(FRONTMATTER_REMOVE_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }
      const { field } = request.value;
      const echoed = {
        request: request.value,
        identity: await deps.getIdentity(),
      };

      const { fields } = deps.frontmatter.read();
      if (!fields.some((candidate) => candidate.key === field)) {
        return envelope(FRONTMATTER_REMOVE_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: fieldNotFoundDiagnostic(field),
        });
      }

      deps.frontmatter.write(
        fields.filter((candidate) => candidate.key !== field),
      );

      const after = deps.frontmatter.read();
      return envelope(FRONTMATTER_REMOVE_COMMAND, {
        ok: true,
        ...echoed,
        fields: after.fields.map((f) =>
          frontmatterFieldRow(f, after.inertKeys),
        ),
      });
    },

    [FRONTMATTER_REORDER_COMMAND]: async (params: CliData): Promise<string> => {
      const request = parseFrontmatterReorderRequest(params);
      if (request.kind === "invalid") {
        return envelope(FRONTMATTER_REORDER_COMMAND, {
          ok: false,
          diagnostic: diagnostic("INVALID_SELECTOR", request.message, {
            parameter: request.parameter,
          }),
        });
      }
      const { order } = request.value;
      const echoed = {
        request: request.value,
        identity: await deps.getIdentity(),
      };

      const { fields } = deps.frontmatter.read();
      const byKey = new Map(fields.map((field) => [field.key, field]));

      const unknownKey = order.find((key) => !byKey.has(key));
      if (unknownKey !== undefined) {
        return envelope(FRONTMATTER_REORDER_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: fieldNotFoundDiagnostic(unknownKey),
        });
      }

      const permutationError = permutationDiagnostic([...byKey.keys()], order);
      if (permutationError) {
        return envelope(FRONTMATTER_REORDER_COMMAND, {
          ok: false,
          ...echoed,
          diagnostic: permutationError,
        });
      }

      // Every key in `order` was confirmed present in `byKey` above.
      deps.frontmatter.write(order.map((key) => byKey.get(key)!));

      const after = deps.frontmatter.read();
      return envelope(FRONTMATTER_REORDER_COMMAND, {
        ok: true,
        ...echoed,
        fields: after.fields.map((f) =>
          frontmatterFieldRow(f, after.inertKeys),
        ),
      });
    },
  };
}

function literatureNoteAuthoringState(
  literatureNotes: NonNullable<TemplateWorkbenchDeps["literatureNotes"]>,
): {
  profiles: readonly LiteratureNoteProfileRow[];
  documents: readonly LiteratureNoteDocumentRow[];
} {
  const state = literatureNotes.readProfiles();
  const profiles: LiteratureNoteProfileRow[] = [
    {
      id: null,
      label: "Default",
      document: state.defaultProfile.document ?? null,
    },
    ...state.profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      document: profile.document ?? null,
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
                status.validation.error.code,
                status.validation.error.message,
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
    documents: [...documents.values()].sort((a, b) =>
      a.reference.localeCompare(b.reference),
    ),
  };
}

function profileDocumentReference(
  literatureNotes: NonNullable<TemplateWorkbenchDeps["literatureNotes"]>,
  profileId: string,
): string | Diagnostic {
  const state = literatureNotes.readProfiles();
  const profile =
    profileId === "default"
      ? state.defaultProfile
      : state.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    return diagnostic(
      "UNKNOWN_PROFILE_STAMP",
      `No Literature Note Profile has the stamped ID '${profileId}'.`,
    );
  }
  if (!profile.document) {
    return diagnostic(
      "DOCUMENT_NOT_FOUND",
      `Profile '${profileId}' uses the built-in Literature Note Template and has no document reference.`,
    );
  }
  return profile.document;
}

function documentNotFoundDiagnostic(reference: string): Diagnostic {
  return diagnostic(
    "DOCUMENT_NOT_FOUND",
    `Literature Note Template document '${reference}' was not found.`,
  );
}

function literatureNoteDocumentDiagnostic(error: unknown): Diagnostic {
  if (error instanceof InertTemplateError) {
    return diagnostic("ETA_OPT_IN_REQUIRED", error.message);
  }
  if (error instanceof LiteratureNoteTemplateError) {
    return literatureNoteDocumentDiagnosticCode(error.code, error.message);
  }
  return diagnostic(
    "DOCUMENT_INVALID",
    error instanceof Error ? error.message : String(error),
  );
}

function literatureNoteDocumentDiagnosticCode(
  code: string,
  message: string,
): Diagnostic {
  if (code === "duplicate-managed-block") {
    return diagnostic("DUPLICATE_MANAGED_BLOCK", message);
  }
  return diagnostic("DOCUMENT_INVALID", message);
}

/**
 * The JS-gate check and compile-check `frontmatter-eval`'s ad-hoc branch and
 * `frontmatter-set` both run before evaluating or writing an expression:
 * refuse a `"javascript"` expression while the gate is off, then compile-check
 * whatever language is left. Returns the diagnostic to report, or `null` when
 * `expr` is safe to evaluate or write.
 */
function validateGateAndCompile(
  deps: TemplateWorkbenchDeps,
  options: { expr: string; language: FrontmatterLanguage; gateMessage: string },
): Diagnostic | null {
  const { expr, language, gateMessage } = options;
  if (language === "javascript" && !deps.templates.javascriptTemplatesEnabled) {
    return diagnostic("ETA_OPT_IN_REQUIRED", gateMessage);
  }
  const compileError = deps.frontmatter.validateExpr(expr, language);
  return compileError === null
    ? null
    : diagnostic("EXPRESSION_COMPILE_ERROR", compileError);
}

/** `frontmatter-remove` and `frontmatter-reorder` both report this when a key
 *  they were given is not in the configured field set. */
function fieldNotFoundDiagnostic(key: string): Diagnostic {
  return diagnostic(
    "FIELD_NOT_FOUND",
    `'${key}' is not a configured Managed Frontmatter field.`,
    { key },
  );
}

/**
 * `frontmatter-reorder`'s permutation check: every configured key exactly
 * once. The caller has already confirmed every entry of `order` names a
 * configured key, so what remains to reject is a key `order` repeats, or a
 * configured key `order` omits. Returns `null` when `order` is an exact
 * permutation of `configuredKeys`.
 */
function permutationDiagnostic(
  configuredKeys: readonly string[],
  order: readonly string[],
): Diagnostic | null {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const key of order) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size > 0) {
    return diagnostic(
      "INVALID_SELECTOR",
      `order lists ${quotedCommaList([...duplicates])} more than once.`,
      { parameter: "order" },
    );
  }

  const missing = configuredKeys.filter((key) => !order.includes(key));
  if (missing.length > 0) {
    return diagnostic(
      "INVALID_SELECTOR",
      `order is missing configured key${missing.length > 1 ? "s" : ""} ${quotedCommaList(missing)}.`,
      { parameter: "order" },
    );
  }
  return null;
}

/** `'a', 'b', 'c'` — a plain enumeration, unlike {@link quotedList}'s
 *  alternatives phrasing (`'a', 'b', or 'c'`): the keys named here are all
 *  present together (every duplicate, every missing key), not alternatives. */
function quotedCommaList(names: readonly string[]): string {
  return names.map((name) => `'${name}'`).join(", ");
}

/** A configured field's status row: its configuration, plus whether the
 *  JavaScript Templates gate currently leaves it inert. */
function frontmatterFieldRow(
  field: FrontmatterField,
  inertKeys: readonly string[],
): FrontmatterFieldRow {
  return {
    key: field.key,
    expr: field.expr,
    language: field.language,
    merge: field.merge,
    inert: inertKeys.includes(field.key),
  };
}

/**
 * A configured field's `frontmatter-eval` row: its evaluated value, its own
 * runtime error, or `inert` when the JavaScript Templates gate left it
 * uncompiled — evaluating never reports more than one of those three.
 */
function frontmatterEvalRow(
  field: FrontmatterField,
  evaluated: {
    values: Readonly<Record<string, unknown>>;
    errors: Readonly<Record<string, string>>;
    inertKeys: readonly string[];
  },
): FrontmatterEvalRow {
  const base = {
    key: field.key,
    source: "user" as const,
    language: field.language,
    merge: field.merge,
  };
  if (evaluated.inertKeys.includes(field.key)) return { ...base, inert: true };
  const error = evaluated.errors[field.key];
  if (error !== undefined) return { ...base, error: { message: error } };
  return { ...base, value: evaluated.values[field.key] };
}

/**
 * The system row every literature note carries: `zotero-key`.
 */
function systemFrontmatterRows(zt: object): FrontmatterEvalRow[] {
  const { indexedKey } = zt as { indexedKey: string };
  return [
    {
      key: FIELD_ZOTERO_KEY,
      source: "system",
      language: null,
      merge: null,
      value: indexedKey,
    },
  ];
}

/** The one warning `frontmatter-eval` answers with when the JavaScript
 *  Templates gate leaves fields inert: a real note operation would skip the
 *  same keys, so this warns before a caller drafts a field expression that
 *  would silently do nothing on this device. */
function gateWarnings(inertKeys: readonly string[]): readonly string[] {
  if (inertKeys.length === 0) return [];
  return [
    `JavaScript Templates are disabled on this device; these fields are inert and a real note operation would fail to write them: ${inertKeys.join(", ")}.`,
  ];
}

/**
 * The root-variable warnings a render answers with: one string per read of a
 * root other than `zt`, the single root Template data lives under.
 *
 * @returns one warning string per non-`zt` root read; an empty array for
 *   `null` (an Eta template, whose source this static analysis cannot see).
 */
function rootVariableWarnings(
  uses: readonly RootVariableUse[] | null,
): readonly string[] {
  if (uses === null) return [];
  return uses
    .filter((use) => use.name !== "zt")
    .map(
      (use) =>
        `line ${use.row}, col ${use.col}: '${use.path}' reads root variable '${use.name}', which is not defined — template data lives under 'zt.*' (write 'zt.${use.path}')`,
    );
}

/**
 * The active Template a render answered from, as status reports it.
 *
 * @throws when `name` has no status entry. `parseRenderRequest` restricts the
 *   slot to `TEMPLATE_SLOT_ROOTS` keys and `TEMPLATE_NAMES` covers those keys,
 *   so production reaches this only through a hand-built dependency.
 */
function templateIdentity(
  statuses: readonly TemplateFileStatus[],
  name: TemplateSlot,
): {
  name: TemplateSlot;
  language: TemplateFileStatus["winner"]["language"];
  source: TemplateFileStatus["winner"]["source"];
} {
  const status = statuses.find((candidate) => candidate.name === name);
  if (!status) throw new Error(`Template status is missing for '${name}'.`);
  return { name, ...status.winner };
}
