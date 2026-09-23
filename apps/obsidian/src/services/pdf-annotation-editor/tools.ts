// The tools the reader's Creation Toolbar offers, and the colour each one
// remembers.
//
// One tool per Zotero annotation type, in the order Zotero's own reader shows
// them, so the group a reader learns here is the group Zotero offers. ZotLit
// writes two of them today; the rest keep their seat and stand down.
//
// The colours are settings rather than view state, so a tool armed in one PDF
// draws in the same colour in the next one.
import * as v from "valibot";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";

/** Every tool of the toggle group, in Zotero's own toolbar order. */
export const ANNOTATION_TOOLS = [
  "highlight",
  "underline",
  "note",
  "text",
  "image",
  "ink",
] as const satisfies readonly ResolvedAnnotationTypeName[];

export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

/** The tools ZotLit creates today, which are the two an armed tool commits as. */
export const MARK_TOOLS = ["highlight", "underline"] as const;

export type MarkTool = (typeof MARK_TOOLS)[number];

/** Whether ZotLit can write this tool's Annotation yet. */
export function isMarkTool(tool: AnnotationTool): tool is MarkTool {
  return (MARK_TOOLS as readonly AnnotationTool[]).includes(tool);
}

/** Zotero's own default, which every tool starts on. */
export const DEFAULT_TOOL_COLOR = ANNOTATION_COLORS[0]!;

/** The settings key each tool's colour is kept under. */
export const TOOL_COLORS_SETTING = "reader.annotation-colors";

/** The settings key the colours used last are kept under, for every tool. */
export const RECENT_COLORS_SETTING = "reader.recent-colors";

/**
 * Each tool's chosen colour, as the settings file carries it. Sparse: a tool
 * never recoloured stays absent, so it follows Zotero's default rather than a
 * copy of it frozen at first launch.
 */
export const annotationToolColorsSchema = v.record(
  v.picklist(ANNOTATION_TOOLS),
  v.string(),
);

export type AnnotationToolColors = v.InferOutput<
  typeof annotationToolColorsSchema
>;

/** Every tool's colour, with Zotero's default standing for one never chosen. */
export function resolveToolColors(
  stored: AnnotationToolColors = {},
): Record<AnnotationTool, string> {
  return Object.fromEntries(
    ANNOTATION_TOOLS.map((tool) => [tool, stored[tool] ?? DEFAULT_TOOL_COLOR]),
  ) as Record<AnnotationTool, string>;
}

/**
 * What the reader reads each tool's colour through, and writes a choice back;
 * and the colours used last, which every tool shares.
 */
export interface ToolColorStore {
  current: () => Readonly<Record<AnnotationTool, string>>;
  set: (tool: AnnotationTool, color: string) => void;
  /** The colours used last, most recent first. */
  recent: () => readonly string[];
  /** Puts a colour first in the recent list. */
  use: (color: string) => void;
}
