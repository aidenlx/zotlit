// What a lesson's parts share on the page, and the reader's saved progress.

import { createContext } from "react";

/** A step's frontmatter entry. @see content.config.ts → learnSchema */
export interface LessonStepMeta {
  name: string;
  title: string;
  alt: string;
}

/**
 * The parts of one lesson page, numbered as the URL hash numbers them: 0 is
 * the cover (no hash), 1–N the steps (`#1`…), and N + 1 the end (`#done`).
 */
export interface LessonState {
  media: string;
  steps: LessonStepMeta[];
  /**
   * The part on screen once the page runs, or null while it renders without
   * JavaScript — the prerender and a reader with scripts off — when every
   * part shows in order.
   */
  at: number | null;
  go: (at: number) => void;
}

export const LessonContext = createContext<LessonState | null>(null);

/** The hash that opens a part. */
export function partHash(at: number, total: number): string {
  if (at <= 0) return "";
  return at > total ? "done" : String(at);
}

/** The part a URL hash opens, the cover for anything else. */
export function partFromHash(hash: string, total: number): number {
  const value = hash.replace(/^#/, "");
  if (value === "done") return total + 1;
  const step = Number(value);
  return Number.isInteger(step) && step >= 1 && step <= total ? step : 0;
}

/** One lesson's progress: the furthest step reached, and whether the reader finished it. */
export interface LessonProgress {
  step: number;
  done: boolean;
}

const storageKey = "zotlit:learn-progress";

/**
 * Every lesson's saved progress. Storage can be missing or refuse access (a
 * private window, blocked site data), so the page treats a failed read as no
 * progress and works on.
 */
export function readProgress(): Record<string, LessonProgress> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return value && typeof value === "object"
      ? (value as Record<string, LessonProgress>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Records the step the reader is on, so "Continue" returns there; the cover
 * records nothing, and a lesson once done stays done.
 */
export function saveProgress(slug: string, at: number, total: number) {
  if (at <= 0) return;
  try {
    const all = readProgress();
    all[slug] = {
      step: Math.min(at, total),
      done: (all[slug]?.done ?? false) || at > total,
    };
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    // Without storage the lesson still works; it only forgets the place.
  }
}
