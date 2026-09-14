// Saved-source checking and attempt retention. Output flags only disclose completed work.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { CliFlags, CliHandler } from "obsidian";

import type { CitationVariant } from "@zotlit/db";
import {
  captureRenderReport,
  renderIdentity,
  isCitationExampleId,
} from "@zotlit/workbench/render";
import type {
  RenderDiagnostic,
  PartialContext,
} from "@zotlit/workbench/render";

import { PROFILE_OUTPUTS } from "@/views/note-preview/check-profile";
import type { ProfileCheck } from "@/views/note-preview/check-profile";

import { selectCheckBaseline } from "./check-baseline";
import {
  checkPlainDocument,
  RESERVED_PARTIAL_NAME,
} from "./check-plain-document";
import {
  checkProfileDocument,
  INVALID_PROFILE_ID,
  PROFILE_ID_MISMATCH,
} from "./check-profile-document";
import { loadTemplateData } from "./data";
import type { TemplateDataDeps } from "./data";
import { CONTRACT_VERSION } from "./envelope";
import { createInspectHandler, sourceRevision } from "./inspect";
import type { InspectDeps, InspectDocument, SourceVersion } from "./inspect";
import {
  choices,
  CITATION_VARIANT_NAMES,
  PARTIAL_CONTEXT_NAMES,
} from "./vocabulary";

export const TEMPLATE_CHECK_COMMAND = "zotlit:template-check";
/** How many finished attempts stay readable; the oldest is evicted beyond it. */
const RETAINED_ATTEMPTS = 32;
const ATTEMPT_LOOKUP_HELP =
  "Keep the same vault prefix. Use only attempt, output, and evidence for a retained lookup; omit expect-source and all input selectors. Example: zotlit:template-check attempt=<id> evidence=full output=all. The retained result carries the original source identity.";
