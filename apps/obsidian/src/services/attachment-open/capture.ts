// File Link Capture: a clicked Attachment File Link, or a Durable Annotation
// Link, reaches Obsidian's own PDF view instead of the system handler, when it
// names an Obsidian-Openable Attachment.

import { around } from "monkey-around";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PaneType } from "obsidian";

import {
  formatAnnotationSubpath,
  formatIndexedKey,
  parseAnnotationOpenUri,
} from "@zotlit/db";

import type { AttachmentReader } from "@/lib/attachment-open";
import { disposable } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import type {
  AttachmentLocation,
  AttachmentResolution,
} from "@/services/attachment-resolver/service";
import type { AttachmentResolver } from "@/services/attachment-resolver/service";
import type { SettingsService } from "@/services/settings/service";

import type { ObsidianOpenableAttachment } from "./resolve";
import { filename, obsidianOpenPath } from "./resolve";

const logger = getLogger("attachment-open");

/**
 * The target Obsidian's own "Open in default browser" context-menu item passes
 * to `window.open`. Capture hands it straight back, so that item stays the
 * per-link way out of Obsidian's reader.
 */
const EXTERNAL_TARGET = "_external";

/** What `window.open`'s second argument says about where the click wanted the file. */
export function paneFromTarget(target: string | undefined): PaneType | boolean {
  switch (target) {
    case "tab":
    case "split":
    case "window":
      return target;
    default:
      return false;
  }
}

/** What Capture needs to judge one clicked URL, with no Obsidian objects in it. */
export interface FileLinkCaptureContext {
  resolve: (absolutePath: string) => AttachmentResolution;
  /** The file an Attachment keeps, by its Indexed Key, for a Durable Annotation Link. */
  locate: (attachmentKey: string) => AttachmentLocation;
  /** Whether a file is on this computer, for a Durable Annotation Link. */
  exists: (absolutePath: string) => boolean;
  vaultBasePath: string;
  platform: NodeJS.Platform;
}

/**
 * Either ZotLit takes the click, naming the Attachment exactly as every other
 * ZotLit reader gesture names one, or the original `window.open` runs
 * untouched.
 */
export type FileLinkCapture =
  | { kind: "pass" }
  | { kind: "capture"; attachment: ObsidianOpenableAttachment };

const PASS: FileLinkCapture = { kind: "pass" };

/**
 * Decide one clicked URL. A link ZotLit cannot name as an Obsidian-Openable
 * Attachment passes through, including while the resolver answers `pending` —
 * Capture does not claim a link it cannot yet identify.
 */
export function decideFileLinkCapture(
  url: string,
  ctx: FileLinkCaptureContext,
): FileLinkCapture {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return PASS;
  }
  if (parsed.protocol === "zotero:") return decideDurableLinkCapture(url, ctx);
  if (parsed.protocol !== "file:") return PASS;

  let absolutePath: string;
  try {
    absolutePath = fileURLToPath(parsed);
  } catch {
    return PASS;
  }
  return captureAt(absolutePath, parsed.hash, ctx);
}

/** A printed page label that also reads as a 1-based page number. */
const PAGE_NUMBER_RE = /^[1-9]\d*$/;

/**
 * Decide a `zotero://open` link that names an Annotation. It names the
 * Attachment by key, so the resolver locates the file first, and a file this
 * computer does not hold leaves the link to Zotero — the reason the link is
 * durable at all. Anything short of a valid Annotation key is Zotero's alone,
 * `zotero://select` included.
 *
 * The link's `page` is a printed label, which Obsidian's own jump reads as a
 * page number. It is carried only when it reads as one; the Annotation's own
 * page wins over it whenever the reader can place the Annotation.
 *
 * @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md
 */
