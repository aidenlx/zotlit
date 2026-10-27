// File Link Capture: a clicked Attachment File Link, or a Durable Annotation
// Link, reaches Obsidian's own PDF view instead of the system handler, when it
// names an Obsidian-Openable Attachment. The patch is the opener's entry point
// for links Obsidian rendered; which links it takes is the opener's to decide.

import { Effect } from "effect";
import { around } from "monkey-around";
import type { PaneType } from "obsidian";

import { disposable } from "@/lib/disposables";
import type { EffectBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type { AttachmentResolver } from "@/services/attachment-resolver/service";
import type { PluginSettings } from "@/services/settings/service";

import type { TargetOpener } from "./open-target";

/**
 * The target Obsidian's own "Open in default browser" context-menu item passes
 * to `window.open`. Capture hands it straight back, so that item stays the
 * per-link way out of Obsidian's reader, and the opener hands Zotero a link
 * through it, past this patch.
 */
export const EXTERNAL_TARGET = "_external";

/**
 * The system handler, reached past File Link Capture: Obsidian sends a
 * non-web link to it whatever the target, and Capture hands `_external` back
 * untouched, so a link the opener gives to Zotero is never captured again.
 */
export function openWithSystem(url: string): void {
  window.open(url, EXTERNAL_TARGET);
}

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

export interface FileLinkCaptureDeps {
  /** Decides which links ZotLit takes, and opens them. */
  opener: Pick<TargetOpener["Service"], "follow">;
  attachments: Pick<AttachmentResolver["Service"], "warm">;
  settings: Pick<PluginSettings["Service"], "current">;
  /** Runs the opener's decision at the click, then the open it answers. */
  bridge: Pick<EffectBridge, "runSync" | "runAndForget">;
  /** The window whose `open` is patched. Defaults to the one the plugin runs in. */
  window?: Window;
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
 * The resolver builds its index on the first lookup, and the opener leaves
 * every link to the system handler until it lands. A note's links are clicked
 * before any PDF asks for that index, so Capture asks for it as it installs.
 *
 * @see apps/obsidian/docs/adr/0045-file-link-capture-patches-window-open.md
 */
export function registerFileLinkCapture(deps: FileLinkCaptureDeps): Disposable {
  const host = (deps.window ?? window) as { open: Window["open"] };
  deps.bridge.runSync(deps.attachments.warm);

  return disposable(
    around(host, {
      open:
        (native) =>
        (url?: string | URL, target?: string, features?: string) => {
          if (
            target === EXTERNAL_TARGET ||
            url === undefined ||
            !deps.bridge.runSync(deps.settings.current)[
              "reader.open-file-links"
            ]
          ) {
            return native(url, target, features);
          }
          // The decision runs now, so the click is claimed or passed on
          // before this handler returns.
          const followed = deps.bridge.runSync(
            deps.opener.follow(String(url), paneFromTarget(target)),
          );
          if (followed === null) return native(url, target, features);

          deps.bridge.runAndForget(
            Effect.logDebug("Link captured").pipe(
              Effect.annotateLogs({ url: String(url), target }),
              withLogCategory("attachment-open"),
              Effect.andThen(followed),
              Effect.tap((outcome) =>
                Effect.sync(() => {
                  if (outcome.kind === "file-missing")
                    new BaseNotice(m.notice_pdf_file_missing());
                }),
              ),
            ),
          );
          return null;
        },
    }),
  );
}