export const checkFlags = {
  root: {
    value: choices(PARTIAL_CONTEXT_NAMES),
    description: "Shared Partial caller root; required for partial rendering",
  },
  example: {
    value: "<example-id>",
    description: "Built-in Citation example instead of key",
  },
  variant: {
    value: choices(CITATION_VARIANT_NAMES),
    description: "Citation Variant; defaults to main",
  },
  mode: {
    value: "<create|update>",
    description: "Operation to check; defaults to create",
  },
  note: {
    value: "<vault-path>",
    description: "Update baseline: select one matching Literature Note",
  },
  existing: {
    value: "<text>",
    description: "Update baseline: supplied note text, checked in memory",
  },
  profile: {
    value: "<id-or-label>",
    description:
      "Saved Profile or default; update follows the baseline stamp when omitted",
  },
  document: {
    value: "<path-or-reference>",
    description:
      "Profile, citation, or partial:<name>; also identifies a plain draft",
  },
  draft: {
    value: "<absolute-path>",
    description:
      "Read complete Profile source from a scratch file; profile asserts its identity",
  },
  key: {
    value: "<indexed-key>",
    description: "Real item to render; omit for structural validation only",
  },
  output: {
    value: `<${PROFILE_OUTPUTS.join(",")},citation,partial|all>`,
    description:
      "Comma-separated complete outputs to disclose; default compact",
  },
  attempt: {
    value: "<id>",
    description: `Read a retained attempt without rerunning it. ${ATTEMPT_LOOKUP_HELP}`,
  },
  evidence: {
    value: "full",
    description: "Include original engine reports from this attempt",
  },
  "expect-source": {
    value: "<source-id>",
    description:
      "Zotero source identity assertion for a new check; omit for retained attempt lookups",
  },
} satisfies CliFlags;
export const CHECK_GUIDE = `TEMPLATE CHECK

  obsidian ${TEMPLATE_CHECK_COMMAND} [profile=<id-or-label>] [key=<indexed-key>] [output=all]
  obsidian ${TEMPLATE_CHECK_COMMAND} draft=/absolute/path/draft.md [profile=<id-or-label>] [key=<indexed-key>]
  obsidian ${TEMPLATE_CHECK_COMMAND} attempt=<id> evidence=full [output=all]

  Checks saved Profile source and dependencies, then all operation components.
  draft reads a complete document from a scratch file, without installing or saving it.
  With profile, the draft ID must match that Profile. Without profile, its manifest
  supplies a standalone identity. Draft bindings inherit current Default settings.
  Saved source is the default. Editor source is selected explicitly by template-inspect;
  to check unsaved edits, write them to a scratch file and supply draft.
  Create mode renders a complete new note and reads no existing note as a baseline.
  When the item has a Literature Note, its first indexed note supplies zt.notePath,
  zt.noteLink, and the source path that resolves links and attachments.
  A second note of the same item is never read.
  Use mode=update key=<indexed-key> to read the item's real Literature Note.
  Multiple notes require note=<vault-path>. existing=<text> supplies a controlled
  in-memory baseline. An item without a note uses a labeled synthetic baseline.
  Update follows the baseline's Profile stamp; an explicit Profile or document
  previews a proposed change. Baseline path, revision, stamp, and selected Profile
  identify the inputs. Body and frontmatter outputs show the final update fold.
  Static bodies remain unchanged. Failed fields or invalid blocks refuse the operation.
  No check writes notes, changes Profiles, or imports attachments.
  Omit key for structural validation; rendering is explicitly not checked.
  Every response includes every component status. output changes disclosure only.
  Citation Templates use document=citation with key or example and variant=${CITATION_VARIANT_NAMES.join("|")}.
  Shared Partials use document=partial:<name> and root=${PARTIAL_CONTEXT_NAMES.join("|")}.
  Note and Annotation callers select key. Citation callers select key or example.
  Direct partial checks use the selected Profile's bindings, or Default. Partials
  called by a Profile draft use that draft's bindings. Supply document with draft
  to identify plain draft source, which stays uninstalled.
  An empty rendered string is a successful output. Any component failure fails the check.
  A refused document identity is not a failed check, and the answer says which one it is.
  ${RESERVED_PARTIAL_NAME} is raised before the source is parsed and carries no checks; none ran.
  ${INVALID_PROFILE_ID} and ${PROFILE_ID_MISMATCH} are raised from parsing and carry the checks map with the failed check.
  Each run receives a new attempt ID. The last ${RETAINED_ATTEMPTS} attempts remain available until
  plugin reload. Reading an expired attempt reports ATTEMPT_NOT_FOUND.

RETAINED ATTEMPTS
  ${ATTEMPT_LOOKUP_HELP}

FLAGS
${Object.entries(checkFlags)
  .map(([name, flag]) => `  ${name}: ${flag.description}`)
  .join("\n")}`;

/** The inspection fields a check answer repeats, beside the source itself. */
export interface InspectedAnswer {
  ok?: boolean;
  document?: InspectDocument;
  input?: { revision: string; path: string | null; origin: string };
  freshness?: { state: string; versions: SourceVersion[] };
  [key: string]: unknown;
}

export interface InspectedSource extends InspectedAnswer {
  source?: string;
}

/**
 * What one check phase hands to the answer assembly: the inspection fields the
 * answer repeats, and the evidence a Check Attempt and a render report read. A
 * phase extends it by value and passes the extension on, so the answer never
 * reads state a distant branch wrote.
 */
export interface CheckContext {
  readonly answer: Readonly<InspectedAnswer>;
  /** Checked source text the render report fingerprints. */
  readonly source: string;
  /** Fingerprint of the data a render read; empty until data is loaded. */
  readonly dataRevision: string;
  /** Template language the report context names. */
  readonly language?: string;
  /** Document path or ID the report context names. */
  readonly documentPath?: string;
  /** Caller root the report context names. */
  readonly root: string;
  /** Whether the checked document is a Shared Partial. */
  readonly partial: boolean;
  /** Profile selector a partial render report names. */
  readonly profileSelector?: string;
  /** Indexed key the baseline block reports. */
  readonly itemKey: string;
  readonly baseline?: Extract<
    Awaited<ReturnType<typeof selectCheckBaseline>>,
    { ok: true }
  >;
  /** Profile the baseline block reports. */
  readonly selectedProfile?: { id: string; label: string };
}

