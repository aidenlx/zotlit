// The check's Profile document branch: a saved Profile or a Profile draft,
// checked against real item data and the baseline the entry module selected. The
// entry module keeps request parsing, the flag guards, Check Attempt retention,
// and answer assembly, and hands this branch every input it reads.
import type { NoteTemplateContext } from "@zotlit/db";
import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";
import { serializeTemplateData } from "@zotlit/workbench/explorer";
import type { RenderCallerSource } from "@zotlit/workbench/render";

import { Effect } from "@/lib/effect";
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

import type {
  CheckOutcome,
  InspectedSource,
  ProfileCheckBranch,
} from "./check";
import { readTemplateData, withSelectedNote } from "./data";
import type { TemplateDataDeps } from "./data";
import { sourceRevision } from "./inspect";

/** The refusal a Template Draft identity that fails the Profile ID rule carries. */
export const INVALID_PROFILE_ID = "INVALID_PROFILE_ID";

/** The refusal a Template Draft whose manifest ID names another Profile carries. */
export const PROFILE_ID_MISMATCH = "PROFILE_ID_MISMATCH";

/** What the checked source, or a Template it runs, threw. */
const attempt = <A>(evaluate: () => A) =>
  Effect.try({ try: evaluate, catch: (error) => error });

/** The data of one root, failing with what failed to read or build it. */
const loadRoot = (
  data: TemplateDataDeps,
  key: string,
  root: "note" | "filename" | "annotation",
) =>
  readTemplateData(data, key, root).pipe(Effect.mapError(({ cause }) => cause));

