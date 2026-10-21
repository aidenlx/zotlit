// Opening a Target: an Attachment, one Annotation in it, or a link that names
// one, sent to Obsidian's own PDF view where this device holds an
// Obsidian-Openable file for it, and to Zotero everywhere else. Every ZotLit
// gesture that opens an Attachment, and File Link Capture for a link Obsidian
// rendered, decides here, so the choice and its Zotero fallback are written
// once.
//
// @see apps/obsidian/docs/adr/0045-file-link-capture-patches-window-open.md

import { fileURLToPath } from "node:url";
import type { PaneType } from "obsidian";

import {
  annotationOpenUri,
  attachmentOpenUri,
  formatAnnotationSubpath,
  formatIndexedKey,
  parseAnnotationOpenUri,
  parseIndexedKey,
} from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type {
  AttachmentLookup,
  AttachmentResolver,
} from "@/services/attachment-resolver/service";
import { defaults } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import type { ObsidianOpenableAttachment } from "./resolve";
import { filename, obsidianOpenPath } from "./resolve";

const logger = getLogger("attachment-open");

/**
 * What one gesture opens: an Attachment, or one Annotation in it. Both keys
 * are Indexed Keys.
 */
export type OpenTarget =
  | { readonly kind: "attachment"; readonly attachmentKey: string }
  | {
      readonly kind: "annotation";
      readonly attachmentKey: string;
      readonly annotationKey: string;
      /** The zero-based PDF page; `null` where the Annotation has none. */
      readonly pageIndex: number | null;
      /** The printed page label Zotero's own link carries. */
      readonly pageLabel: string | null;
    };

/** Where an open ended up. */
export type OpenOutcome =
  /** Obsidian's PDF view shows the target. */
  | { kind: "reader" }
  /** The system handler was handed `url`, which Zotero opens. */
  | { kind: "zotero"; url: string }
  /**
   * The reader found no file behind an Attachment File Link, which names
   * nothing Zotero could open in its stead. The caller says so.
   */
  | { kind: "file-missing" }
  /** The target names no Zotero object at all; nothing opened. */
  | { kind: "unknown" };

/** Whether Obsidian's PDF view opened the file, which it learns at the open itself. */
export type ReaderOutcome = "opened" | "file-missing";

/** Obsidian's own PDF view, as the opener drives it. */
export interface TargetReader {
  open(
    attachment: ObsidianOpenableAttachment,
    pane: PaneType | boolean,
  ): Promise<ReaderOutcome>;
}

/** The system handler a `zotero://` link reaches Zotero through. */
export type NativeOpener = (url: string) => void;

export interface TargetOpenerDeps {
  attachments: Pick<
    AttachmentResolver,
    "resolve" | "lookup" | "warm" | "indexed"
  >;
  reader: TargetReader;
  native: NativeOpener;
  /**
   * Read per followed link: `citation.annotation-links` and
   * `citation.open-annotation-links` decide whether a Durable Annotation Link
   * is ZotLit's to follow at all.
   */
  settings: Pick<SettingsService, "current">;
  /** The vault's own directory, for telling an in-vault file from one outside. */
  vaultBasePath: string;
  /** @default process.platform */
  platform?: NodeJS.Platform;
  /**
   * How long a keyed open waits for the first Attachment index before it
   * hands the target to Zotero.
   *
   * @default 5 seconds
   */
  indexWait?: Temporal.Duration;
}

export interface TargetOpener {
  /**
   * Open a target named by key. An Attachment that Obsidian's PDF view can
   * host, and whose file this device holds, opens there in `pane`; every other
   * one opens in Zotero, which finds any Attachment by its key. Waits a
   * bounded time for the Attachment index while it is still being built, and
   * opens in Zotero once that wait ends. A failed build is retried, so the
   * index never fails outright; it is only late.
   */
  open(target: OpenTarget, pane: PaneType | boolean): Promise<OpenOutcome>;
  /**
   * Follow a clicked link: an Attachment File Link or a Durable Annotation
   * Link that names an Obsidian-Openable Attachment opens in Obsidian's reader.
   * Decided at once, from the index held now.
   *
   * @returns `null` for a link ZotLit leaves to the caller's own handler —
   *   another scheme, a file no Attachment keeps, a file Obsidian cannot host,
   *   a Durable Annotation Link while the settings leave those to Zotero, and
   *   every link while the index is still being built.
   */
  follow(url: string, pane: PaneType | boolean): Promise<OpenOutcome> | null;
}

/** A printed page label that also reads as a 1-based page number. */
const PAGE_NUMBER_RE = /^[1-9]\d*$/;

