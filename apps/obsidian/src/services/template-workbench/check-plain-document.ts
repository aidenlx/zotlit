// The check's plain-document branch: a Citation Template, a Shared Partial, or a
// plain draft, rendered against one caller root. The entry module keeps request
// parsing, the flag guards, Check Attempt retention, and answer assembly, and
// hands this branch every input it reads.
import { Effect, Schema } from "effect";

import type { CitationTemplateData, CitationVariant } from "@zotlit/db";
import { parsePlainTemplateDocument } from "@zotlit/templates/facade";
import { serializeTemplateData } from "@zotlit/workbench/explorer";
import { isCitationExampleId } from "@zotlit/workbench/render";
import type { RenderCallerSource } from "@zotlit/workbench/render";

import { parseProfileSelector } from "@/lib/profile-stamp";
import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";
import { checkDiagnostic } from "@/views/note-preview/check-profile";
import type { ProfileCheck } from "@/views/note-preview/check-profile";

import type {
  CheckContext,
  CheckOutcome,
  CheckServices,
  InspectedSource,
  PlainCheckBranch,
} from "./check";
import { readCitationData, readTemplateData, withSettings } from "./data";
import { createInspectHandler, sourceRevision } from "./inspect";
import { INSPECT_DIAGNOSTICS } from "./inspect-contract";
import type { InspectDiagnosticCode } from "./inspect-contract";
import { profileRead, templateCall, templateRead } from "./sync-template";

/** The refusal a Reserved Partial Name carries, as the inspection registry names it. */
export const RESERVED_PARTIAL_NAME =
  "RESERVED_PARTIAL_NAME" satisfies InspectDiagnosticCode;

/**
 * The checked source, or a Template it runs, threw `cause`, or the check
 * refused the source with the Error in `cause`. The check's answer reads
 * `cause`, as {@link thrown} gives it.
 */
export class CheckSourceThrew extends Schema.TaggedError<
  CheckSourceThrew,
  { readonly brand: unique symbol }
>()("CheckSourceThrew", { cause: Schema.Defect() }) {}

/** Runs `evaluate`, failing with what it threw as a {@link CheckSourceThrew}. */
export const attempt = <A>(evaluate: () => A) =>
  Effect.try({
    try: evaluate,
    catch: (cause) => new CheckSourceThrew({ cause }),
  });

/** What a failed check reports: what was thrown, or the failure itself. */
export const thrown = (error: unknown): unknown =>
  error instanceof CheckSourceThrew ? error.cause : error;

