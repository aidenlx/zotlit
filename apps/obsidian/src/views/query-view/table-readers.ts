// The reader an Attachment or Annotation link in the Table opens: Obsidian's
// own PDF view, with ZotLit's annotation editor, for an Attachment it can
// host, and Zotero's reader for every other one.
import type { PaneType } from "obsidian";

import {
  annotationOpenUri,
  attachmentOpenUri,
  formatAnnotationSubpath,
  parseIndexedKey,
} from "@zotlit/db";

import { Effect } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import {
  createPdfReader,
  toObsidianOpenable,
} from "@/services/attachment-open/actions";
import type { AttachmentOpenLookupDeps } from "@/services/attachment-open/actions";

const logger = getLogger("query-view");

/** What a link in the Table opens: an Attachment, or one Annotation in it. */
export type ReaderTarget =
  | { readonly kind: "attachment"; readonly attachmentKey: string }
  | {
      readonly kind: "annotation";
      readonly attachmentKey: string;
      readonly annotationKey: string;
      /** The zero-based PDF page; `null` where the Annotation has none. */
      readonly pageIndex: number | null;
      readonly pageLabel: string | null;
    };

/** What the Attachment and Annotation links of the Table do. */
export interface TableReaders {
  /** Open the target in its reader, in `pane` where the reader is Obsidian's. */
  open(target: ReaderTarget, pane: PaneType | boolean): Promise<void>;
}

export interface TableReadersDeps extends AttachmentOpenLookupDeps {
  /**
   * Hands a `zotero://` link to the system.
   * @default window.open
   */
  openUri?: (uri: string) => void;
}

/**
 * The `zotero://open` link of the target, which opens it in Zotero's reader;
 * `null` for a key that is no Indexed Key.
 */
export function zoteroReaderUri(target: ReaderTarget): string | null {
  const attachment = parseIndexedKey(target.attachmentKey);
  if (!attachment) return null;
  if (target.kind === "attachment")
    return attachmentOpenUri(attachment.key, attachment.groupID);
  const annotation = parseIndexedKey(target.annotationKey);
  if (!annotation) return null;
  return annotationOpenUri({
    attachmentKey: attachment.key,
    annotationKey: annotation.key,
    pageLabel: target.pageLabel,
    groupID: attachment.groupID,
  });
}

/** The Table's links, through the reader every other ZotLit gesture opens a PDF in. */
export function tableReaders(deps: TableReadersDeps): TableReaders {
  const openUri = deps.openUri ?? ((uri: string) => window.open(uri));
  return {
    async open(target, pane) {
      let attachment;
      try {
        await using lease = await deps.reads.acquireRead();
        ({ attachment } = await Effect.runPromise(
          lease.reads.AnnotationsOfAttachment({
            attachmentKey: target.attachmentKey,
          }),
        ));
      } catch (error) {
        logger.warn("Failed to read the attachment to open", {
          attachmentKey: target.attachmentKey,
          error,
        });
        return;
      }
      if (!attachment) return;
      const [openable] = toObsidianOpenable([attachment], deps);
      if (openable) {
        await createPdfReader(deps).open(
          target.kind === "annotation"
            ? {
                ...openable,
                subpath: formatAnnotationSubpath({
                  page: target.pageIndex === null ? null : target.pageIndex + 1,
                  annotation: target.annotationKey,
                }),
              }
            : openable,
          pane,
        );
        return;
      }
      // Zotero opens its reader in a tab of its own, so the pane is not asked.
      const uri = zoteroReaderUri(target);
      if (uri !== null) openUri(uri);
    },
  };
}
