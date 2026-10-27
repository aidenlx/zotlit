// Transactional save for one user-chosen Pandoc Integration Pair folder.

import { Effect, FileSystem } from "effect";
import type { Scope } from "effect";
import { join } from "node:path";

export type SavePandocIntegrationResult =
  | { kind: "cancelled" }
  | { kind: "saved"; folder: string }
  | { kind: "failed"; error: unknown; restored: boolean };

export interface SavePandocIntegrationOptions {
  folder: string;
  files: Readonly<Record<string, string>>;
  confirmReplacement: (
    filenames: readonly string[],
  ) => Effect.Effect<boolean, unknown>;
}

interface PairEntry {
  filename: string;
  contents: string;
  target: string;
  previous: string | null;
}

/**
 * Save both integration files as one transaction. A failed install removes
 * newly installed files and restores every target moved to backup.
 */
export const savePandocIntegrationFiles = Effect.fn("PandocIntegration.save")(
  function* ({
    folder,
    files,
    confirmReplacement,
  }: SavePandocIntegrationOptions) {
    const fs = yield* FileSystem.FileSystem;
    return yield* Effect.scoped(
      Effect.gen(function* (): Effect.fn.Return<
        SavePandocIntegrationResult,
        unknown,
        Scope.Scope
      > {
        const entries = yield* Effect.forEach(
          Object.entries(files),
          Effect.fnUntraced(function* ([filename, contents]) {
            const target = join(folder, filename);
            const previous = yield* fs
              .readFileString(target)
              .pipe(
                Effect.catchReason("PlatformError", "NotFound", () =>
                  Effect.succeed(null),
                ),
              );
            return { filename, contents, target, previous };
          }),
          { concurrency: "unbounded" },
        );
        const existing = entries
          .filter((entry) => entry.previous !== null)
          .map((entry) => entry.filename);
        if (existing.length > 0 && !(yield* confirmReplacement(existing)))
          return { kind: "cancelled" };

        // Staging cleanup cannot change the result of a completed transaction.
        const temp = yield* Effect.acquireRelease(
          fs.makeTempDirectory({
            directory: folder,
            prefix: ".zotlit-pandoc-",
          }),
          (path) =>
            fs
              .remove(path, { recursive: true, force: true })
              .pipe(Effect.ignore),
        );
        for (const entry of entries) {
          yield* fs.writeFileString(
            join(temp, entry.filename),
            entry.contents,
            { flag: "wx" },
          );
        }

        const backedUp: PairEntry[] = [];
        const installed: PairEntry[] = [];
        // Once a target moves, finish the transaction or restore it before interruption.
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const install = yield* Effect.gen(function* () {
              for (const entry of entries) {
                if (entry.previous === null) continue;
                yield* fs.rename(
                  entry.target,
                  join(temp, `.previous-${entry.filename}`),
                );
                backedUp.push(entry);
              }
              for (const entry of entries) {
                yield* fs.rename(join(temp, entry.filename), entry.target);
                installed.push(entry);
              }
            }).pipe(Effect.result);
            if (install._tag === "Success")
              return { kind: "saved", folder } as const;

            const errors: unknown[] = [];
            const collect = <E>(effect: Effect.Effect<void, E>) =>
              effect.pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    errors.push(error);
                  }),
                ),
              );
            for (const entry of installed.toReversed()) {
              yield* collect(
                fs
                  .remove(entry.target)
                  .pipe(
                    Effect.catchReason(
                      "PlatformError",
                      "NotFound",
                      () => Effect.void,
                    ),
                  ),
              );
            }
            for (const entry of backedUp.toReversed()) {
              yield* collect(
                fs.rename(
                  join(temp, `.previous-${entry.filename}`),
                  entry.target,
                ),
              );
            }
            return {
              kind: "failed",
              restored: errors.length === 0,
              error:
                errors.length === 0
                  ? install.failure
                  : new AggregateError(
                      [install.failure, ...errors],
                      "Failed to save and restore the Pandoc Integration Pair",
                    ),
            } as const;
          }),
        );
      }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed<SavePandocIntegrationResult>({
          kind: "failed",
          error,
          restored: true,
        }),
      ),
    );
  },
);
