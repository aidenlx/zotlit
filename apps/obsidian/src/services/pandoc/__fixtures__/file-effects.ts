// Promise fixtures enter file Effects through this test-owned Node filesystem.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";

export function runFileEffect<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));
}

export const nodeFileSystem = Effect.runSync(
  FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer)),
);
