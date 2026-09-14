// Complete, write-free Profile checking through the native preview's composition boundary.
import { stringifyYaml } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";
import { replaceSuffixMarkers } from "@zotlit/templates";
import { stringifyFrontmatterInOrder } from "@zotlit/templates/frontmatter";
import { FRONTMATTER_ABSENT } from "@zotlit/templates/frontmatter-merge";
import type { EvaluatedFrontmatterField } from "@zotlit/templates/frontmatter-merge";
import {
  engineEvidence,
  renderFailureDiagnostic,
} from "@zotlit/workbench/render";
import type {
  RenderCallerSource,
  RenderDiagnostic,
} from "@zotlit/workbench/render";

import { applyComposedFrontmatter } from "@/services/note-feature/compose";
import { prepareManagedFrontmatter } from "@/services/note-feature/frontmatter";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { TemplateService } from "@/services/template/service";

import { previewBaseline } from "./baseline";

export const PROFILE_OUTPUTS = [
  "filename",
  "properties",
  "fold",
  "frontmatter",
  "body",
  "managed",
  "annotations",
] as const;
export type ProfileOutput = (typeof PROFILE_OUTPUTS)[number];
export interface ProfileCheck {
  status: "passed" | "failed" | "not-checked";
  behavior?: "static-body" | "managed-region";
  output?: unknown;
  diagnostics: (RenderDiagnostic & {
    recovery: string;
    key?: string;
    annotation?: { key: string; revision?: string };
  })[];
  entries?: {
    key?: string;
    position?: number;
    status: ProfileCheck["status"];
  }[];
}

/** One native preview/check row per independent Managed Frontmatter contribution. */
export function nativePropertyRows(
  fields: readonly EvaluatedFrontmatterField[],
) {
  return fields.map((field) => {
    const missing =
      field.value === undefined || field.value === FRONTMATTER_ABSENT;
    return {
      key: field.key,
      position: field.position!,
      missing,
      ...(missing ? {} : { value: field.value }),
    };
  });
}

/** Keep the original engine report and only source locations verified by shared diagnosis. */
export function checkDiagnostic(error: unknown, caller: RenderCallerSource) {
  return {
    ...renderFailureDiagnostic(error, caller),
    evidence: engineEvidence(error),
    recovery:
      "Repair the reported source, then run template-check again. Use attempt=<id> evidence=full to read this attempt's original engine report.",
  };
}

