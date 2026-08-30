// Per-color highlight output choices shared by settings and Note Import.
import * as v from "valibot";

import type { AnnotationColorName } from "@zotlit/db";

export const HIGHLIGHT_EMOJI = ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣"] as const;

const defaultOutput = {
  red: "🔴",
  orange: "🟠",
  yellow: "🟡",
  green: "🟢",
  blue: "🔵",
  purple: "🟣",
  magenta: "mark",
  gray: "mark",
  plum: "mark",
} as const satisfies Record<AnnotationColorName, string>;

export const HIGHLIGHT_COLORS = Object.keys(
  defaultOutput,
) as AnnotationColorName[];
const highlightColor = v.picklist(HIGHLIGHT_COLORS);

const highlightMapping = v.object({
  output: v.picklist(["mark", ...HIGHLIGHT_EMOJI, "custom"]),
  // Keep draft input so incomplete custom mappings use HTML until corrected.
  customEmoji: v.string(),
});
export type HighlightMapping = v.InferOutput<typeof highlightMapping>;

export const highlightMappingsSchema = v.record(
  highlightColor,
  highlightMapping,
);
export type HighlightMappings = v.InferOutput<typeof highlightMappingsSchema>;

const singleEmoji = v.pipe(v.string(), v.emoji(), v.graphemes(1));

export function isHighlightEmoji(value: string): boolean {
  return v.is(singleEmoji, value);
}

export function getHighlightMapping(
  mappings: HighlightMappings,
  color: AnnotationColorName,
): HighlightMapping {
  return mappings[color] ?? { output: defaultOutput[color], customEmoji: "" };
}

export function highlightEmoji(
  color: string | null | undefined,
  mappings: HighlightMappings = {},
): string | null {
  if (!v.is(highlightColor, color)) return null;
  const { output, customEmoji } = getHighlightMapping(mappings, color);
  if (output === "mark") return null;
  if (output === "custom")
    return isHighlightEmoji(customEmoji) ? customEmoji : null;
  return output;
}
