// Saved-source checking and attempt retention. Output flags only disclose completed work.
import { randomUUID } from "node:crypto";
import type { CliFlags, CliHandler } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";
import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";
import { serializeTemplateData } from "@zotlit/workbench/explorer";
import { captureRenderReport, renderIdentity } from "@zotlit/workbench/render";
import type {
  RenderCallerSource,
  RenderDiagnostic,
} from "@zotlit/workbench/render";

import { parseProfileSelector } from "@/lib/profile-stamp";
import {
  checkDiagnostic,
  checkNativeProfile,
  PROFILE_OUTPUTS,
} from "@/views/note-preview/check-profile";
import type { ProfileCheck } from "@/views/note-preview/check-profile";

import { loadTemplateData } from "./data";
import type { TemplateDataDeps } from "./data";
import { CONTRACT_VERSION } from "./envelope";
import { createInspectHandler, sourceRevision } from "./inspect";
import type { InspectDeps, InspectDocument, SourceVersion } from "./inspect";

export const TEMPLATE_CHECK_COMMAND = "zotlit:template-check";
export const checkFlags = {
  profile: {
    value: "<id-or-label>",
    description: "Saved Profile or default; defaults to default",
  },
  document: {
    value: "<path-or-reference>",
    description: "Saved Profile document",
  },
  key: {
    value: "<indexed-key>",
    description: "Real item to render; omit for structural validation only",
  },
  output: {
    value: `<${PROFILE_OUTPUTS.join(",")}|all>`,
    description:
      "Comma-separated complete outputs to disclose; default compact",
  },
  attempt: {
    value: "<id>",
    description: "Read a retained attempt without rerunning it",
  },
  evidence: {
    value: "full",
    description: "Include original engine reports from this attempt",
  },
  "expect-source": {
    value: "<source-id>",
    description: "Required Zotero source identity",
  },
} satisfies CliFlags;
export const CHECK_GUIDE = `TEMPLATE CHECK

  obsidian ${TEMPLATE_CHECK_COMMAND} [profile=<id-or-label>] [key=<indexed-key>] [output=all]
  obsidian ${TEMPLATE_CHECK_COMMAND} attempt=<id> evidence=full [output=all]

  Checks saved Profile source and dependencies, then all create components.
  Omit key for structural validation; rendering is explicitly not checked.
  Every response includes every component status. output changes disclosure only.
  An empty rendered string is a successful output. Any component failure fails the check.
  Each run receives a new attempt ID. The last 32 attempts remain available until
  plugin reload. Reading an expired attempt reports ATTEMPT_NOT_FOUND.

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
  const inspect = createInspectHandler(deps);
  const attempts = new Map<string, object>();
  let sequence = 0;
  return async (params) => {
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
    const fail = (code: string, message: string) =>
      answer({
        contractVersion: CONTRACT_VERSION,
        command: TEMPLATE_CHECK_COMMAND,
        ok: false,
        diagnostic: { code, message },
      });
    if (
      Object.keys(params).some((key) => !(key in checkFlags)) ||
      (params.output !== undefined &&
        (typeof params.output !== "string" ||
          output.some(
            (name) =>
              name !== "all" &&
              !(PROFILE_OUTPUTS as readonly string[]).includes(name),
          ))) ||
      (params.evidence !== undefined && params.evidence !== "full") ||
      [params.key, params.profile, params.document, params.attempt].some(
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
        params.key !== undefined ||
        params["expect-source"] !== undefined
      )
        return fail(
          "INVALID_SELECTOR",
          "An attempt lookup takes only attempt, output, and evidence.",
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
    const reportContext = () => ({
      document: reportDocument,
      language: reportLanguage,
      root: "note",
      selection: typeof params.key === "string" ? params.key : undefined,
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
            mode: "create",
          }),
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
          mode: "create",
          sourceRevision: reportSource ? sourceRevision(reportSource) : null,
          dataRevision: dataRevision || null,
          ...reportContext(),
        },
        request: {
          profile: params.profile,
          document: params.document,
          key: params.key,
        },
      };
      attempts.set(attempt, JSON.parse(JSON.stringify(retained)) as object);
      if (attempts.size > 32) attempts.delete(attempts.keys().next().value!);
      return answer(retained);
    };
    const inspectRequest = {
      ...(params.document !== undefined
        ? { document: params.document }
        : { profile: params.profile ?? "default" }),
      ...(params.profile !== undefined && params.document !== undefined
        ? { profile: params.profile }
        : {}),
      ...(params["expect-source"] !== undefined
        ? { "expect-source": params["expect-source"] }
        : {}),
      source: "full",
    };
    const inspected = JSON.parse(
      (await inspect(inspectRequest)) as string,
    ) as InspectedSource;
    const { source, ...context } = inspected;
    reportSource = source ?? "";
    reportDocument = inspected.document?.path ?? inspected.document?.id;
    if (!inspected.ok) return finish(context);
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
      const selector = parseProfileSelector(document.manifest.id ?? "default");
      const profile =
        selector === undefined
          ? undefined
          : deps.profile.resolveProfile(selector);
      if (!profile) throw new Error("The saved Profile does not resolve.");
      const data = {
        ...deps.data,
        settings: { loaded: Promise.resolve(profile.settings) },
      };
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
        }),
      );
      const after = JSON.parse(
        (await inspect(inspectRequest)) as string,
      ) as InspectedSource;
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
