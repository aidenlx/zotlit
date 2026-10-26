// The setting tab as a scoped layer: it registers the tab, keeps its
// definitions current, and removes it when its Scope closes.
import { Duration, Effect, Layer, Stream } from "effect";

import { forkEach } from "@/lib/effect-stream";
import { PluginHost } from "@/lib/plugin-host";
import { AttachmentImport } from "@/services/attachment-import/service";
import { ChineseSegmenter } from "@/services/chinese-segmenter/service";
import { LanguagePack } from "@/services/language-pack/service";
import { LibraryScope, scopeChanges } from "@/services/library-scope/service";
import { LocalBridge } from "@/services/local-bridge/service";
import { LocalServer } from "@/services/local-server/service";
import { PandocEngine } from "@/services/pandoc/service";
import { Profile } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { Template } from "@/services/template/service";

import type { SettingTabContext } from "./context";
import { makeSettingTab } from "./effect-tab";
import { ZotLitSettingTab } from "./index";

/**
 * How long the tab waits for changes to settle before it rebuilds. Obsidian
 * re-renders every `render` row on a rebuild, and startup moves several
 * services at once.
 */
const REBUILD_SETTLE = Duration.millis(50);

/** The pending flags that include or leave out the reminder rows. */
const reminderFlags = (settings: Readonly<Settings>) =>
  [
    settings["release.migration-pending"],
    settings["note.template-conversion-pending"],
  ] as const;

/** Each element of `stream` as a bare "something moved". */
const signal = <A>(stream: Stream.Stream<A>): Stream.Stream<void> =>
  Stream.map(stream, () => undefined);

/**
 * The tab over the plugin's services. `webWorkbenchEnabled` is the build's
 * Template Workbench flag, which shows or hides the web editor rows.
 */
export function layerSettingTab({
  webWorkbenchEnabled,
}: Pick<SettingTabContext, "webWorkbenchEnabled">) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* PluginHost;
      const settings = yield* PluginSettings;
      let tab: ZotLitSettingTab | undefined;
      const service = yield* makeSettingTab(() => tab?.update());
      tab = yield* host.addSettingTab(
        (plugin) =>
          new ZotLitSettingTab(plugin, { webWorkbenchEnabled, tab: service }),
      );

      // Rows that are included or left out, not toggled through `visible`,
      // follow these. A scalar `control` edit is read on Obsidian's own render
      // cycle, so it never rebuilds and never steals focus from an input.
      const localServer = yield* LocalServer;
      const profile = yield* Profile;
      const template = yield* Template;
      const pandocEngine = yield* PandocEngine;
      const chineseSegmenter = yield* ChineseSegmenter;
      const libraryScope = yield* LibraryScope;
      const attachmentImport = yield* AttachmentImport;
      const localBridge = yield* LocalBridge;
      const languagePack = yield* LanguagePack;
      yield* forkEach(
        Stream.mergeAll(
          [
            // The Local server rows name the port the listener bound.
            signal(Stream.drop(localServer.effectivePortChanges, 1)),
            // The Workbench Connection row stands only while a connection does.
            signal(Stream.drop(localBridge.changes, 1)),
            // The Language Pack row stands only while a pack is offered.
            signal(Stream.drop(languagePack.changes, 1)),
            signal(Stream.drop(profile.changes, 1)),
            template.compileEvents,
            signal(Stream.drop(pandocEngine.changes, 1)),
            signal(Stream.drop(chineseSegmenter.changes, 1)),
            // A database refresh, a group rename, or a repair moves the scope.
            signal(scopeChanges(libraryScope.changes)),
            // The Approved folders list names each grant.
            signal(Stream.drop(attachmentImport.approvedFoldersChanges, 1)),
            signal(
              settings.changes.pipe(
                Stream.map((current) => reminderFlags(current)),
                Stream.changesWith(
                  (left, right) => left[0] === right[0] && left[1] === right[1],
                ),
                Stream.drop(1),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(Stream.debounce(REBUILD_SETTLE)),
        () => service.update,
      );
    }),
  );
}