export interface CheckDeps extends InspectDeps {
  data: TemplateDataDeps;
  pluginVersion: string;
  hostVersion: string;
}

/** Attaches the attempt's render report to one diagnostic the branch raises. */
type AttachReport = <
  T extends RenderDiagnostic & {
    annotation?: { key: string; revision?: string };
  },
>(
  context: CheckContext,
  diagnostic: T,
) => T & { report: ReturnType<typeof captureRenderReport> };

/**
 * What the entry module hands one document branch: the parsed request, the
 * acquired source with its inspection, and the two closures the entry module
 * owns — render-report attachment and Check Attempt retention.
 */
export interface CheckBranch {
  deps: CheckDeps;
  params: Parameters<CliHandler>[0];
  mode: "create" | "update";
  draft: { source: string; path: string } | undefined;
  /** Reruns the source inspection to detect a superseded source. */
  inspect: CliHandler;
  inspectRequest: Parameters<CliHandler>[0];
  inspected: InspectedSource;
  /** Checked source text, acquired before the branch runs. */
  source: string;
  context: CheckContext;
  attachReport: AttachReport;
  finish: (context: CheckContext, result: object) => string;
}

/**
 * A {@link CheckBranch} carrying the inspected document the entry module's kind
 * guard established, so the Profile branch reads it without asserting it.
 */
export interface ProfileCheckBranch extends CheckBranch {
  inspectedDocument: InspectDocument;
}

