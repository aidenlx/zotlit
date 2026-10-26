// Attachment Import for callers outside Effect: the setting tab's approved
// folders.
import type { EffectBridge } from "@/lib/effect-bridge";

import type { AttachmentImport } from "./service";

/** The edge handle `build.ts` binds; see {@link bindAttachmentImport}. */
export interface AttachmentImportHandle {
  /** The folders approved on this device, canonical and in the order granted. */
  readonly approvedFolders: readonly string[];
  /** The canonical path stored, or `null` when `folder` does not resolve. */
  approveFolder(folder: string): Promise<string | null>;
  revokeFolder(folder: string): Promise<void>;
}

/**
 * Attachment Import over `bridge`. Unload does not interrupt a pending run; a
 * run after release fails as the bridge does.
 */
export function bindAttachmentImport(
  bridge: Pick<EffectBridge, "runSync" | "runPromise">,
  service: AttachmentImport["Service"],
): AttachmentImportHandle {
  return {
    get approvedFolders() {
      return bridge.runSync(service.approvedFolders);
    },
    approveFolder: (folder) => bridge.runPromise(service.approveFolder(folder)),
    revokeFolder: (folder) => bridge.runPromise(service.revokeFolder(folder)),
  };
}