/** Checks a document the Profile branch does not own, and returns the answer. */
export const checkPlainDocument = Effect.fn(
  "TemplateWorkbenchCli.checkPlainDocument",
)(function* ({
  params,
  draft,
  inspect,
  inspectRequest,
  inspected,
  source,
  root,
  context,
  attachReport,
}: PlainCheckBranch): Effect.fn.Return<CheckOutcome, never, CheckServices> {
  const document = inspected.document!;
  let documentContext: CheckContext = context;
  if (
    document.problems.some((problem) => problem.code === RESERVED_PARTIAL_NAME)
  )
    return {
      context: documentContext,
      result: {
        ok: false,
        diagnostic: {
          code: RESERVED_PARTIAL_NAME,
          ...INSPECT_DIAGNOSTICS.RESERVED_PARTIAL_NAME,
        },
      },
    };
  const checks: Record<string, ProfileCheck> = {
    structure: { status: "not-checked", diagnostics: [] },
    [document.kind]: { status: "not-checked", diagnostics: [] },
  };
  let caller: RenderCallerSource = { source, language: "liquid" };
  // A failure anywhere below is the check's answer, as the source or a
  // Template it runs reported it.
  return yield* Effect.gen(function* (): Effect.fn.Return<
    CheckOutcome,
    unknown,
    CheckServices
  > {
    const parsed = yield* attempt(() => parsePlainTemplateDocument(source));
    documentContext = {
      ...documentContext,
      language: parsed.manifest.language,
    };
    caller = { source, language: parsed.manifest.language };
    const template = yield* Template;
    if (
      documentContext.language === "eta" &&
      !(yield* templateRead(template.javascriptTemplatesEnabled))
    )
      return {
        context: documentContext,
        result: {
          ok: false,
          checks,
          rendering: "not-checked",
          diagnostic: {
            ...attachReport(documentContext, {
              code: "render-error",
              part: "render",
              message: "JavaScript Templates are disabled on this device.",
              hint: "Enable JavaScript Templates on this device or use a Liquid document.",
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
        },
      };
    const inspectBindings = createInspectHandler(
      undefined,
      draft ? document.id : undefined,
    );
    const profileInspection = JSON.parse(
      yield* inspectBindings({
        profile: params.profile ?? "default",
        source: "full",
      }),
    ) as InspectedSource;
    if (!profileInspection.ok)
      return {
        context: documentContext,
        result: {
          ok: false,
          checks,
          diagnostic: profileInspection.diagnostic,
          bindingContext: {
            document: profileInspection.document,
            input: profileInspection.input,
            freshness: profileInspection.freshness,
          },
        },
      };
    const profileId =
      profileInspection.document?.profile?.id ??
      profileInspection.document?.profileIdentity?.id ??
      "default";
    const selector = parseProfileSelector(profileId);
    const profile =
      selector === undefined
        ? undefined
        : yield* profileRead((yield* Profile).resolveProfile(selector));
    if (!profile)
      return yield* new CheckSourceThrew({
        cause: new Error("The selected Profile does not resolve."),
      });
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
      return {
        context: documentContext,
        result: {
          ok: true,
          checks,
          rendering: "not-checked",
          reason: "Provide key or a Citation example to check rendering.",
        },
      };
    const loaded = yield* (
      root === "citation"
        ? readCitationData(
            typeof params.example === "string" &&
              isCitationExampleId(params.example)
              ? { example: params.example }
              : { key: params.key as string },
            (params.variant ?? "main") as CitationVariant,
          )
        : readTemplateData(
            params.key as string,
            root as "note" | "annotation",
          ).pipe(withSettings(profile.settings))
    ).pipe(Effect.mapError(({ cause }) => cause));
    if (loaded.kind !== "data")
      return {
        context: documentContext,
        result: {
          ok: false,
          checks,
          diagnostic: {
            code: "INVALID_SELECTOR",
            message: `The selected data is unavailable: ${loaded.kind}.`,
            hint:
              root === "annotation"
                ? "Select an existing annotation key with a readable parent attachment."
                : "Select an existing item key, or use a built-in example for the Citation root.",
          },
        },
      };
    const { citation: _citation, ...annotationDescriptors } =
      Object.getOwnPropertyDescriptors(loaded.data);
    const dataRevision = yield* attempt(() =>
      sourceRevision(
        JSON.stringify(
          serializeTemplateData(
            root === "annotation"
              ? Object.defineProperties({}, annotationDescriptors)
              : loaded.data,
            root as "note" | "annotation" | "citation",
          ),
        ),
      ),
    );
    documentContext = { ...documentContext, dataRevision };
    checks[document.kind] = yield* templateCall(
      document.kind === "citation"
        ? template.renderCitationSource(
            source,
            loaded.data as CitationTemplateData,
          )
        : template.renderPartialSource(source, loaded.data, {
            name: document.label,
          }),
    ).pipe(
      Effect.match({
        onSuccess: (rendered): ProfileCheck => ({
          status: "passed",
          diagnostics: [],
          output: rendered,
        }),
        onFailure: (error): ProfileCheck => ({
          status: "failed",
          diagnostics: [checkDiagnostic(error, caller)],
        }),
      }),
    );
    const after = JSON.parse(yield* inspect(inspectRequest)) as InspectedSource;
    const profileAfter = JSON.parse(
      yield* inspectBindings({
        profile: params.profile ?? "default",
        source: "full",
      }),
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
      return {
        context: documentContext,
        result: {
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
            message: "Source changed during this attempt.",
            hint: "Run a new check to read the current source.",
          },
        },
      };
    return {
      context: documentContext,
      result: {
        checks,
        ok: Object.values(checks).every((check) => check.status === "passed"),
        rendering: "checked",
      },
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.sync((): CheckOutcome => {
        const diagnostic = checkDiagnostic(thrown(error), caller);
        checks.structure = { status: "failed", diagnostics: [diagnostic] };
        return {
          context: documentContext,
          result: {
            ok: false,
            checks,
            diagnostic: attachReport(documentContext, diagnostic),
          },
        };
      }),
    ),
  );
});
