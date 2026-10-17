// The Library View Document in plugin data: the Library View's Query View
// saves a toolbar change into it, and a reopened view reads it back.
import type { SettingsService } from "@/services/settings/service";
import { pluginDataStorage } from "@/views/query-view/plugin-data-storage";
import type { QueryViewHost } from "@/views/query-view/view";

import {
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
} from "./document";
import type { LibraryNode, LibraryViewDocument } from "./document";
import { documentWithText } from "./query-text";

const KEY = "library.document";

export interface LibraryViewStorage extends Pick<QueryViewHost, "save"> {
  /** The document plugin data holds now. */
  document: () => LibraryViewDocument;
  /** Keep `node` as the tree selection. Settles once plugin data holds it; rejects where the write failed. */
  select: (node: LibraryNode) => Promise<void>;
}

export function libraryViewStorage(
  settings: Pick<SettingsService, "update" | "flush" | "current">,
): LibraryViewStorage {
  return {
    ...pluginDataStorage(settings, {
      key: KEY,
      value: (text, stored) =>
        serializeLibraryViewDocument(
          documentWithText(parseLibraryViewDocument(stored), text),
        ),
    }),
    document: () => parseLibraryViewDocument(settings.current?.[KEY] ?? null),
    select: async (node) => {
      settings.update((current) => ({
        [KEY]: serializeLibraryViewDocument({
          ...parseLibraryViewDocument(current[KEY] ?? null),
          node,
        }),
      }));
      await settings.flush();
    },
  };
}
