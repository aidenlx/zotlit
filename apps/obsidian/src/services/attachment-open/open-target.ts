// Opening a Target: an Attachment, one Annotation in it, or a link that names
// one, sent to Obsidian's own PDF view where this device holds an
// Obsidian-Openable file for it, and to Zotero everywhere else. Every ZotLit
// gesture that opens an Attachment, and File Link Capture for a link Obsidian
// rendered, decides here, so the choice and its Zotero fallback are written
// once.
//
// @see apps/obsidian/docs/adr/0045-file-link-capture-patches-window-open.md

import { Context, Effect, Layer } from "effect";
import type { Duration } from "effect";
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

import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { LegacyPortError, portCall } from "@/lib/legacy-port";
import { Notifier } from "@/lib/notifier";
import { ObsidianEnv } from "@/lib/obsidian-env";
import {
  AttachmentResolver,
  indexedWithin,
} from "@/services/attachment-resolver/service";
import type { AttachmentLookup } from "@/services/attachment-resolver/service";
import { PluginSettings } from "@/services/settings/service";

import type { ObsidianOpenableAttachment } from "./resolve";
import { filename, obsidianOpenPath } from "./resolve";

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
  | { kind: "unknown" }
  /** The reader or the system handler failed; the Notifier said so. */
  | { kind: "failed" };

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

/**
 * The opener every ZotLit gesture opens an Attachment through, and File Link
 * Capture follows a link Obsidian rendered through.
 */
export class TargetOpener extends Context.Service<
  TargetOpener,
  {
    /**
     * Open a target named by key. An Attachment that Obsidian's PDF view can
     * host, and whose file this device holds, opens there in `pane`; every
     * other one opens in Zotero, which finds any Attachment by its key. Waits
     * a bounded time for the Attachment index while it is still being built,
     * and opens in Zotero once that wait ends. A failed build is retried, so
     * the index never fails outright; it is only late.
     *
     * An interrupt opens nothing and shows nothing. A reader or system
     * handler that fails shows a notice and ends `failed`.
     */
    open(
      target: OpenTarget,
      pane: PaneType | boolean,
    ): Effect.Effect<OpenOutcome>;
    /**
     * Follow a clicked link: an Attachment File Link or a Durable Annotation
     * Link that names an Obsidian-Openable Attachment opens in Obsidian's
     * reader. The decision runs at once, from the index held now, so a click
     * handler runs it synchronously and claims the click; the open it answers
     * is what the handler runs next.
     *
     * @returns `null` for a link ZotLit leaves to the caller's own handler —
     *   another scheme, a file no Attachment keeps, a file Obsidian cannot
     *   host, a Durable Annotation Link while the settings leave those to
     *   Zotero, and every link while the index is still being built.
     */
    follow(
      url: string,
      pane: PaneType | boolean,
    ): Effect.Effect<Effect.Effect<OpenOutcome> | null>;
  }
>()("zotlit/attachment-open/TargetOpener") {}

export interface TargetOpenerPorts<R> {
  /** Obsidian's PDF view, built over the layer's services. */
  readonly reader: Effect.Effect<TargetReader, never, R>;
  readonly native: NativeOpener;
  /** @default process.platform */
  readonly platform?: NodeJS.Platform;
  /**
   * How long a keyed open waits for the first Attachment index before it
   * hands the target to Zotero.
   *
   * @default 5 seconds
   */
  readonly indexWait?: Duration.Input;
}

/**
 * What a followed link opens: the Attachment, and the link Zotero takes in
 * its stead when the reader finds no file; `null` for a link that names
 * nothing Zotero could open.
 */
interface Claim {
  readonly attachment: ObsidianOpenableAttachment;
  readonly fallback: string | null;
}

/** A printed page label that also reads as a 1-based page number. */
const PAGE_NUMBER_RE = /^[1-9]\d*$/;

