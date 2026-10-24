// Worker Effect entry point: the same API as `effect.ts`, without LogTape.
// Both embedded workers reach it through the `@/lib/effect` alias in `vite.config.ts`.
// oxlint-disable-next-line no-restricted-imports -- This is the worker-native Effect entry point.
export * from "effect";
export * as Effect from "./effect-worker-runtime";
