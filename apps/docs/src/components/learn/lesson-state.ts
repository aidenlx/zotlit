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
    tick: (n: number, done: boolean) => void;
    toggle: (n: number) => void;
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

/** The first step not ticked, or undefined when every step is. */
export function firstOpenStep(ticks: Iterable<number>, total: number) {
  const done = new Set(ticks);
  for (let n = 1; n <= total; n++) if (!done.has(n)) return n;
  return undefined;
}
