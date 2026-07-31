// The Template Workbench commands and their response boundaries.

import { type CliData, type CliHandler } from "obsidian";

import {
  TEMPLATE_SLOT_ROOTS,
  type ContractRoot,
  type TemplateSlot,
} from "@zotlit/db";
import { type RootVariableUse } from "@zotlit/templates/facade";

import { getLogger } from "@/lib/log";
import {
  type CompileError,
  type SettleOutcome,
  type TemplateFileStatus,
} from "@/services/template/service";

import { type TemplateDataLoadResult } from "./data";
import {
  dataLoadDiagnostic,
  diagnostic,
  envelope,
  initFailedDiagnostic,
  notSettledDiagnostic,
  templateFaultDiagnostic,
  type Diagnostic,
  type WorkbenchCommand,
  type WorkbenchIdentity,
} from "./envelope";
import { renderGuide } from "./guide";
import {
  parseDataRequest,
  parseGuideRequest,
  parseRenderRequest,
  parseSchemaRequest,
  parseSourceRequest,
  parseStatusRequest,
  targetMismatch,
  type ParsedRequest,
} from "./request";
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
export const TEMPLATE_GUIDE_COMMAND =
  "zotlit:template-guide" as const satisfies WorkbenchCommand;
export const TEMPLATE_SOURCE_COMMAND =
  "zotlit:template-source" as const satisfies WorkbenchCommand;

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
}

export type TemplateWorkbenchHandlers = Record<
  | typeof TEMPLATE_STATUS_COMMAND
  | typeof TEMPLATE_DATA_COMMAND
  | typeof TEMPLATE_SCHEMA_COMMAND
  | typeof TEMPLATE_RENDER_COMMAND
  | typeof TEMPLATE_GUIDE_COMMAND
  | typeof TEMPLATE_SOURCE_COMMAND,
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
  };
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