export function createCheckHandler(deps: CheckDeps): CliHandler {
  const attempts = new Map<string, object>();
  let sequence = 0;
  return async (params) => {
    const mode = params.mode === "update" ? "update" : "create";
    const output =
      typeof params.output === "string" ? params.output.split(",") : [];
    const answer = (result: object) => {
      // Construct a separate disclosure tree so retained attempts keep all outputs.
      const copy = JSON.parse(JSON.stringify(result)) as {
        checks?: Record<string, ProfileCheck>;
        diagnostic?: { evidence?: unknown; report?: unknown };
      };
      if (params.evidence !== "full") {
        for (const check of Object.values(copy.checks ?? {})) {
          for (const diagnostic of check.diagnostics) {
            Reflect.deleteProperty(diagnostic, "evidence");
            Reflect.deleteProperty(diagnostic, "report");
          }
          if (Array.isArray(check.output)) {
            for (const annotation of check.output) {
              if (annotation?.check?.diagnostics)
                for (const diagnostic of annotation.check.diagnostics) {
                  delete diagnostic.evidence;
                  delete diagnostic.report;
                }
            }
          }
        }
        if (copy.diagnostic) {
          delete copy.diagnostic.evidence;
          delete copy.diagnostic.report;
        }
      }
      const outputs = Object.fromEntries(
        Object.entries(copy.checks ?? {})
          .filter(([name]) => output.includes("all") || output.includes(name))
          .map(([name, check]) => [name, check.output]),
      );
      for (const check of Object.values(copy.checks ?? {})) delete check.output;
      return JSON.stringify({
        ...copy,
        ...(Object.keys(outputs).length ? { outputs } : {}),
      });
    };
    const fail = (code: string, message: string, hint?: string) =>
      answer({
        contractVersion: CONTRACT_VERSION,
        command: TEMPLATE_CHECK_COMMAND,
        ok: false,
        diagnostic: { code, message, ...(hint === undefined ? {} : { hint }) },
      });
    if (
      Object.keys(params).some((key) => !(key in checkFlags)) ||
      (params.output !== undefined &&
        (typeof params.output !== "string" ||
          output.some(
            (name) =>
              name !== "all" &&
              ![...PROFILE_OUTPUTS, "citation", "partial"].includes(name),
          ))) ||
      (params.evidence !== undefined && params.evidence !== "full") ||
      (params.example !== undefined &&
        (typeof params.example !== "string" ||
          !isCitationExampleId(params.example) ||
          params.key !== undefined)) ||
      (params.variant !== undefined &&
        !(CITATION_VARIANT_NAMES as readonly string[]).includes(
          params.variant as string,
        )) ||
      (params.root !== undefined &&
        !(PARTIAL_CONTEXT_NAMES as readonly string[]).includes(
          params.root as string,
        )) ||
      (params.mode !== undefined &&
        params.mode !== "create" &&
        params.mode !== "update") ||
      (params.existing !== undefined && typeof params.existing !== "string") ||
      (params.note !== undefined && params.existing !== undefined) ||
      ((params.note !== undefined || params.existing !== undefined) &&
        mode !== "update") ||
      (mode === "update" && params.key === undefined) ||
      [
        params.key,
        params.profile,
        params.document,
        params.draft,
        params.attempt,
        params.note,
      ].some(
        (value) =>
          value !== undefined &&
          (typeof value !== "string" || value.trim() === ""),
      )
    )
      return fail(
        "INVALID_SELECTOR",
        "Use help zotlit:template-check for accepted selectors and disclosure flags.",
      );
    if (params.attempt !== undefined) {
      if (
        params.profile !== undefined ||
        params.document !== undefined ||
        params.draft !== undefined ||
        params.key !== undefined ||
        params.mode !== undefined ||
        params.note !== undefined ||
        params.existing !== undefined ||
        params.root !== undefined ||
        params.variant !== undefined ||
        params.example !== undefined ||
        params["expect-source"] !== undefined
      )
        return fail(
          "INVALID_SELECTOR",
          "An attempt lookup takes only attempt, output, and evidence.",
          ATTEMPT_LOOKUP_HELP,
        );
      const retained = attempts.get(params.attempt as string);
      return retained
        ? answer(retained)
        : fail(
            "ATTEMPT_NOT_FOUND",
            "This attempt is unavailable. Run a new check to obtain a new attempt ID.",
          );
    }
    const attempt = randomUUID();
    const attemptSequence = ++sequence;
    const capturedAt = Temporal.Now.instant().toString();
    // Source acquisition extends this before either document branch takes over.
    let sourceContext: CheckContext = {
      answer: {},
      source: "",
      dataRevision: "",
      root: "note",
      partial: false,
      itemKey: params.key as string,
    };
    const reportContext = (context: CheckContext) => ({
      document: context.documentPath,
      language: context.language,
      root: context.root,
      selection:
        typeof params.key === "string"
          ? params.key
          : (params.example as string | undefined),
      zotlitVersion: deps.pluginVersion,
      hostVersion: deps.hostVersion,
    });
    const attachReport = <
      T extends RenderDiagnostic & {
        annotation?: { key: string; revision?: string };
      },
    >(
      context: CheckContext,
      diagnostic: T,
    ) => ({
      ...diagnostic,
      report: captureRenderReport({
        diagnostic,
        identity: {
          ...renderIdentity({
            source: context.source,
            snapshot: context.dataRevision
              ? { revision: context.dataRevision }
              : null,
            mode,
          }),
          ...(context.root === "citation"
            ? {
                citationVariant: (params.variant ?? "main") as CitationVariant,
                ...(typeof params.example === "string" &&
                isCitationExampleId(params.example)
                  ? { citationExample: params.example }
                  : {}),
              }
            : {}),
          ...(context.partial
            ? {
                partialContext: context.root as PartialContext,
                partialProfile:
                  context.profileSelector ?? params.profile ?? "default",
              }
            : {}),
          ...(diagnostic.annotation
            ? {
                annotationId: diagnostic.annotation.key,
                annotationRevision: diagnostic.annotation.revision,
              }
            : {}),
        },
        trigger: "explicit",
        sequence: attemptSequence,
        capturedAt,
        context: {
          ...reportContext(context),
          ...(diagnostic.annotation
            ? { root: "annotation", selection: diagnostic.annotation.key }
            : {}),
        },
      }),
    });
    const finish = (context: CheckContext, result: object) => {
      const merged: object = { ...context.answer, ...result };
      const { checks } = merged as { checks?: Record<string, ProfileCheck> };
      // The checks map a branch passes stays the branch's own record, so the
      // attempt reports go into a copy. A branch that answers twice — the
      // Profile branch's catch around its own finish — then reads the map it
      // built, not the report the first answer attached.
      const answered: object = checks
        ? {
            ...merged,
            checks: Object.fromEntries(
              Object.entries(checks).map(([name, check]) => [
                name,
                {
                  ...check,
                  diagnostics: check.diagnostics.map((diagnostic) => ({
                    ...diagnostic,
                    ...attachReport(context, diagnostic),
                  })),
                },
              ]),
            ),
          }
        : merged;
      const { baseline, selectedProfile } = context;
      const retained = {
        ...answered,
        command: TEMPLATE_CHECK_COMMAND,
        contractVersion: CONTRACT_VERSION,
        attempt,
        attemptContext: {
          sequence: attemptSequence,
          capturedAt,
          mode,
          sourceRevision: context.source
            ? sourceRevision(context.source)
            : null,
          dataRevision: context.dataRevision || null,
          ...reportContext(context),
        },
        ...(baseline
          ? {
              baseline: {
                kind: baseline.kind,
                indexedKey: context.itemKey,
                path: baseline.path,
                revision:
                  baseline.source === null
                    ? null
                    : sourceRevision(baseline.source),
                profile: {
                  id: baseline.stamp?.id ?? (baseline.stamp ? null : "default"),
                  stamp: baseline.stamp?.stamp ?? null,
                },
              },
              selectedProfile,
              proposedProfileChange:
                baseline.kind !== "synthetic" &&
                selectedProfile !== undefined &&
                selectedProfile.id !==
                  (baseline.stamp?.id ?? (baseline.stamp ? null : "default")),
              operation: {
                outcome: (answered as { ok?: boolean }).ok
                  ? "previewed"
                  : "refused",
              },
            }
          : {}),
        request: {
          profile: params.profile,
          document: params.document,
          draft: params.draft,
          key: params.key,
          root: params.root,
          variant: params.variant,
          example: params.example,
          mode,
          note: params.note,
        },
      };
      attempts.set(attempt, JSON.parse(JSON.stringify(retained)) as object);
      if (attempts.size > RETAINED_ATTEMPTS)
        attempts.delete(attempts.keys().next().value!);
      return answer(retained);
    };
    let draft: { source: string; path: string } | undefined;
    if (typeof params.draft === "string") {
      const input = { origin: "draft", path: params.draft, revision: null };
      sourceContext = { ...sourceContext, documentPath: params.draft };
      try {
        if (!isAbsolute(params.draft))
          throw new Error("Use an absolute scratch-file path for draft.");
        draft = {
          source: await readFile(params.draft, "utf8"),
          path: params.draft,
        };
        sourceContext = { ...sourceContext, source: draft.source };
      } catch (error) {
        return finish(sourceContext, {
          ok: false,
          input,
          diagnostic: {
            code: "DRAFT_READ_FAILED",
            message: error instanceof Error ? error.message : String(error),
            recovery:
              "Write a complete Profile document to a readable scratch file and supply its absolute path as draft.",
          },
        });
      }
    }
    if (mode === "update") {
      try {
        await deps.profile.ready;
        const parent = await loadTemplateData(
          deps.data,
          sourceContext.itemKey,
          "filename",
        );
        if (
          parent.kind !== "data" ||
          !("indexedKey" in parent.data) ||
          typeof parent.data.indexedKey !== "string"
        )
          return finish(sourceContext, {
            ok: false,
            diagnostic: {
              code: "TARGET_NOT_FOUND",
              message: "The selected Zotero item is unavailable.",
              recovery:
                "Select an existing item, attachment, annotation, or child-note key and run the check again.",
            },
          });
        sourceContext = {
          ...sourceContext,
          itemKey: parent.data.indexedKey,
        };
        const selected = await selectCheckBaseline(deps.data, {
          key: sourceContext.itemKey,
          note: params.note as string | undefined,
          existing: params.existing as string | undefined,
        });
        if (!selected.ok) return finish(sourceContext, selected);
        sourceContext = { ...sourceContext, baseline: selected };
        if (
          params.profile === undefined &&
          params.document === undefined &&
          params.draft === undefined &&
          selected.stamp &&
          (!selected.stamp.id ||
            !deps.profile.resolveProfile(selected.stamp.id))
        )
          return finish(sourceContext, {
            ok: false,
            diagnostic: {
              code: "UNKNOWN_PROFILE_STAMP",
              message:
                "The baseline's Profile stamp does not resolve. Select an explicit Profile to preview a change.",
              stamp: selected.stamp.stamp,
            },
          });
      } catch (error) {
        return finish(sourceContext, {
          ok: false,
          diagnostic: {
            code: "BASELINE_READ_FAILED",
            message: error instanceof Error ? error.message : String(error),
            recovery:
              "Restore access to the selected Zotero source and run the update check again.",
          },
        });
      }
    }
    const inspect = createInspectHandler(deps, draft);
    const inspectRequest = {
      ...(params.document !== undefined
        ? { document: params.document }
        : {
            profile:
              params.profile ??
              (draft
                ? "default"
                : (sourceContext.baseline?.stamp?.id ?? "default")),
          }),
      ...(params["expect-source"] !== undefined
        ? { "expect-source": params["expect-source"] }
        : {}),
      source: "full",
    };
    const inspected = JSON.parse(
      (await inspect(inspectRequest)) as string,
    ) as InspectedSource;
    const { source, ...inspectedAnswer } = inspected;
    const inspectedContext: CheckContext = {
      ...sourceContext,
      answer:
        draft && inspected.document?.kind === "profile"
          ? {
              ...inspectedAnswer,
              input: {
                origin: "draft",
                path: draft.path,
                revision: sourceRevision(draft.source),
              },
              // Installed document diagnostics describe the saved version, not this draft.
              problems: [],
              document: {
                kind: "profile",
                id: "draft",
                label: "Draft",
                path: draft.path,
                problems: [],
              },
            }
          : inspectedAnswer,
      source: source ?? draft?.source ?? "",
      documentPath:
        draft?.path ?? inspected.document?.path ?? inspected.document?.id,
    };
    if (!inspected.ok) return finish(inspectedContext, {});
    if (
      inspected.document?.kind === "profile" &&
      params.document !== undefined &&
      params.profile !== undefined
    )
      return finish(inspectedContext, {
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Select a Profile with profile or document, one at a time.",
          recovery: "Omit profile when selecting a Profile document.",
        },
      });
    if (source !== undefined && inspected.document?.kind !== "profile")
      return checkPlainDocument({
        deps,
        params,
        mode,
        draft,
        inspect,
        inspectRequest,
        inspected,
        source,
        context: inspectedContext,
        attachReport,
        finish,
      });
    if (
      params.root !== undefined ||
      params.variant !== undefined ||
      params.example !== undefined ||
      (params.draft !== undefined && params.document !== undefined)
    )
      return finish(inspectedContext, {
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Profile checks select item data with key.",
          recovery:
            "Use key to select item data. Check the Citation Template with document=citation, and reserve root for template-data and Shared Partial checks.",
        },
      });
    if (inspected.document?.kind !== "profile" || source === undefined)
      return finish(inspectedContext, {
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Select a saved Profile document.",
        },
      });
    return checkProfileDocument({
      deps,
      params,
      mode,
      draft,
      inspect,
      inspectRequest,
      inspected,
      inspectedDocument: inspected.document,
      source,
      context: inspectedContext,
      attachReport,
      finish,
    });
  };
}