function decideDurableLinkCapture(
  url: string,
  ctx: FileLinkCaptureContext,
): FileLinkCapture {
  const link = parseAnnotationOpenUri(url);
  if (link === null) return PASS;

  const location = ctx.locate(
    formatIndexedKey(link.attachmentKey, link.groupID),
  );
  if (location.kind !== "located" || !ctx.exists(location.absolutePath))
    return PASS;

  const page =
    link.pageLabel !== null && PAGE_NUMBER_RE.test(link.pageLabel)
      ? Number(link.pageLabel)
      : null;
  return captureAt(
    location.absolutePath,
    formatAnnotationSubpath({
      page,
      annotation: formatIndexedKey(link.annotationKey, link.groupID),
    }),
    ctx,
  );
}

/** Claim the file at `absolutePath` when it is an Obsidian-Openable Attachment. */
function captureAt(
  absolutePath: string,
  subpath: string,
  ctx: FileLinkCaptureContext,
): FileLinkCapture {
  const resolution = ctx.resolve(absolutePath);
  if (resolution.kind !== "resolved" || !resolution.openable) return PASS;

  return {
    kind: "capture",
    attachment: {
      indexedKey: resolution.attachmentKey,
      label: filename(absolutePath),
      openPath: obsidianOpenPath(absolutePath, ctx.vaultBasePath, ctx.platform),
      absolutePath,
      ...(subpath ? { subpath } : {}),
    },
  };
}

export interface FileLinkCaptureDeps {
  /** The vault's own directory, for telling an in-vault Attachment from one outside. */
  vaultBasePath: string;
  attachments: Pick<AttachmentResolver, "resolve" | "locate" | "warm">;
  settings: Pick<SettingsService, "current">;
  /** Where a captured link opens — the same reader every other ZotLit gesture uses. */
  reader: AttachmentReader<ObsidianOpenableAttachment>;
  /** The window whose `open` is patched. Defaults to the one the plugin runs in. */
  window?: Window;
  /** Whether a file is on this computer. Defaults to the filesystem's answer. */
  exists?: (absolutePath: string) => boolean;
}

/**
 * Patch `window.open`, the one symbol reading view, Live Preview, Properties,
 * and Bases all reach when a click leaves for an external link. Live Preview
 * renders no anchor at all, so a delegated DOM listener would cover reading
 * view alone and split one link's behaviour across the two modes.
 *
 * One patch covers pop-out windows too. Obsidian's link handlers call the bare
 * global `window.open`, which is why `activeWindow` exists at all, so the
 * click reaches this patch whichever window it happened in.
 *
 * The resolver builds its index on the first lookup and answers `pending`
 * until it lands, which hands a click to the system handler. A note's links
 * are clicked before any PDF asks for that index, so Capture asks for it as it
 * installs.
 *
 * @see apps/obsidian/docs/adr/0045-file-link-capture-patches-window-open.md
 */
export function registerFileLinkCapture(deps: FileLinkCaptureDeps): Disposable {
  const host = (deps.window ?? window) as { open: Window["open"] };
  deps.attachments.warm();

  return disposable(
    around(host, {
      open:
        (native) =>
        (url?: string | URL, target?: string, features?: string) => {
          if (
            target === EXTERNAL_TARGET ||
            url === undefined ||
            !(deps.settings.current?.["reader.open-file-links"] ?? true)
          ) {
            return native(url, target, features);
          }
          const capture = decideFileLinkCapture(String(url), {
            resolve: (path) => deps.attachments.resolve(path),
            locate: (key) => deps.attachments.locate(key),
            exists: deps.exists ?? existsSync,
            vaultBasePath: deps.vaultBasePath,
            platform: process.platform,
          });
          if (capture.kind === "pass") return native(url, target, features);

          logger.debug("Attachment File Link captured", {
            attachmentKey: capture.attachment.indexedKey,
            openPath: capture.attachment.openPath,
            subpath: capture.attachment.subpath,
          });
          void deps.reader.open(capture.attachment, paneFromTarget(target));
          return null;
        },
    }),
  );
}
