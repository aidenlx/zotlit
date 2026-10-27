// Show in Library on a Literature Note: the command for the active note, and
// the entry on the note's file menu. Both open the Library View on the Item the
// note is about.
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";

import { scopedBridge } from "@/lib/effect-bridge";
import * as m from "@/lib/i18n/generated/messages";
import { MENU_SECTION } from "@/lib/menu-section";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import type { FileMenuSegment } from "@/services/file-menu";
import { itemKeyFromFrontmatter } from "@/services/note-index/parse";

import { ShowInLibrary } from "./show-in-library";

/** The "Show item in Zotero library" command, on the active Literature Note. */
export const layerShowInLibraryActions: Layer.Layer<
  never,
  never,
  PluginHost | Workspace | MetadataCache | ShowInLibrary
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const library = yield* ShowInLibrary;
    const bridge = yield* scopedBridge;
    const activeItemKey = Effect.gen(function* () {
      const file = yield* workspace.getActiveFile;
      if (!(file instanceof TFile) || file.extension !== "md") return null;
      return itemKeyFromFrontmatter(yield* metadata.fileCache(file));
    });
    yield* host.addCommand({
      id: "show-in-library",
      name: m.command_show_in_library_name(),
      checkCallback: (checking) => {
        const indexedKey = bridge.runSync(activeItemKey);
        if (indexedKey === null) return false;
        if (!checking) bridge.runAndForget(library.show(indexedKey));
        return true;
      },
    });
  }),
);

/** "Show in Zotero library" on a Literature Note's file menu. */
export function showInLibraryFileMenu(
  show: (indexedKey: string) => void,
): FileMenuSegment {
  return (menu, { itemKey }) => {
    if (itemKey === null) return;
    menu.addItem((item) =>
      item
        .setSection(MENU_SECTION.view)
        .setTitle(m.library_view_show_in_library())
        .setIcon("library")
        .onClick(() => show(itemKey)),
    );
  };
}
