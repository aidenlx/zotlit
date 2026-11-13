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
  /** How long the click ring grows and fades, in ms. */
  ringMs: 450,
  /** How long the pointer stays on its target after the click mark, in ms. */
  markMs: 150,
};

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