/** Each component executes independently; disclosure is applied after all checks finish. */
export function checkNativeProfile(
  templates: Pick<TemplateService, "render" | "frontmatterFields">,
  input: {
    document: ReturnType<
      TemplateService["prepareLiteratureNoteTemplateSource"]
    >;
    profile: ResolvedProfile;
    source: string;
    note: NoteTemplateContext;
    filename: object;
    /** Undefined selects create; null selects a synthetic update baseline. */
    existing?: string | null;
    annotations: readonly {
      key: string;
      revision?: string;
      data?: object;
      error?: unknown;
    }[];
  },
): Record<ProfileOutput, ProfileCheck> {
  const { document, profile, source, note } = input;
  const caller = {
    source,
    language: document.manifest.language ?? "liquid",
    profileId: document.manifest.id,
  } as const;
  const unchecked = (): ProfileCheck => ({
    status: "not-checked",
    diagnostics: [],
  });
  const checks: Record<ProfileOutput, ProfileCheck> = {
    filename: unchecked(),
    properties: unchecked(),
    fold: unchecked(),
    frontmatter: unchecked(),
    body: unchecked(),
    managed: unchecked(),
    annotations: unchecked(),
  };
  const run = (name: ProfileOutput, operation: () => unknown) => {
    const check: ProfileCheck = { status: "passed", diagnostics: [] };
    checks[name] = check;
    try {
      check.output = operation();
    } catch (error) {
      checks[name] = {
        status: "failed",
        diagnostics: [checkDiagnostic(error, caller)],
      };
    }
  };
  run("filename", () =>
    replaceSuffixMarkers(document.renderFilename(input.filename), () => ""),
  );
  run("body", () => document.renderForCreate(note));
  run("managed", () => document.renderForUpdate(note));
  const updating = input.existing !== undefined;
  if (
    updating &&
    checks.body.status === "passed" &&
    checks.managed.status === "passed"
  ) {
    const created = checks.body.output as string;
    const managed = checks.managed.output as string | null;
    run("body", () => previewBaseline(input.existing!, created, managed).body);
    checks.body.behavior = managed === null ? "static-body" : "managed-region";
  }
  const annotations: {
    key: string;
    check: ProfileCheck;
    citation?: unknown;
  }[] = [];
  for (const annotation of input.annotations) {
    try {
      if (annotation.error !== undefined) throw annotation.error;
      if (annotation.data === undefined)
        throw new Error("The selected annotation is unavailable.");
      const output = document.renderAnnotation(annotation.data);
      const citation =
        "citation" in annotation.data ? annotation.data.citation : undefined;
      annotations.push({
        key: annotation.key,
        ...(citation === undefined ? {} : { citation }),
        check: {
          status: "passed",
          output,
          diagnostics: [],
        },
      });
    } catch (error) {
      annotations.push({
        key: annotation.key,
        check: {
          status: "failed",
          diagnostics: [
            {
              ...checkDiagnostic(error, caller),
              part: "annotation",
              annotation: {
                key: annotation.key,
                revision: annotation.revision,
              },
            },
          ],
        },
      });
    }
  }
  checks.annotations = {
    status: annotations.some(({ check }) => check.status === "failed")
      ? "failed"
      : "passed",
    output: annotations,
    entries: annotations.map(({ key, check }) => ({
      key,
      status: check.status,
    })),
    diagnostics: annotations.flatMap(({ check }) => check.diagnostics),
  };
  run("properties", () => {
    const result = prepareManagedFrontmatter(
      document.frontmatter,
      note,
      Temporal.Now.instant(),
    );
    const fields =
      "failures" in result
        ? result.evaluation.values
        : result.prepared.kind === "document"
          ? result.prepared.fields
          : [];
    return { result, fields };
  });
  if (checks.properties.status === "passed") {
    const { result, fields } = checks.properties.output as {
      result: ReturnType<typeof prepareManagedFrontmatter>;
      fields: readonly EvaluatedFrontmatterField[];
    };
    checks.properties.output = nativePropertyRows(fields).map((row, index) =>
      updating
        ? {
            ...row,
            merge: fields[index]!.merge,
            omission: row.missing
              ? fields[index]!.value === FRONTMATTER_ABSENT &&
                fields[index]!.merge === "replace"
                ? "static-key-deleted"
                : "preserved"
              : undefined,
          }
        : row,
    );
    if (updating) {
      const rows = checks.properties.output as object[];
      document.manifest.frontmatter?.forEach((entry, index) => {
        if (
          !("key" in entry) &&
          !fields.some((field) => field.position === index + 1)
        )
          rows.push({
            position: index + 1,
            missing: true,
            omission: "spread-omitted",
            merge: entry.merge ?? "replace",
          });
      });
    }
    checks.properties.entries = document.manifest.frontmatter?.map(
      (entry, index) => ({
        ...("key" in entry ? { key: entry.key } : {}),
        position: index + 1,
        status:
          "failures" in result &&
          result.evaluation.errors.some((error) => error.position === index + 1)
            ? "failed"
            : "passed",
      }),
    );
    if ("failures" in result) {
      checks.properties.status = "failed";
      checks.properties.diagnostics = result.evaluation.errors.map(
        ({ error, key, position }) => ({
          ...checkDiagnostic(error, caller),
          key,
          position,
        }),
      );
    } else {
      run("fold", () => {
        const frontmatter: Record<string, unknown> = updating
          ? previewBaseline(input.existing!, "", null).frontmatter
          : {};
        applyComposedFrontmatter({ template: templates }, frontmatter, {
          context: note,
          itemKey: note.indexedKey,
          profile,
          prepared: result.prepared,
          onConflict: (key, detail) =>
            checks.fold.diagnostics.push({
              code: "property-append-conflict",
              params: { key },
              position: detail.position,
              recovery:
                "Use compatible array values or change the entry's merge strategy.",
            }),
        });
        return frontmatter;
      });
      if (checks.fold.status === "passed")
        run("frontmatter", () =>
          updating
            ? stringifyYaml(checks.fold.output)
            : stringifyFrontmatterInOrder(
                checks.fold.output as Record<string, unknown>,
                result.prepared.kind === "document" ? result.prepared.keys : [],
              ),
        );
    }
  }
  return checks;
}
