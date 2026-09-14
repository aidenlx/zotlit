// Saved-source checking and attempt retention. Output flags only disclose completed work.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { CliFlags, CliHandler } from "obsidian";

import type { CitationVariant, NoteTemplateContext } from "@zotlit/db";
import {
  parseLiteratureNoteTemplate,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import { serializeTemplateData } from "@zotlit/workbench/explorer";
import {
  captureRenderReport,
  renderIdentity,
  isCitationExampleId,
} from "@zotlit/workbench/render";
import type {
  RenderCallerSource,
  RenderDiagnostic,
  PartialContext,
} from "@zotlit/workbench/render";

import {
  parseProfileSelector,
  PROFILE_ID_LENGTH,
  PROFILE_ID_RULE,
} from "@/lib/profile-stamp";
import { bindDraftProfile } from "@/services/profile/service";
import {
  checkDiagnostic,
  checkNativeProfile,
  PROFILE_OUTPUTS,
} from "@/views/note-preview/check-profile";
import type { ProfileCheck } from "@/views/note-preview/check-profile";

import { selectCheckBaseline } from "./check-baseline";
import { loadTemplateData, loadCitationData, withSelectedNote } from "./data";
import type { TemplateDataDeps } from "./data";
import { CONTRACT_VERSION } from "./envelope";
import { createInspectHandler, sourceRevision } from "./inspect";
import type { InspectDeps, InspectDocument, SourceVersion } from "./inspect";
import { INSPECT_DIAGNOSTICS } from "./inspect-contract";
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
  Each run receives a new attempt ID. The last ${RETAINED_ATTEMPTS} attempts remain available until
  plugin reload. Reading an expired attempt reports ATTEMPT_NOT_FOUND.

RETAINED ATTEMPTS
  ${ATTEMPT_LOOKUP_HELP}

FLAGS
${Object.entries(checkFlags)
  .map(([name, flag]) => `  ${name}: ${flag.description}`)
  .join("\n")}`;

interface InspectedSource {
  ok: boolean;
  source?: string;
  document?: InspectDocument;
  input?: { revision: string; path: string | null; origin: string };
  freshness?: { state: string; versions: SourceVersion[] };
  [key: string]: unknown;
}

export interface CheckDeps extends InspectDeps {
  data: TemplateDataDeps;
  pluginVersion: string;
  hostVersion: string;
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
    let reportSource = "";
    let dataRevision = "";
    let reportLanguage: string | undefined;
    let reportDocument: string | undefined;
    let reportRoot = "note";
    let reportPartial = false;
    let reportProfile: string | undefined;
    let itemKey = params.key as string;
    let baseline:
      | Extract<Awaited<ReturnType<typeof selectCheckBaseline>>, { ok: true }>
      | undefined;
    let selectedProfile: { id: string; label: string } | undefined;
    const reportContext = () => ({
      document: reportDocument,
      language: reportLanguage,
      root: reportRoot,
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
      diagnostic: T,
    ) => ({
      ...diagnostic,
      report: captureRenderReport({
        diagnostic,
        identity: {
          ...renderIdentity({
            source: reportSource,
            snapshot: dataRevision ? { revision: dataRevision } : null,
            mode,
          }),
          ...(reportRoot === "citation"
            ? {
                citationVariant: (params.variant ?? "main") as CitationVariant,
                ...(typeof params.example === "string" &&
                isCitationExampleId(params.example)
                  ? { citationExample: params.example }
                  : {}),
              }
            : {}),
          ...(reportPartial
            ? {
                partialContext: reportRoot as PartialContext,
                partialProfile: reportProfile ?? params.profile ?? "default",
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
          ...reportContext(),
          ...(diagnostic.annotation
            ? { root: "annotation", selection: diagnostic.annotation.key }
            : {}),
        },
      }),
    });
    const finish = (result: object) => {
      const checked = result as { checks?: Record<string, ProfileCheck> };
      for (const check of Object.values(checked.checks ?? {}))
        check.diagnostics = check.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          ...attachReport(diagnostic),
        }));
      const retained = {
        ...result,
        command: TEMPLATE_CHECK_COMMAND,
        contractVersion: CONTRACT_VERSION,
        attempt,
        attemptContext: {
          sequence: attemptSequence,
          capturedAt,
          mode,
          sourceRevision: reportSource ? sourceRevision(reportSource) : null,
          dataRevision: dataRevision || null,
          ...reportContext(),
        },
        ...(baseline
          ? {
              baseline: {
                kind: baseline.kind,
                indexedKey: itemKey,
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
                outcome: (result as { ok?: boolean }).ok
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
      reportDocument = params.draft;
      try {
        if (!isAbsolute(params.draft))
          throw new Error("Use an absolute scratch-file path for draft.");
        draft = {
          source: await readFile(params.draft, "utf8"),
          path: params.draft,
        };
        reportSource = draft.source;
      } catch (error) {
        return finish({
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
        const parent = await loadTemplateData(deps.data, itemKey, "filename");
        if (
          parent.kind !== "data" ||
          !("indexedKey" in parent.data) ||
          typeof parent.data.indexedKey !== "string"
        )
          return finish({
            ok: false,
            diagnostic: {
              code: "TARGET_NOT_FOUND",
              message: "The selected Zotero item is unavailable.",
              recovery:
                "Select an existing item, attachment, annotation, or child-note key and run the check again.",
            },
          });
        itemKey = parent.data.indexedKey;
        const selected = await selectCheckBaseline(deps.data, {
          key: itemKey,
          note: params.note as string | undefined,
          existing: params.existing as string | undefined,
        });
        if (!selected.ok) return finish(selected);
        baseline = selected;
        if (
          params.profile === undefined &&
          params.document === undefined &&
          params.draft === undefined &&
          baseline.stamp &&
          (!baseline.stamp.id ||
            !deps.profile.resolveProfile(baseline.stamp.id))
        )
          return finish({
            ok: false,
            diagnostic: {
              code: "UNKNOWN_PROFILE_STAMP",
              message:
                "The baseline's Profile stamp does not resolve. Select an explicit Profile to preview a change.",
              stamp: baseline.stamp.stamp,
            },
          });
      } catch (error) {
        return finish({
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
              (draft ? "default" : (baseline?.stamp?.id ?? "default")),
          }),
      ...(params["expect-source"] !== undefined
        ? { "expect-source": params["expect-source"] }
        : {}),
      source: "full",
    };
    const inspected = JSON.parse(
      (await inspect(inspectRequest)) as string,
    ) as InspectedSource;
    const { source, ...context } = inspected;
    if (draft && inspected.document?.kind === "profile") {
      context.input = {
        origin: "draft",
        path: draft.path,
        revision: sourceRevision(draft.source),
      };
      // Installed document diagnostics describe the saved version, not this draft.
      context.problems = [];
      context.document = {
        kind: "profile",
        id: "draft",
        label: "Draft",
        path: draft.path,
        problems: [],
      };
    }
    reportSource = source ?? draft?.source ?? "";
    reportDocument =
      draft?.path ?? inspected.document?.path ?? inspected.document?.id;
    if (!inspected.ok) return finish(context);
    if (
      inspected.document?.kind === "profile" &&
      params.document !== undefined &&
      params.profile !== undefined
    )
      return finish({
        ...context,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Select a Profile with profile or document, one at a time.",
          recovery: "Omit profile when selecting a Profile document.",
        },
      });
    if (source !== undefined && inspected.document?.kind !== "profile") {
      const document = inspected.document!;
      const root = document.kind === "citation" ? "citation" : params.root;
      reportRoot = (root as string | undefined) ?? "note";
      reportPartial = document.kind === "partial";
      if (
        mode !== "create" ||
        (document.kind === "citation" && params.root !== undefined) ||
        (root !== "citation" &&
          (params.example !== undefined || params.variant !== undefined)) ||
        (document.kind === "partial" &&
          root === undefined &&
          (params.key !== undefined || params.example !== undefined))
      )
        return finish({
          ...context,
          ok: false,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message:
              "Select a partial caller root and applicable data; plain documents use create mode.",
          },
        });
      if (
        document.problems.some(
          (problem) => problem.code === "RESERVED_PARTIAL_NAME",
        )
      )
        return finish({
          ...context,
          ok: false,
          diagnostic: {
            code: "RESERVED_PARTIAL_NAME",
            ...INSPECT_DIAGNOSTICS.RESERVED_PARTIAL_NAME,
          },
        });
      const checks: Record<string, ProfileCheck> = {
        structure: { status: "not-checked", diagnostics: [] },
        [document.kind]: { status: "not-checked", diagnostics: [] },
      };
      let caller: RenderCallerSource = { source, language: "liquid" };
      try {
        const parsed = parsePlainTemplateDocument(source);
        reportLanguage = parsed.manifest.language;
        caller = { source, language: parsed.manifest.language };
        if (
          reportLanguage === "eta" &&
          !deps.templates.javascriptTemplatesEnabled
        )
          return finish({
            ...context,
            ok: false,
            checks,
            rendering: "not-checked",
            diagnostic: {
              ...attachReport({
                code: "render-error",
                part: "render",
                message: "JavaScript Templates are disabled on this device.",
                recovery:
                  "Enable JavaScript Templates on this device or use a Liquid document.",
              }),
              code: "ETA_OPT_IN_REQUIRED",
              message: "JavaScript Templates are disabled on this device.",
              evidence: {
                kind: "javascript-gate",
                enabled: false,
                source: inspected.input,
                language: reportLanguage,
              },
            },
          });
        const inspectBindings = createInspectHandler(
          deps,
          undefined,
          draft ? document.id : undefined,
        );
        const profileInspection = JSON.parse(
          (await inspectBindings({
            profile: params.profile ?? "default",
            source: "full",
          })) as string,
        ) as InspectedSource;
        if (!profileInspection.ok)
          return finish({
            ...context,
            ok: false,
            checks,
            diagnostic: profileInspection.diagnostic,
            bindingContext: {
              document: profileInspection.document,
              input: profileInspection.input,
              freshness: profileInspection.freshness,
            },
          });
        const profileId =
          profileInspection.document?.profile?.id ??
          profileInspection.document?.profileIdentity?.id ??
          "default";
        const selector = parseProfileSelector(profileId);
        const profile =
          selector === undefined
            ? undefined
            : deps.profile.resolveProfile(selector);
        if (!profile) throw new Error("The selected Profile does not resolve.");
        reportProfile = profile.selector;
        context.selectedProfile = {
          id: profile.selector,
          bindings: profile.bindings,
        };
        context.bindingContext = {
          input: profileInspection.input,
          freshness: profileInspection.freshness,
        };
        checks.structure = { status: "passed", diagnostics: [] };
        if (params.key === undefined && params.example === undefined)
          return finish({
            ...context,
            ok: true,
            checks,
            rendering: "not-checked",
            reason: "Provide key or a Citation example to check rendering.",
          });
        const data = {
          ...deps.data,
          settings: { loaded: Promise.resolve(profile.settings) },
        };
        const loaded =
          root === "citation"
            ? await loadCitationData(
                data,
                typeof params.example === "string" &&
                  isCitationExampleId(params.example)
                  ? { example: params.example }
                  : { key: params.key as string },
                (params.variant ?? "main") as CitationVariant,
              )
            : await loadTemplateData(
                data,
                params.key as string,
                root as "note" | "annotation",
              );
        if (loaded.kind !== "data")
          return finish({
            ...context,
            ok: false,
            checks,
            diagnostic: {
              code: "INVALID_SELECTOR",
              message: `The selected data is unavailable: ${loaded.kind}.`,
              recovery:
                root === "annotation"
                  ? "Select an existing annotation key with a readable parent attachment."
                  : "Select an existing item key, or use a built-in example for the Citation root.",
            },
          });
        const { citation: _citation, ...annotationDescriptors } =
          Object.getOwnPropertyDescriptors(loaded.data);
        dataRevision = sourceRevision(
          JSON.stringify(
            serializeTemplateData(
              root === "annotation"
                ? Object.defineProperties({}, annotationDescriptors)
                : loaded.data,
              root as "note" | "annotation" | "citation",
            ),
          ),
        );
        try {
          const rendered =
            document.kind === "citation"
              ? deps.templates.renderCitationSource(
                  source,
                  loaded.data as import("@zotlit/db").CitationTemplateData,
                )
              : deps.templates.renderPartialSource(source, loaded.data, {
                  name: document.label,
                });
          checks[document.kind] = {
            status: "passed",
            diagnostics: [],
            output: rendered,
          };
        } catch (error) {
          checks[document.kind] = {
            status: "failed",
            diagnostics: [checkDiagnostic(error, caller)],
          };
        }
        const after = JSON.parse(
          (await inspect(inspectRequest)) as string,
        ) as InspectedSource;
        const profileAfter = JSON.parse(
          (await inspectBindings({
            profile: params.profile ?? "default",
            source: "full",
          })) as string,
        ) as InspectedSource;
        if (
          !after.ok ||
          after.input?.revision !== inspected.input?.revision ||
          JSON.stringify(after.freshness?.versions) !==
            JSON.stringify(inspected.freshness?.versions) ||
          !profileAfter.ok ||
          profileAfter.input?.revision !== profileInspection.input?.revision ||
          JSON.stringify(profileAfter.freshness?.versions) !==
            JSON.stringify(profileInspection.freshness?.versions)
        )
          return finish({
            ...context,
            ok: false,
            rendering: "checked",
            freshness: {
              ...inspected.freshness,
              state: "superseded",
              after: after.freshness,
            },
            bindingContext: {
              before: context.bindingContext,
              after: {
                input: profileAfter.input,
                freshness: profileAfter.freshness,
                diagnostic: profileAfter.diagnostic,
              },
            },
            diagnostic: {
              code: "SOURCE_SUPERSEDED",
              message: "Source changed during this attempt. Run a new check.",
            },
          });
        return finish({
          ...context,
          checks,
          ok: Object.values(checks).every((check) => check.status === "passed"),
          rendering: "checked",
        });
      } catch (error) {
        const diagnostic = checkDiagnostic(error, caller);
        checks.structure = { status: "failed", diagnostics: [diagnostic] };
        return finish({
          ...context,
          ok: false,
          checks,
          diagnostic: attachReport(diagnostic),
        });
      }
    }
    if (
      params.root !== undefined ||
      params.variant !== undefined ||
      params.example !== undefined ||
      (params.draft !== undefined && params.document !== undefined)
    )
      return finish({
        ...context,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Profile checks select item data with key.",
          recovery:
            "Use key to select item data. Check the Citation Template with document=citation, and reserve root for template-data and Shared Partial checks.",
        },
      });
    if (inspected.document?.kind !== "profile" || source === undefined)
      return finish({
        ...context,
        ok: false,
        diagnostic: {
          code: "INVALID_SELECTOR",
          message: "Select a saved Profile document.",
        },
      });
    const checks: Record<string, ProfileCheck> = Object.fromEntries(
      ["structure", ...PROFILE_OUTPUTS].map((name) => [
        name,
        { status: "not-checked", diagnostics: [] },
      ]),
    );
    let caller: RenderCallerSource = { source, language: "liquid" };
    try {
      const parsed = parseLiteratureNoteTemplate(source);
      if (
        draft &&
        params.profile !== undefined &&
        parsed.manifest.id !==
          (inspected.document.profile?.id ??
            inspected.document.profileIdentity?.id)
      )
        return finish({
          ...context,
          ok: false,
          checks: {
            ...checks,
            structure: { status: "failed", diagnostics: [] },
          },
          diagnostic: {
            code: "PROFILE_ID_MISMATCH",
            message:
              "The draft manifest ID does not match the selected Profile.",
            recovery:
              "Keep the selected Profile ID in the draft, or omit profile to check a standalone identity.",
          },
        });
      reportLanguage = parsed.manifest.language ?? "liquid";
      caller = {
        source,
        language: parsed.manifest.language ?? "liquid",
        profileId: parsed.manifest.id,
      };
      if (
        !deps.templates.javascriptTemplatesEnabled &&
        (parsed.manifest.language === "eta" ||
          parsed.manifest.frontmatter?.some((entry) => "js" in entry))
      ) {
        const entries =
          parsed.manifest.frontmatter?.flatMap((entry, index) =>
            "js" in entry
              ? [
                  {
                    position: index + 1,
                    ...("key" in entry ? { key: entry.key } : {}),
                    expression: entry.js,
                  },
                ]
              : [],
          ) ?? [];
        if (entries.length)
          checks.properties = {
            status: "failed",
            entries: entries.map(({ position, key }) => ({
              position,
              key,
              status: "failed",
            })),
            diagnostics: entries.map(({ position, key }) => ({
              code: "property-javascript",
              part: "properties",
              position,
              ...(key ? { key } : {}),
              message: "JavaScript Templates are disabled on this device.",
              recovery:
                "Enable JavaScript Templates or replace this entry with a JSON-e value.",
            })),
          };
        return finish({
          ...context,
          ok: false,
          checks,
          diagnostic: {
            code: "ETA_OPT_IN_REQUIRED",
            message:
              "JavaScript Templates are disabled on this device. Enable the gate or use Liquid and JSON-e entries.",
            evidence: {
              kind: "javascript-gate",
              enabled: false,
              source: inspected.input,
              language: parsed.manifest.language ?? "liquid",
              entries,
            },
          },
          rendering: "not-checked",
        });
      }
      const document =
        deps.templates.prepareLiteratureNoteTemplateSource(source);
      const selector = parseProfileSelector(document.manifest.id ?? "default");
      if (draft && selector === undefined)
        return finish({
          ...context,
          ok: false,
          checks: {
            ...checks,
            structure: { status: "failed", diagnostics: [] },
          },
          diagnostic: {
            code: "INVALID_PROFILE_ID",
            message: PROFILE_ID_RULE,
            recovery: `Set the draft manifest id to 'default' or to a ${PROFILE_ID_LENGTH}-character Profile ID, then check the draft again.`,
          },
        });
      const profile =
        selector === undefined
          ? undefined
          : draft
            ? bindDraftProfile(
                await deps.data.settings.loaded,
                selector,
                document.manifest,
              )
            : deps.profile.resolveProfile(selector);
      if (!profile) throw new Error("The saved Profile does not resolve.");
      if (draft)
        context.document = {
          kind: "profile",
          id: profile.selector,
          label: profile.label ?? "Default",
          path: draft.path,
          profile: {
            id: profile.selector,
            label: profile.label ?? "Default",
            bindings: profile.bindings,
          },
          problems: [],
        };
      checks.structure = { status: "passed", diagnostics: [] };
      if (params.key === undefined)
        return finish({
          ...context,
          ok: true,
          checks,
          rendering: "not-checked",
          reason:
            "Structural validation only; provide key to check rendering with real item data.",
        });
      selectedProfile = {
        id: profile.selector,
        label: profile.label ?? "Default",
      };
      const profileData = {
        ...deps.data,
        settings: { loaded: Promise.resolve(profile.settings) },
      };
      const data = baseline
        ? withSelectedNote(profileData, { key: itemKey, path: baseline.path })
        : profileData;
      const [note, filename] = await Promise.all([
        loadTemplateData(data, params.key as string, "note"),
        loadTemplateData(data, params.key as string, "filename"),
      ]);
      if (note.kind !== "data" || filename.kind !== "data")
        throw new Error("The selected Zotero item is unavailable.");
      dataRevision = sourceRevision(
        JSON.stringify({
          note: serializeTemplateData(note.data, "note"),
          filename: serializeTemplateData(filename.data, "filename"),
        }),
      );
      const annotations = await Promise.all(
        (note.data as NoteTemplateContext).annotations.map(
          async (annotation) => {
            const key = annotation.indexedKey;
            try {
              const loaded = await loadTemplateData(data, key, "annotation");
              if (loaded.kind !== "data")
                return {
                  key,
                  error: new Error("The selected annotation is unavailable."),
                };
              // Citation is derived from a separately verified Template source;
              // fingerprint the loaded annotation data without invoking that getter.
              const { citation: _citation, ...descriptors } =
                Object.getOwnPropertyDescriptors(loaded.data);
              const revision = sourceRevision(
                JSON.stringify(
                  serializeTemplateData(
                    Object.defineProperties({}, descriptors),
                    "annotation",
                  ),
                ),
              );
              return { key, data: loaded.data, revision };
            } catch (error) {
              return { key, error };
            }
          },
        ),
      );
      Object.assign(
        checks,
        checkNativeProfile(deps.templates, {
          document,
          profile,
          source,
          note: note.data as NoteTemplateContext,
          filename: filename.data,
          annotations,
          ...(baseline ? { existing: baseline.source } : {}),
        }),
      );
      const after = JSON.parse(
        (await inspect(inspectRequest)) as string,
      ) as InspectedSource;
      if (baseline?.kind === "real") {
        const file = deps.app.vault.getFileByPath(baseline.path!);
        if (!file || (await deps.app.vault.read(file)) !== baseline.source)
          return finish({
            ...context,
            ok: false,
            rendering: "checked",
            diagnostic: {
              code: "BASELINE_SUPERSEDED",
              message:
                "The Literature Note changed during this attempt. Run a new check.",
            },
          });
      }
      if (
        !after.ok ||
        sourceRevision(after.source ?? "") !== inspected.input?.revision ||
        JSON.stringify(after.freshness?.versions) !==
          JSON.stringify(inspected.freshness?.versions)
      )
        return finish({
          ...context,
          ok: false,
          diagnostic: {
            code: "SOURCE_SUPERSEDED",
            message: "Source changed during this attempt. Run a new check.",
          },
          freshness: {
            ...inspected.freshness,
            state: "superseded",
            after: after.freshness,
          },
          rendering: "checked",
        });
      return finish({
        ...context,
        ok: Object.values(checks).every((check) => check.status === "passed"),
        checks,
        rendering: "checked",
      });
    } catch (error) {
      const diagnostic = attachReport(checkDiagnostic(error, caller));
      if (checks.structure?.status !== "passed")
        checks.structure = { status: "failed", diagnostics: [diagnostic] };
      return finish({ ...context, ok: false, checks, diagnostic });
    }
  };
}
