// Worker Effect entry point: the same API as `effect.ts`, without LogTape.
// The effectEntry Vite plugin (scripts/effect-entry.ts) resolves `effect` to it in both embedded workers.
export * from "effect";
export * as Effect from "./effect-worker-runtime";
