import { Effect, FileSystem, Option, Schema } from "effect";
import type { PlatformError } from "effect";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { withLogCategory } from "./effect-log";
import { nodeFileSystemCall } from "./errno";
import { reflink } from "./reflink";

const logged = withLogCategory("attachment-import");

/** Bytes read from a descriptor source per step of its copy. */
const CHUNK_SIZE = 64 * 1024;

/**
 * Where one queued copy reads its bytes. The attachment import service picks
 * the branch from the source's origin.
 *
 * `path` keeps reflink available, since copy-on-write cloning operates on
 * paths; it is the confirmed canonical path of a Zotero-managed source, where
 * the window between the check and the copy is not meaningful.
 *
 * `handle` is the file opened while the source was confirmed, so a linked
 * file outside Zotero's control writes the bytes that were checked even if
 * the path is swapped underneath. The caller's Scope owns it and closes it.
 */
export type AttachmentCopySource =
  | { kind: "path"; path: string }
  | { kind: "handle"; handle: FileSystem.File };

export interface AttachmentCopyItem {
  source: AttachmentCopySource;
  dest: string;
}

export interface AttachmentCopyResult {
  copied: number;
  skipped: number;
  /** Sources absent on disk (e.g. an annotation Zotero has not rendered to its cache yet). */
  missing: number;
}

/** The destination is a symbolic link, which a copy never writes through. */
export class DestinationSymlinkError extends Schema.TaggedError<
  DestinationSymlinkError,
  { readonly brand: unique symbol }
>()("DestinationSymlinkError", { dest: Schema.String }) {
  override get message(): string {
    return `Refusing to write through existing symbolic link at destination: ${this.dest}`;
  }
}

/** What a copy fails with: a file system call, or a destination link. */
export type AttachmentCopyFailure =
  | PlatformError.PlatformError
  | DestinationSymlinkError;

/**
 * Copy each queued attachment, reflinking when possible. A missing source is
 * counted in `missing` rather than failed, so one absent file never aborts the
 * surrounding note import.
 */
export const copyAttachments = Effect.fnUntraced(function* (
  items: readonly AttachmentCopyItem[],
): Effect.fn.Return<
  AttachmentCopyResult,
  AttachmentCopyFailure,
  FileSystem.FileSystem
> {
  const result: AttachmentCopyResult = { copied: 0, skipped: 0, missing: 0 };
  for (const item of items) {
    result[yield* copyAttachment(item)] += 1;
  }
  return result;
});

/**
 * Attempt one attachment copy and report which bucket it fell into. The source
 * is read and written directly; a path source that is absent — whether at the
 * initial read or because it vanished mid-copy — fails `NotFound`, which is
 * counted as `"missing"`, never a check-then-act existence probe.
 */
const copyAttachment = ({
  source,
  dest,
}: AttachmentCopyItem): Effect.Effect<
  keyof AttachmentCopyResult,
  AttachmentCopyFailure,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const sourceInfo =
      source.kind === "handle"
        ? yield* source.handle.stat
        : yield* fs.stat(source.path);
    if (yield* destMatches(sourceInfo, dest)) return "skipped" as const;
    yield* writeCopy(source, dest, sourceInfo);
    return "copied" as const;
  }).pipe(
    Effect.catchReason("PlatformError", "NotFound", (_reason, error) =>
      Effect.logWarning("Skipped attachment with missing source").pipe(
        Effect.annotateLogs({ dest, error }),
        logged,
        Effect.as("missing" as const),
      ),
    ),
  );

/**
 * Copy into a randomly named temp file next to `dest`, stamp it with the
 * source's timestamps, then rename it into place. Stamping happens before
 * the rename — never on `dest` itself — so no step after the rename touches
 * `dest` by path; a path swapped in after the rename cannot redirect a
 * metadata write through a symlink. `rename` replaces whatever directory
 * entry sits at `dest` without ever opening `dest` itself, so a reader never
 * observes a partially written file. A failed attempt removes the temp file.
 * The steps run uninterruptibly, so a copy does not stop half-way.
 */
const writeCopy = (
  source: AttachmentCopySource,
  dest: string,
  sourceInfo: FileSystem.File.Info,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tempPath = join(dirname(dest), `.${randomUUID()}.zotlit-tmp`);
    yield* Effect.gen(function* () {
      yield* copyIntoTemp(source, tempPath);
      const times = Option.all([sourceInfo.atime, sourceInfo.mtime]);
      if (Option.isSome(times)) {
        const [atime, mtime] = times.value;
        yield* fs.utimes(tempPath, atime, mtime);
      }
      yield* fs.rename(tempPath, dest);
    }).pipe(Effect.tapCause(() => fs.remove(tempPath, { force: true })));
  }).pipe(Effect.uninterruptible);

/**
 * Every branch creates `tempPath` with exclusive access: `reflink` clones onto
 * a path that must not already exist, the plain-copy fallback passes
 * `COPYFILE_EXCL`, and the descriptor copy opens with `wx`. Combined with
 * `tempPath`'s unpredictable name, no branch can be redirected onto a file an
 * attacker prepared in advance. `FileSystem` has no reflink and no exclusive
 * `copyFile`, so the path branch calls Node and fails as `FileSystem` would.
 *
 * A descriptor source is read rather than reflinked: cloning names its source
 * by path, which is the substitution this branch exists to rule out. That
 * costs little, because a linked file usually sits on a different filesystem
 * from the vault anyway. Reads start at the beginning of the file, and the
 * temp file closes before the rename.
 */
const copyIntoTemp = (
  source: AttachmentCopySource,
  tempPath: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> => {
  if (source.kind === "handle") {
    return Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const target = yield* fs.open(tempPath, { flag: "wx" });
        let position = 0n;
        while (true) {
          const chunk = yield* source.handle.readAlloc(CHUNK_SIZE, {
            position,
          });
          if (Option.isNone(chunk)) return;
          yield* target.writeAll(chunk.value);
          position += BigInt(chunk.value.byteLength);
        }
      }),
    );
  }
  return Effect.tryPromise(() => reflink(source.path, tempPath)).pipe(
    Effect.catch(() =>
      nodeFileSystemCall("copyFile", source.path, () =>
        copyFile(source.path, tempPath, constants.COPYFILE_EXCL),
      ),
    ),
  );
};

/**
 * `lstat`, not `stat`: inspecting the directory entry itself — rather than
 * whatever it points to — is what lets an existing destination symlink be
 * rejected outright instead of silently compared against and then replaced.
 * `FileSystem` has no `lstat`, so this calls Node. Modification times compare
 * at the millisecond, the precision `FileSystem` reports.
 */
const destMatches = (
  sourceInfo: FileSystem.File.Info,
  dest: string,
): Effect.Effect<boolean, AttachmentCopyFailure> =>
  nodeFileSystemCall("lstat", dest, () => lstat(dest, { bigint: true })).pipe(
    Effect.flatMap((destStat) =>
      destStat.isSymbolicLink()
        ? Effect.fail(new DestinationSymlinkError({ dest }))
        : Effect.succeed(
            sourceInfo.size === destStat.size &&
              Option.exists(
                sourceInfo.mtime,
                (mtime) => mtime.getTime() === destStat.mtime.getTime(),
              ),
          ),
    ),
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(false),
    ),
  );
