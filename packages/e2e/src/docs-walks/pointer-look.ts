// The look and timing of the pointer a docs-walk clip draws, shared by its
// Obsidian, browser and Zotero shots. Each shot draws it in a page of its
// own, so the values go in as arguments.

import type { ClipSettings } from "./clip-settings.ts";

export const pointerLook = {
  /** The arrow, 22 × 26 CSS px, with its tip at the top-left corner. */
  arrow:
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="26" viewBox="0 0 22 26" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M2 1.5v20.2l5.3-5.1 3.4 7.8 3.4-1.5-3.3-7.6 7.4-.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  /**
   * The click ring's colours. An Obsidian shot draws the ring in the vault's
   * accent colour instead.
   */
  ring: { border: "#7c5cff", fill: "rgba(124,92,255,.18)" },
  /** The click ring grows from half size and fades. */
  ringKeyframes: [
    { opacity: 1, transform: "scale(.5)" },
    { opacity: 0, transform: "scale(1.4)" },
  ],
  /** How long the click ring grows and fades, in ms. */
  ringMs: 450,
  /** How long the pointer stays on its target after the click mark, in ms. */
  markMs: 150,
};

/**
 * The arrow's CSS: at the top-left corner, over the page, gliding with a
 * `transitionMs` transition when its `transform` moves it.
 */
export function arrowStyle(transitionMs: number): string {
  return `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform ${transitionMs}ms cubic-bezier(.4,0,.2,1);`;
}

/**
 * The click ring's CSS that follows its position: a 28 px circle centred on
 * that position, under the arrow.
 */
export function ringStyle(
  colors: { border: string; fill: string } = pointerLook.ring,
): string {
  return `width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid ${colors.border};background:${colors.fill};z-index:2147483646;pointer-events:none;`;
}

/**
 * The glide of `settings` in ms: the arrow's CSS transition ends 50 ms
 * before the pointer's wait does, so each glide lands before the next action.
 */
export function pointerGlide(settings: ClipSettings): {
  transitionMs: number;
  glideMs: number;
} {
  const glideMs = settings.glide * 1000;
  return { transitionMs: Math.max(0, glideMs - 50), glideMs };
}
