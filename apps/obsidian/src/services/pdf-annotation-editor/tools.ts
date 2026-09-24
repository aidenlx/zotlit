// The tools the reader's Creation Toolbar offers, and the colour each one
// remembers.
//
// One tool per Zotero annotation type, in the order Zotero's own reader shows
// them, so the group a reader learns here is the group Zotero offers. ZotLit
// writes four of them today, and the Creation Toolbar seats those four.
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

/** The tools ZotLit creates today, which are the four an armed tool commits as. */
export const MARK_TOOLS = ["highlight", "underline", "image", "ink"] as const;

export type MarkTool = (typeof MARK_TOOLS)[number];

/**
 * The tools a text selection commits as; the image tool takes a rectangle,
 * and the ink tool a stroke.
 */
export type TextTool = Exclude<MarkTool, "image" | "ink">;

/**
 * The tool a text selection commits as while a tool is armed: the armed one
 * where it takes text, and highlight where none does.
 */
export function textToolOf(armed: MarkTool | null): TextTool {
  return armed === "highlight" || armed === "underline" ? armed : "highlight";
}

/** Whether ZotLit can write this tool's Annotation yet. */
export function isMarkTool(tool: AnnotationTool): tool is MarkTool {
  return (MARK_TOOLS as readonly AnnotationTool[]).includes(tool);
}

/**
 * The colour each tool starts on, as Zotero's reader starts it: the first
 * swatch, and the fourth for ink.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/reader.js#L178-L203
 */
export function defaultToolColor(tool: AnnotationTool): string {
  return tool === "ink" ? ANNOTATION_COLORS[3]! : ANNOTATION_COLORS[0]!;
}

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

/** Every tool's colour, with the tool's own default standing for one never chosen. */
export function resolveToolColors(
  stored: AnnotationToolColors = {},
): Record<AnnotationTool, string> {
  return Object.fromEntries(
    ANNOTATION_TOOLS.map((tool) => [
      tool,
      stored[tool] ?? defaultToolColor(tool),
    ]),
  ) as Record<AnnotationTool, string>;
}

/**
 * The pen widths the ink tool offers, in PDF points: a short run of Zotero's
 * own width steps.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/defines.js#L48-L53
 */
export const INK_WIDTHS = [0.5, 1, 2, 3, 5, 8, 12] as const;

export type InkWidth = (typeof INK_WIDTHS)[number];

/**
 * The pen width the ink tool starts on, as Zotero's reader starts it.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/reader.js#L199-L202
 */
export const DEFAULT_INK_WIDTH: InkWidth = 2;

/** The settings key the ink tool's pen width is kept under. */
export const INK_WIDTH_SETTING = "reader.ink-width";

/**
 * The ink tool's pen width, as the settings file carries it. A width outside
 * the offered steps fails, and the settings fall back to the default.
 */
export const inkWidthSchema = v.picklist(INK_WIDTHS);

/**
 * What the reader reads each tool's colour through, and writes a choice back;
 * the colours used last, which every tool shares; and the ink tool's pen
 * width.
 */
export interface ToolColorStore {
  current: () => Readonly<Record<AnnotationTool, string>>;
  set: (tool: AnnotationTool, color: string) => void;
  /** The colours used last, most recent first. */
  recent: () => readonly string[];
  /** Puts a colour first in the recent list. */
  use: (color: string) => void;
  /** The ink tool's pen width, in PDF points. */
  inkWidth: () => InkWidth;
  setInkWidth: (width: InkWidth) => void;
}
