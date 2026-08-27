import * as v from "valibot";

export type TemplateLanguage = "liquid" | "eta";

/**
 * Eta `autoTrim` mode for one side of a template tag. `"nl"` strips a single
 * newline, `"slurp"` strips all whitespace, `false` keeps it. Single source of
 * truth for both the runtime validator and the {@link AutoTrim} type.
 */
export const autoTrimSchema = v.union([
  v.literal(false),
  v.literal("nl"),
  v.literal("slurp"),
]);

export const DEFAULT_AUTO_TRIM: Readonly<
  Record<"leading" | "trailing", AutoTrim>
> = {
  leading: false,
  trailing: false,
};

export type AutoTrim = v.InferOutput<typeof autoTrimSchema>;

export const frontmatterMergeStrategySchema = v.picklist([
  "replace",
  "append",
  "keep",
]);
export type FrontmatterMergeStrategy = v.InferOutput<
  typeof frontmatterMergeStrategySchema
>;

/**
 * An expression always evaluates in its declared language — the JavaScript
 * Templates gate never reinterprets an expression, it only decides whether
 * `"javascript"` fields run.
 */
export const frontmatterLanguageSchema = v.picklist(["liquid", "javascript"]);
export type FrontmatterLanguage = v.InferOutput<
  typeof frontmatterLanguageSchema
>;

export const frontmatterFieldSchema = v.object({
  key: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  expr: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  merge: frontmatterMergeStrategySchema,
  language: frontmatterLanguageSchema,
});
export type FrontmatterField = v.InferOutput<typeof frontmatterFieldSchema>;
