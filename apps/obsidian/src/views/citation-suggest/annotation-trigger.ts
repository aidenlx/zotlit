// The Annotation Suggester's trigger: a setting, kept clear of the Citation
// Suggester's triggers and Obsidian's own `[[`.
import * as m from "@/lib/i18n/generated/messages";

/**
 * Text that opens another suggester: the Bracket Trigger (`[@`, `【@`),
 * Obsidian's link suggester (`[[`), and, through `@`, the At Trigger.
 */
const CLAIMED = ["[@", "【@", "[["] as const;

/** Why a trigger cannot open the Annotation Suggester. */
export type AnnotationTriggerProblem = "empty" | "whitespace" | "citation";

/**
 * Whether `trigger` can open the Annotation Suggester: it must not be empty,
 * hold whitespace, hold an `@` (the At Trigger opens on `@` after an opener),
 * or overlap a claimed trigger, where one starts the other.
 */
export function annotationTriggerProblem(
  trigger: string,
): AnnotationTriggerProblem | null {
  if (trigger === "") return "empty";
  if (/\s/.test(trigger)) return "whitespace";
  if (
    trigger.includes("@") ||
    CLAIMED.some(
      (claimed) => claimed.startsWith(trigger) || trigger.startsWith(claimed),
    )
  )
    return "citation";
  return null;
}

/**
 * The settings message for a trigger that cannot open the Annotation
 * Suggester; none for a usable one, or for empty, which turns it off.
 */
export function annotationTriggerError(trigger: string): string | undefined {
  switch (annotationTriggerProblem(trigger)) {
    case "whitespace":
      return m.settings_citation_annotation_trigger_whitespace();
    case "citation":
      return m.settings_citation_annotation_trigger_citation();
    case "empty":
    case null:
      return undefined;
  }
}

/** Resolved Annotation Suggester trigger: ch offsets on the cursor line. */
export interface AnnotationTrigger {
  /** ch of the trigger's first character. */
  start: number;
  /** ch the replacement ends at: the cursor, or past a paired closing bracket. */
  end: number;
  /** The search text between the trigger and the cursor. */
  query: string;
}

/**
 * Decide whether `line` at cursor `ch` opens the Annotation Suggester: the
 * last `trigger` before the cursor, followed by a query with no closing
 * bracket. Pure decision core for the suggester's `onTrigger`. An unusable
 * trigger (see {@link annotationTriggerProblem}) opens nothing.
 */
export function resolveAnnotationTrigger(
  line: string,
  ch: number,
  { trigger }: { trigger: string },
): AnnotationTrigger | null {
  if (annotationTriggerProblem(trigger) !== null) return null;
  const beforeCursor = line.slice(0, ch);
  const start = beforeCursor.lastIndexOf(trigger);
  if (start === -1) return null;
  const query = beforeCursor.slice(start + trigger.length);
  if (/[\]】]/.test(query)) return null;
  // A trigger that opens a bracket gets its pair from Obsidian's auto-pair.
  const pair = { "[": "]", "【": "】" }[trigger.charAt(0)];
  return {
    start,
    end: pair !== undefined && line.charAt(ch) === pair ? ch + 1 : ch,
    query,
  };
}