/** The opener every ZotLit gesture opens an Attachment through. */
export function createTargetOpener({
  attachments,
  reader,
  native,
  settings,
  vaultBasePath,
  platform = process.platform,
  indexWait = Temporal.Duration.from({ seconds: 5 }),
}: TargetOpenerDeps): TargetOpener {
  const openable = (
    file: { attachmentKey: string; absolutePath: string },
    subpath: string,
  ): ObsidianOpenableAttachment => ({
    indexedKey: file.attachmentKey,
    label: filename(file.absolutePath),
    openPath: obsidianOpenPath(file.absolutePath, vaultBasePath, platform),
    absolutePath: file.absolutePath,
    ...(subpath ? { subpath } : {}),
  });

  /** Opens in the reader, or hands `fallback` to Zotero when the file is gone. */
  const read = async (
    attachment: ObsidianOpenableAttachment,
    { pane, fallback }: { pane: PaneType | boolean; fallback: string | null },
  ): Promise<OpenOutcome> => {
    if ((await reader.open(attachment, pane)) === "opened")
      return { kind: "reader" };
    if (fallback === null) return { kind: "file-missing" };
    logger.debug("Target handed to Zotero: the reader found no file", {
      attachmentKey: attachment.indexedKey,
    });
    return toZotero(fallback);
  };

  const toZotero = (url: string): OpenOutcome => {
    native(url);
    return { kind: "zotero", url };
  };

  /**
   * The index's answer for `attachmentKey`, waiting a bounded time for the
   * first index; still `pending` when that wait ends.
   */
  const lookup = async (attachmentKey: string): Promise<AttachmentLookup> => {
    const found = attachments.lookup(attachmentKey);
    if (found.kind !== "pending") return found;
    logger.debug("Target waits for the Attachment index", { attachmentKey });
    attachments.warm();
    if (!(await indexedWithin(attachments.indexed, indexWait))) {
      logger.debug("Target gave up on the Attachment index", {
        attachmentKey,
      });
      return { kind: "pending" };
    }
    return attachments.lookup(attachmentKey);
  };

  const followFile = (
    parsed: URL,
    pane: PaneType | boolean,
  ): Promise<OpenOutcome> | null => {
    let absolutePath: string;
    try {
      absolutePath = fileURLToPath(parsed);
    } catch {
      return null;
    }
    const resolution = attachments.resolve(absolutePath);
    if (resolution.kind !== "resolved" || !resolution.openable) return null;
    return read(
      openable(
        { attachmentKey: resolution.attachmentKey, absolutePath },
        parsed.hash,
      ),
      { pane, fallback: null },
    );
  };

  /**
   * A `zotero://open` link that names an Annotation names its Attachment by
   * key, so the Attachment it names opens — even where another one keeps the
   * same file. A file this device does not hold leaves the link to Zotero,
   * which is what makes the link durable; the reader finds that out at the
   * open, so the link is handed over then, as written. Anything short of a
   * valid Annotation key is Zotero's alone, `zotero://select` included.
   *
   * The link's `page` is a printed label, which Obsidian's own jump reads as a
   * page number. It is carried only when it reads as one; the Annotation's own
   * page wins over it whenever the reader can place the Annotation.
   *
   * The link is ZotLit's to follow only while the settings say so: with
   * `citation.annotation-links` off ZotLit treats none of these links, and
   * with `citation.open-annotation-links` off a click is Zotero's. Either way
   * the link reaches Zotero as written, as it would without ZotLit.
   */
  const followDurable = (
    url: string,
    pane: PaneType | boolean,
  ): Promise<OpenOutcome> | null => {
    const link = parseAnnotationOpenUri(url);
    if (link === null) return null;
    const current = settings.current ?? defaults;
    if (
      !current["citation.annotation-links"] ||
      !current["citation.open-annotation-links"]
    ) {
      logger.debug("Durable Annotation Link left to Zotero", {
        attachmentKey: link.attachmentKey,
        groupID: link.groupID,
        reason: "settings",
      });
      return null;
    }
    const attachment = attachments.lookup(
      formatIndexedKey(link.attachmentKey, link.groupID),
    );
    if (attachment.kind !== "resolved" || !attachment.openable) {
      logger.debug("Durable Annotation Link left to Zotero", {
        attachmentKey: link.attachmentKey,
        groupID: link.groupID,
        reason:
          attachment.kind === "resolved" ? "not-openable" : attachment.kind,
      });
      return null;
    }
    const page =
      link.pageLabel !== null && PAGE_NUMBER_RE.test(link.pageLabel)
        ? Number(link.pageLabel)
        : null;
    return read(
      openable(
        attachment,
        formatAnnotationSubpath({
          page,
          annotation: formatIndexedKey(link.annotationKey, link.groupID),
        }),
      ),
      { pane, fallback: url },
    );
  };

  return {
    async open(target, pane) {
      const uri = zoteroUri(target);
      if (uri === null) {
        logger.warn("Target names no Zotero object", {
          attachmentKey: target.attachmentKey,
        });
        return { kind: "unknown" };
      }
      const attachment = await lookup(target.attachmentKey);
      if (attachment.kind !== "resolved" || !attachment.openable) {
        logger.debug("Target handed to Zotero", {
          attachmentKey: target.attachmentKey,
          reason:
            attachment.kind === "resolved" ? "not-openable" : attachment.kind,
        });
        return toZotero(uri);
      }
      return read(
        openable(
          attachment,
          target.kind === "annotation"
            ? formatAnnotationSubpath({
                page: target.pageIndex === null ? null : target.pageIndex + 1,
                annotation: target.annotationKey,
              })
            : "",
        ),
        { pane, fallback: uri },
      );
    },

    follow(url, pane) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (parsed.protocol === "file:") return followFile(parsed, pane);
      if (parsed.protocol === "zotero:") return followDurable(url, pane);
      return null;
    },
  };
}

/**
 * Whether `indexed` settled within `wait`. The resolver retries a failed
 * build, so `indexed` never rejects; it only settles late or not at all.
 */
async function indexedWithin(
  indexed: Promise<void>,
  wait: Temporal.Duration,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), wait.total("milliseconds"));
  });
  try {
    return await Promise.race([indexed.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `zotero://open` link of the target, which opens it in Zotero's reader;
 * `null` for a key that is no Indexed Key.
 */
export function zoteroUri(target: OpenTarget): string | null {
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
