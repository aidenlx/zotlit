/**
 * Page callbacks run on Node 26 and Obsidian's Chromium 150. Preserve their
 * native syntax: lowering `await using` injects module helpers that cannot
 * cross the fn.toString() boundary. Both test configurations share this.
 */
export const pageTransform = { target: "esnext" };
