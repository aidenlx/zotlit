import { stat } from "node:fs/promises";

import type { Attachment } from "@zotlit/db";
import { attachmentAbsPath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

export interface AttachmentFile {
  readonly path: string | null;
  readonly exists: boolean;
}

export interface AttachmentFileResolver {
  (attachment: Attachment): Promise<AttachmentFile>;
}

type Stat = (path: string) => Promise<unknown>;

/**
 * Resolve Attachment files for one Query Job. One resolver belongs to one
 * query, so every Attachment is probed at most once across all of its rows.
 */
export function makeAttachmentFileResolver(
  paths: AttachmentPathContext,
  options: { stat?: Stat } = {},
): AttachmentFileResolver {
  const probe = options.stat ?? stat;
  const memo = new Map<number, Promise<AttachmentFile>>();
  return (attachment) => {
    const cached = memo.get(attachment.itemID);
    if (cached) return cached;
    const path = attachmentAbsPath(attachment, paths);
    const resolved =
      path === null
        ? Promise.resolve({ path: null, exists: false } as const)
        : probe(path).then(
            () => ({ path, exists: true }) as const,
            () => ({ path, exists: false }) as const,
          );
    memo.set(attachment.itemID, resolved);
    return resolved;
  };
}
