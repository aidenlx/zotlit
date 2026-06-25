import * as v from "valibot";

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

export const frontmatterFieldSchema = v.object({
  key: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  expr: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  merge: frontmatterMergeStrategySchema,
});
export type FrontmatterField = v.InferOutput<typeof frontmatterFieldSchema>;