export function layerTargetOpener<R>({
  reader: makeReader,
  native,
  platform = process.platform,
  indexWait = "5 seconds",
}: TargetOpenerPorts<R>): Layer.Layer<
  TargetOpener,
  never,
  R | AttachmentResolver | PluginSettings | Notifier | ObsidianEnv
> {
  return Layer.effect(
    TargetOpener,
    Effect.gen(function* () {
      const attachments = yield* AttachmentResolver;
      const settings = yield* PluginSettings;
      const notifier = yield* Notifier;
      const { basePath } = yield* ObsidianEnv;
      const reader = yield* makeReader;

      const openable = (
        file: { attachmentKey: string; absolutePath: string },
        subpath: string,
      ): ObsidianOpenableAttachment => ({
        indexedKey: file.attachmentKey,
        label: filename(file.absolutePath),
        openPath: obsidianOpenPath(file.absolutePath, basePath, platform),
        absolutePath: file.absolutePath,
        ...(subpath ? { subpath } : {}),
      });

      const toZotero = (url: string) =>
        Effect.try({
          try: () => native(url),
          catch: (cause) => new LegacyPortError({ step: "open-system", cause }),
        }).pipe(Effect.as<OpenOutcome>({ kind: "zotero", url }));

      /** Opens in the reader, or hands `fallback` to Zotero when the file is gone. */
      const read = Effect.fnUntraced(function* (
        attachment: ObsidianOpenableAttachment,
        {
          pane,
          fallback,
        }: { pane: PaneType | boolean; fallback: string | null },
      ) {
        const outcome = yield* portCall("open-reader", () =>
          reader.open(attachment, pane),
        );
        if (outcome === "opened") return { kind: "reader" } as OpenOutcome;
        if (fallback === null) return { kind: "file-missing" } as OpenOutcome;
        yield* Effect.logDebug(
          "Target handed to Zotero: the reader found no file",
        ).pipe(Effect.annotateLogs({ attachmentKey: attachment.indexedKey }));
        return yield* toZotero(fallback);
      });

      /** A reader or system handler that failed shows a notice; an interrupt passes on. */
      const reported = (open: Effect.Effect<OpenOutcome, LegacyPortError>) =>
        open.pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* Effect.logError("Target did not open").pipe(
                Effect.annotateLogs({ step: error.step, error: error.cause }),
              );
              yield* notifier.show(m.notice_pdf_open_failed(), {
                duration: 4000,
              });
              return { kind: "failed" } as OpenOutcome;
            }),
          ),
          withLogCategory("attachment-open"),
        );

      /**
       * The index's answer for `attachmentKey`, waiting a bounded time for the
       * first index; still `pending` when that wait ends.
       */
      const lookup = Effect.fnUntraced(function* (attachmentKey: string) {
        const found = yield* attachments.lookup(attachmentKey);
        if (found.kind !== "pending") return found;
        yield* Effect.logDebug("Target waits for the Attachment index").pipe(
          Effect.annotateLogs({ attachmentKey }),
        );
        yield* attachments.warm;
        if (!(yield* indexedWithin(attachments, indexWait))) {
          yield* Effect.logDebug("Target gave up on the Attachment index").pipe(
            Effect.annotateLogs({ attachmentKey }),
          );
          return { kind: "pending" } as AttachmentLookup;
        }
        return yield* attachments.lookup(attachmentKey);
      });

      const followFile = Effect.fnUntraced(function* (
        parsed: URL,
      ): Effect.fn.Return<Claim | null> {
        const absolutePath = yield* Effect.try(() =>
          fileURLToPath(parsed),
        ).pipe(Effect.orElseSucceed(() => null));
        if (absolutePath === null) return null;
        const resolution = yield* attachments.resolve(absolutePath);
        if (resolution.kind !== "resolved" || !resolution.openable) return null;
        return {
          attachment: openable(
            { attachmentKey: resolution.attachmentKey, absolutePath },
            parsed.hash,
          ),
          fallback: null,
        };
      });

      /**
       * A `zotero://open` link that names an Annotation names its Attachment
       * by key, so the Attachment it names opens — even where another one
       * keeps the same file. A file this device does not hold leaves the link
       * to Zotero, which is what makes the link durable; the reader finds that
       * out at the open, so the link is handed over then, as written. Anything
       * short of a valid Annotation key is Zotero's alone, `zotero://select`
       * included.
       *
       * The link's `page` is a printed label, which Obsidian's own jump reads
       * as a page number. It is carried only when it reads as one; the
       * Annotation's own page wins over it whenever the reader can place the
       * Annotation.
       *
       * The link is ZotLit's to follow only while
       * `reader.open-annotation-links` is on; otherwise the click is Zotero's
       * and the link reaches Zotero as written.
       */
      const followDurable = Effect.fnUntraced(function* (
        url: string,
      ): Effect.fn.Return<Claim | null> {
        const link = parseAnnotationOpenUri(url);
        if (link === null) return null;
        const current = yield* settings.current;
        if (!current["reader.open-annotation-links"]) {
          yield* Effect.logDebug("Durable Annotation Link left to Zotero").pipe(
            Effect.annotateLogs({
              attachmentKey: link.attachmentKey,
              groupID: link.groupID,
              reason: "settings",
            }),
          );
          return null;
        }
        const attachment = yield* attachments.lookup(
          formatIndexedKey(link.attachmentKey, link.groupID),
        );
        if (attachment.kind !== "resolved" || !attachment.openable) {
          yield* Effect.logDebug("Durable Annotation Link left to Zotero").pipe(
            Effect.annotateLogs({
              attachmentKey: link.attachmentKey,
              groupID: link.groupID,
              reason:
                attachment.kind === "resolved"
                  ? "not-openable"
                  : attachment.kind,
            }),
          );
          return null;
        }
        const page =
          link.pageLabel !== null && PAGE_NUMBER_RE.test(link.pageLabel)
            ? Number(link.pageLabel)
            : null;
        return {
          attachment: openable(
            attachment,
            formatAnnotationSubpath({
              page,
              annotation: formatIndexedKey(link.annotationKey, link.groupID),
            }),
          ),
          fallback: url,
        };
      });

      return TargetOpener.of({
        open: Effect.fn("TargetOpener.open")(function* (
          target: OpenTarget,
          pane: PaneType | boolean,
        ) {
          const uri = zoteroUri(target);
          if (uri === null) {
            yield* Effect.logWarning("Target names no Zotero object").pipe(
              Effect.annotateLogs({ attachmentKey: target.attachmentKey }),
            );
            return { kind: "unknown" } as OpenOutcome;
          }
          const attachment = yield* lookup(target.attachmentKey);
          if (attachment.kind !== "resolved" || !attachment.openable) {
            yield* Effect.logDebug("Target handed to Zotero").pipe(
              Effect.annotateLogs({
                attachmentKey: target.attachmentKey,
                reason:
                  attachment.kind === "resolved"
                    ? "not-openable"
                    : attachment.kind,
              }),
            );
            return yield* toZotero(uri);
          }
          return yield* read(
            openable(
              attachment,
              target.kind === "annotation"
                ? formatAnnotationSubpath({
                    page:
                      target.pageIndex === null ? null : target.pageIndex + 1,
                    annotation: target.annotationKey,
                  })
                : "",
            ),
            { pane, fallback: uri },
          );
        }, reported),

        follow: Effect.fn("TargetOpener.follow")(
          function* (url: string, _pane: PaneType | boolean) {
            if (!URL.canParse(url)) return null;
            const parsed = new URL(url);
            if (parsed.protocol === "file:") return yield* followFile(parsed);
            if (parsed.protocol === "zotero:") return yield* followDurable(url);
            return null;
          },
          // The decision is the claim; the open it answers runs later.
          (claim, _url, pane) =>
            Effect.map(claim, (claimed) =>
              claimed === null
                ? null
                : reported(
                    read(claimed.attachment, {
                      pane,
                      fallback: claimed.fallback,
                    }),
                  ),
            ),
          withLogCategory("attachment-open"),
        ),
      });
    }),
  );
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
