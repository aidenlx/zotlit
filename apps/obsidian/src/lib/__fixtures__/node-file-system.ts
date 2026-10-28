import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem, Layer } from "effect";

/**
 * The Node file system with the members `overrides` gives in place of its
 * own. `overrides` receives the real file system, so a member can wrap it.
 */
export function layerNodeFileSystemWith(
  overrides: (fs: FileSystem.FileSystem) => Partial<FileSystem.FileSystem>,
): Layer.Layer<FileSystem.FileSystem> {
  return Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return FileSystem.FileSystem.of({ ...fs, ...overrides(fs) });
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer));
}
