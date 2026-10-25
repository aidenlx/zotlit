// Obsidian's Effect entry point: renderer and workers share browser scheduling.
// The effectEntry Vite plugin (scripts/effect-entry.ts) resolves `effect` to it in the renderer and in tests.
export * from "effect";
export * as Effect from "./effect-runtime";
