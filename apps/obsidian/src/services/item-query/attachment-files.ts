import { Effect, FileSystem } from "effect";

import { attachmentAbsPath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import type { ResolveAttachmentFile } from "@zotlit/item-query";

export interface AttachmentFile {
  readonly path: string | null;
  readonly exists: boolean;
}

/**
 * Resolve Attachment files for one Query Job. One resolver belongs to one
 * query, so every Attachment is probed at most once across all of its rows.
 * A file the probe cannot reach reads as missing.
 */
export const makeAttachmentFileResolver = Effect.fnUntraced(function* (
  paths: AttachmentPathContext,
): Effect.fn.Return<ResolveAttachmentFile, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const memo = new Map<number, Effect.Effect<AttachmentFile>>();
  const probe = (path: string | null): Effect.Effect<AttachmentFile> =>
    path === null
      ? Effect.succeed({ path: null, exists: false })
      : fs.exists(path).pipe(
          Effect.orElseSucceed(() => false),
          Effect.map((exists) => ({ path, exists })),
        );
  // Per Attachment row of a query: untraced.
  return Effect.fnUntraced(function* (attachment) {
    const cached = memo.get(attachment.itemID);
    if (cached) return yield* cached;
    const resolved = yield* Effect.cached(
      probe(attachmentAbsPath(attachment, paths)),
    );
    memo.set(attachment.itemID, resolved);
    return yield* resolved;
  });
});
