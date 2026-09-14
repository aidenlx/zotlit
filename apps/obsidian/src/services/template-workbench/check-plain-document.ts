// The check's plain-document branch: a Citation Template, a Shared Partial, or a
// plain draft, rendered against one caller root. The entry module keeps request
// parsing, Check Attempt retention, and answer assembly, and hands this branch
// every input it reads.
import type { CitationVariant } from "@zotlit/db";
import { parsePlainTemplateDocument } from "@zotlit/templates/facade";
import { serializeTemplateData } from "@zotlit/workbench/explorer";
import { isCitationExampleId } from "@zotlit/workbench/render";
import type { RenderCallerSource } from "@zotlit/workbench/render";

import { parseProfileSelector } from "@/lib/profile-stamp";
import { checkDiagnostic } from "@/views/note-preview/check-profile";
import type { ProfileCheck } from "@/views/note-preview/check-profile";

import type { CheckBranch, CheckContext, InspectedSource } from "./check";
import { loadCitationData, loadTemplateData } from "./data";
import { createInspectHandler, sourceRevision } from "./inspect";
import { INSPECT_DIAGNOSTICS } from "./inspect-contract";
import type { InspectDiagnosticCode } from "./inspect-contract";

/** The refusal a Reserved Partial Name carries, as the inspection registry names it. */
export const RESERVED_PARTIAL_NAME =
  "RESERVED_PARTIAL_NAME" satisfies InspectDiagnosticCode;

/** Checks a document the Profile branch does not own, and answers the attempt. */
export async function checkPlainDocument({
  deps,
  params,
  mode,
  draft,
  inspect,
  inspectRequest,
  inspected,
  source,
  context,
  attachReport,
  finish,
}: CheckBranch): Promise<string> {
  const document = inspected.document!;
  const root = document.kind === "citation" ? "citation" : params.root;
  let documentContext: CheckContext = {
    ...context,
    root: (root as string | undefined) ?? "note",
    partial: document.kind === "partial",
  };
  if (
    mode !== "create" ||
    (document.kind === "citation" && params.root !== undefined) ||
    (root !== "citation" &&
      (params.example !== undefined || params.variant !== undefined)) ||
    (document.kind === "partial" &&
      root === undefined &&
      (params.key !== undefined || params.example !== undefined))
  )
    return finish(documentContext, {
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        message:
          "Select a partial caller root and applicable data; plain documents use create mode.",
      },
    });
  if (
    document.problems.some((problem) => problem.code === RESERVED_PARTIAL_NAME)
  )
    return finish(documentContext, {
      ok: false,
      diagnostic: {
        code: RESERVED_PARTIAL_NAME,
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
    documentContext = {
      ...documentContext,
      language: parsed.manifest.language,
    };
    caller = { source, language: parsed.manifest.language };
    if (
      documentContext.language === "eta" &&
      !deps.templates.javascriptTemplatesEnabled
    )
      return finish(documentContext, {
        ok: false,
        checks,
        rendering: "not-checked",
        diagnostic: {
          ...attachReport(documentContext, {
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
            language: documentContext.language,
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
      return finish(documentContext, {
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
    documentContext = {
      ...documentContext,
      answer: {
        ...documentContext.answer,
        selectedProfile: {
          id: profile.selector,
          bindings: profile.bindings,
        },
        bindingContext: {
          input: profileInspection.input,
          freshness: profileInspection.freshness,
        },
      },
      profileSelector: profile.selector,
    };
    checks.structure = { status: "passed", diagnostics: [] };
    if (params.key === undefined && params.example === undefined)
      return finish(documentContext, {
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
      return finish(documentContext, {
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
    documentContext = {
      ...documentContext,
      dataRevision: sourceRevision(
        JSON.stringify(
          serializeTemplateData(
            root === "annotation"
              ? Object.defineProperties({}, annotationDescriptors)
              : loaded.data,
            root as "note" | "annotation" | "citation",
          ),
        ),
      ),
    };
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
      return finish(documentContext, {
        ok: false,
        rendering: "checked",
        freshness: {
          ...inspected.freshness,
          state: "superseded",
          after: after.freshness,
        },
        bindingContext: {
          before: documentContext.answer.bindingContext,
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
    return finish(documentContext, {
      checks,
      ok: Object.values(checks).every((check) => check.status === "passed"),
      rendering: "checked",
    });
  } catch (error) {
    const diagnostic = checkDiagnostic(error, caller);
    checks.structure = { status: "failed", diagnostics: [diagnostic] };
    return finish(documentContext, {
      ok: false,
      checks,
      diagnostic: attachReport(documentContext, diagnostic),
    });
  }
}
