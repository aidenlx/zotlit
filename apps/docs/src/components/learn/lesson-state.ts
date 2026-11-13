// What a lesson's parts share on the page, and the reader's saved ticks.

import { createContext } from "react";

/** A step's frontmatter entry. @see content.config.ts → learnSchema */
export interface LessonStepMeta {
  title: string;
  alt: string;
}

/** The checklist as the lesson's `<Step>` rows read it. */
export interface LessonState {
  media: string;
  steps: LessonStepMeta[];
  /**
   * The checklist once the page runs, or null while it renders without
   * JavaScript — the prerender and a reader with scripts off — when every
   * row shows open.
   */
  live: {
    /** The open row, or null when every row is closed. */
    open: number | null;
    ticks: ReadonlySet<number>;
    /** Ticks or unticks row `n`, and returns the part it opens: a row, or `steps.length + 1` for the end. */
    tick: (n: number, done: boolean) => number;
    toggle: (n: number) => void;
    /** Opens row `n`, or brings the end into view for `steps.length + 1`. */
    go: (n: number) => void;
    /** The window is wide enough for the media panel, which shows the open row's recording. */
    wide: boolean;
    /** The row the reader opened with the Start button, whose recording plays at once. */
    launched: number | null;
    /** The reader has opened, closed or ticked a row in this page view; until then the open row's recording rests. */
    acted: boolean;
  } | null;
}

export const LessonContext = createContext<LessonState | null>(null);

/** The row a URL hash opens (`#3`), the end for `#done`, or 0 for anything else. */
export function partFromHash(hash: string, total: number): number {
  const value = hash.replace(/^#/, "");
  if (value === "done") return total + 1;
  const step = Number(value);
  return Number.isInteger(step) && step >= 1 && step <= total ? step : 0;
}

/**
 * The row open when a lesson page loads: the step a `#n` hash names, else the
 * first step not ticked for a reader who began, else none — a new reader
 * starts on the outcome, with every row closed.
 */
export function openOnLoad(
  hash: string,
  ticks: readonly number[],
  total: number,
): number | null {
  const part = partFromHash(hash, total);
  if (part >= 1 && part <= total) return part;
  if (part > total || ticks.length === 0) return null;
  return firstOpenStep(ticks, total) ?? null;
}

/** One lesson's saved progress: the steps ticked, and whether every step was once ticked. */
export interface LessonProgress {
  ticks: number[];
  done: boolean;
}

const storageKey = "zotlit:learn-progress";

/** One entry as saved, with anything that is not a step number dropped. */
function toProgress(value: unknown): LessonProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as { ticks?: unknown; done?: unknown };
  const ticks = Array.isArray(entry.ticks)
    ? entry.ticks.filter((n): n is number => Number.isInteger(n) && n >= 1)
    : [];
  return { ticks, done: entry.done === true };
}

/**
 * Every lesson's saved progress. Storage can be missing or refuse access (a
 * private window, blocked site data), so the page treats a failed read as no
 * progress and works on.
 */
export function readProgress(): Record<string, LessonProgress> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (!value || typeof value !== "object") return {};
    const all: Record<string, LessonProgress> = {};
    for (const [slug, entry] of Object.entries(value)) {
      const progress = toProgress(entry);
      if (progress) all[slug] = progress;
    }
    return all;
  } catch {
    return {};
  }
}

/** Records a lesson's ticks; a lesson whose every step was ticked stays done. */
export function saveTicks(
  slug: string,
  ticks: Iterable<number>,
  total: number,
) {
  try {
    const all = readProgress();
    const sorted = [...ticks].toSorted((a, b) => a - b);
    all[slug] = {
      ticks: sorted,
      done: (all[slug]?.done ?? false) || sorted.length >= total,
    };
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    // Without storage the lesson still works; it only forgets the ticks.
  }
}

/** The first step after `n` not ticked, then the first one before it, or undefined when every step is ticked. */
export function nextOpenStep(
  ticks: ReadonlySet<number>,
  n: number,
  total: number,
) {
  for (let k = n + 1; k <= total; k++) if (!ticks.has(k)) return k;
  return firstOpenStep(ticks, total);
}

/** The first step not ticked, or undefined when every step is. */
export function firstOpenStep(ticks: Iterable<number>, total: number) {
  const done = new Set(ticks);
  for (let n = 1; n <= total; n++) if (!done.has(n)) return n;
  return undefined;
}
