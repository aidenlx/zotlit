// Attachment Import for callers outside Effect: the setting tab's approved
// folders, the skipped-sources notice, and Note Feature's note writes.
import type { EffectBridge } from "@/lib/effect-bridge";

import type {
  AttachmentImport,
  AttachmentImportBatch,
  AttachmentImportResult,
  AttachmentSkipSummary,
  PrepareOptions,
} from "./service";

/** A prepared batch for Promise code: the render members, then flush and discard. */
export interface AttachmentImportBatchHandle extends Pick<
  AttachmentImportBatch,
  "decide" | "resolveLink"
> {
  flush(): Promise<AttachmentImportResult>;
  discard(): void;
}

/** The edge handle `build.ts` binds; see {@link bindAttachmentImport}. */
export interface AttachmentImportHandle {
  /** The folders approved on this device, canonical and in the order granted. */
  readonly approvedFolders: readonly string[];
  /** The canonical path stored, or `null` when `folder` does not resolve. */
  approveFolder(folder: string): Promise<string | null>;
  revokeFolder(folder: string): Promise<void>;
  /** Follow each pooled skip summary until the returned function stops it, or the runtime closes. */
  onSkipped(callback: (summary: AttachmentSkipSummary) => void): () => void;
  /** The import batch for the note at `notePath`. */
  prepare(
    notePath: string,
    options?: PrepareOptions,
  ): Promise<AttachmentImportBatchHandle>;
}

/**
 * Attachment Import over `bridge`. Unload does not interrupt a pending run; a
 * run after release fails as the bridge does.
 */
export function bindAttachmentImport(
  bridge: Pick<EffectBridge, "runSync" | "runPromise" | "subscribe">,
  service: AttachmentImport["Service"],
): AttachmentImportHandle {
  return {
    get approvedFolders() {
      return bridge.runSync(service.approvedFolders);
    },
    approveFolder: (folder) => bridge.runPromise(service.approveFolder(folder)),
    revokeFolder: (folder) => bridge.runPromise(service.revokeFolder(folder)),
    onSkipped: (callback) => bridge.subscribe(service.skipped, callback),
    prepare: async (notePath, options) => {
      const batch = await bridge.runPromise(service.prepare(notePath, options));
      return {
        decide: (path, origin) => batch.decide(path, origin),
        resolveLink: (opts) => batch.resolveLink(opts),
        flush: () => bridge.runPromise(batch.flush),
        discard: () => bridge.runSync(batch.discard),
      };
    },
  };
}
