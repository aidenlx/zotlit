// Narrows Attachments read from the database to the Obsidian-Openable ones, under the active source's paths.

import type { Attachment } from "@zotlit/db";

import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";

import type { ObsidianOpenableAttachment } from "./resolve";
import { toObsidianOpenableAttachments } from "./resolve";

/**
 * Attachments already fetched from the database, narrowed to the
 * Obsidian-Openable ones — the path-context setup
 * `literatureNoteAttachments` and the `open-attachment` protocol
 * handler both need, written once here.
 */
export function toObsidianOpenable(
  attachments: readonly Attachment[],
  {
    vaultBasePath,
    zoteroPref,
  }: {
    /** The vault's folder on disk. */
    vaultBasePath: string;
    zoteroPref: Pick<ZoteroPrefSnapshot, "dataDir" | "baseAttachmentPath">;
  },
): ObsidianOpenableAttachment[] {
  return toObsidianOpenableAttachments(attachments, {
    pathContext: {
      dataDir: zoteroPref.dataDir,
      baseAttachmentPath: zoteroPref.baseAttachmentPath,
    },
    vaultBasePath,
    platform: process.platform,
  });
}
