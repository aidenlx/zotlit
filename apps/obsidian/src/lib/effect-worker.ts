// Worker Effect entry point: the same API as `effect.ts`, without LogTape.
// oxlint-disable-next-line no-restricted-imports -- This is the worker-native Effect entry point.
export * from "effect";
export * as Effect from "./effect-worker-runtime";
