// The platform file boundary for renderer ownership tests.
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import type { open } from "node:fs/promises";
import { stubService } from "@/lib/__fixtures__/service-stub";

export function layerExcerptFiles(openFile: typeof open) {
  return Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.makeNoop({
      open: (path) =>
        Effect.acquireRelease(
          Effect.promise(() => openFile(path, "r")),
          (file) => Effect.promise(() => file.close()),
        ).pipe(
          Effect.map((file) => {
            let position = 0;
            return stubService<FileSystem.File>("Excerpt file", {
              stat: Effect.promise(() => file.stat()).pipe(
                Effect.map(
                  (info) =>
                    ({
                      type: "File",
                      size: BigInt(info.size) as FileSystem.File.Info["size"],
                      mtime: Option.some(
                        DateTime.toDateUtc(DateTime.makeUnsafe(info.mtimeMs)),
                      ),
                      atime: Option.none(),
                      birthtime: Option.none(),
                      dev: 0n,
                      ino: Option.none(),
                      mode: 0,
                      nlink: Option.none(),
                      uid: Option.none(),
                      gid: Option.none(),
                      rdev: Option.none(),
                      blksize: Option.none(),
                      blocks: Option.none(),
                    }) satisfies FileSystem.File.Info,
                ),
              ),
              read: (buffer) =>
                Effect.promise(() =>
                  file.read(buffer, 0, buffer.length, position),
                ).pipe(
                  Effect.map(({ bytesRead }) => {
                    position += bytesRead;
                    return bytesRead;
                  }),
                ),
            });
          }),
        ),
    }),
  );
}