/** Checks a Profile document or Profile draft, and returns the answer. */
export const checkProfileDocument = Effect.fn(
  "TemplateWorkbenchCli.checkProfileDocument",
)(function* ({
  deps,
  params,
  draft,
  inspect,
  inspectRequest,
  inspected,
  inspectedDocument,
  source,
  context,
  attachReport,
}: ProfileCheckBranch): Effect.fn.Return<CheckOutcome> {
  let profileContext = context;
  const checks: Record<string, ProfileCheck> = Object.fromEntries(
    ["structure", ...PROFILE_OUTPUTS].map((name) => [
      name,
      { status: "not-checked", diagnostics: [] },
    ]),
  );
  let caller: RenderCallerSource = { source, language: "liquid" };
  // A failure anywhere below is the check's answer, as the source or a
  // Template it runs reported it.
  return yield* Effect.gen(function* (): Effect.fn.Return<
    CheckOutcome,
    unknown
  > {
    const parsed = yield* attempt(() => parseLiteratureNoteTemplate(source));
    if (
      draft &&
      params.profile !== undefined &&
      parsed.manifest.id !==
        (inspectedDocument.profile?.id ?? inspectedDocument.profileIdentity?.id)
    )
      return {
        context: profileContext,
        result: {
          ok: false,
          checks: {
            ...checks,
            structure: { status: "failed", diagnostics: [] },
          },
          diagnostic: {
            code: PROFILE_ID_MISMATCH,
            message:
              "The draft manifest ID does not match the selected Profile.",
            hint: "Keep the selected Profile ID in the draft, or omit profile to check a standalone identity.",
          },
        },
      };
    profileContext = {
      ...profileContext,
      language: parsed.manifest.language ?? "liquid",
    };
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
            hint: "Enable JavaScript Templates or replace this entry with a JSON-e value.",
          })),
        };
      return {
        context: profileContext,
        result: {
          ok: false,
          checks,
          diagnostic: {
            code: "ETA_OPT_IN_REQUIRED",
            message: "JavaScript Templates are disabled on this device.",
            hint: "Ask the user to enable JavaScript Templates in ZotLit settings, or use Liquid and JSON-e entries.",
            evidence: {
              kind: "javascript-gate",
              enabled: false,
              source: inspected.input,
              language: parsed.manifest.language ?? "liquid",
              entries,
            },
          },
          rendering: "not-checked",
        },
      };
    }
    const document = yield* attempt(() =>
      deps.templates.prepareLiteratureNoteTemplateSource(source),
    );
    const selector = parseProfileSelector(document.manifest.id ?? "default");
    if (draft && selector === undefined)
      return {
        context: profileContext,
        result: {
          ok: false,
          checks: {
            ...checks,
            structure: { status: "failed", diagnostics: [] },
          },
          diagnostic: {
            code: INVALID_PROFILE_ID,
            message: PROFILE_ID_RULE,
            hint: `Set the draft manifest id to 'default' or to a Profile ID of ${PROFILE_ID_LENGTH} letters or digits, then check the draft again.`,
          },
        },
      };
    const settings = draft
      ? yield* Effect.tryPromise({
          try: () => deps.data.settings.loaded,
          catch: (error) => error,
        })
      : undefined;
    const profile = yield* attempt(() =>
      selector === undefined
        ? undefined
        : settings
          ? bindDraftProfile(settings, selector, document.manifest)
          : deps.profile.resolveProfile(selector),
    );
    if (!profile)
      return yield* Effect.fail(
        new Error("The saved Profile does not resolve."),
      );
    if (draft)
      profileContext = {
        ...profileContext,
        answer: {
          ...profileContext.answer,
          document: {
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
          },
        },
      };
    checks.structure = { status: "passed", diagnostics: [] };
    if (params.key === undefined)
      return {
        context: profileContext,
        result: {
          ok: true,
          checks,
          rendering: "not-checked",
          reason:
            "Structural validation only; provide key to check rendering with real item data.",
        },
      };
    profileContext = {
      ...profileContext,
      selectedProfile: {
        id: profile.selector,
        label: profile.label ?? "Default",
      },
    };
    const profileData = {
      ...deps.data,
      settings: { loaded: Promise.resolve(profile.settings) },
    };
    const baseline = profileContext.baseline;
    const data = baseline?.path
      ? withSelectedNote(profileData, {
          key: profileContext.itemKey,
          path: baseline.path,
        })
      : profileData;
    const [note, filename] = yield* Effect.all(
      [
        loadRoot(data, params.key as string, "note"),
        loadRoot(data, params.key as string, "filename"),
      ],
      { concurrency: "unbounded" },
    );
    if (note.kind !== "data" || filename.kind !== "data")
      return yield* Effect.fail(
        new Error("The selected Zotero item is unavailable."),
      );
    const dataRevision = yield* attempt(() =>
      sourceRevision(
        JSON.stringify({
          note: serializeTemplateData(note.data, "note"),
          filename: serializeTemplateData(filename.data, "filename"),
        }),
      ),
    );
    profileContext = { ...profileContext, dataRevision };
    const annotations = yield* Effect.forEach(
      (note.data as NoteTemplateContext).annotations,
      (annotation) => {
        const key = annotation.indexedKey;
        return Effect.gen(function* () {
          const loaded = yield* loadRoot(data, key, "annotation");
          if (loaded.kind !== "data")
            return {
              key,
              error: new Error("The selected annotation is unavailable."),
            };
          // Citation is derived from a separately verified Template source;
          // fingerprint the loaded annotation data without invoking that getter.
          const { citation: _citation, ...descriptors } =
            Object.getOwnPropertyDescriptors(loaded.data);
          const revision = yield* attempt(() =>
            sourceRevision(
              JSON.stringify(
                serializeTemplateData(
                  Object.defineProperties({}, descriptors),
                  "annotation",
                ),
              ),
            ),
          );
          return { key, data: loaded.data, revision };
        }).pipe(Effect.catch((error) => Effect.succeed({ key, error })));
      },
      { concurrency: "unbounded" },
    );
    Object.assign(
      checks,
      yield* attempt(() =>
        checkNativeProfile(deps.templates, {
          document,
          profile,
          source,
          note: note.data as NoteTemplateContext,
          filename: filename.data,
          annotations,
          ...(baseline ? { existing: baseline.source } : {}),
        }),
      ),
    );
    const after = JSON.parse(yield* inspect(inspectRequest)) as InspectedSource;
    if (baseline?.kind === "real") {
      const file = deps.app.vault.getFileByPath(baseline.path!);
      const current = file
        ? yield* Effect.tryPromise({
            try: () => deps.app.vault.read(file),
            catch: (error) => error,
          })
        : undefined;
      if (current !== baseline.source)
        return {
          context: profileContext,
          result: {
            ok: false,
            rendering: "checked",
            diagnostic: {
              code: "BASELINE_SUPERSEDED",
              message: "The Literature Note changed during this attempt.",
              hint: "Run a new check to read the current Literature Note.",
            },
          },
        };
    }
    if (
      !after.ok ||
      sourceRevision(after.source ?? "") !== inspected.input?.revision ||
      JSON.stringify(after.freshness?.versions) !==
        JSON.stringify(inspected.freshness?.versions)
    )
      return {
        context: profileContext,
        result: {
          ok: false,
          diagnostic: {
            code: "SOURCE_SUPERSEDED",
            message: "Source changed during this attempt.",
            hint: "Run a new check to read the current source.",
          },
          freshness: {
            ...inspected.freshness,
            state: "superseded",
            after: after.freshness,
          },
          rendering: "checked",
        },
      };
    return {
      context: profileContext,
      result: {
        ok: Object.values(checks).every((check) => check.status === "passed"),
        checks,
        rendering: "checked",
      },
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.sync((): CheckOutcome => {
        const diagnostic = attachReport(
          profileContext,
          checkDiagnostic(error, caller),
        );
        if (checks.structure?.status !== "passed")
          checks.structure = { status: "failed", diagnostics: [diagnostic] };
        return {
          context: profileContext,
          result: { ok: false, checks, diagnostic },
        };
      }),
    ),
  );
});
