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
  /** Keep `text` as the search. Settles once plugin data holds it; rejects where the write failed. */
  search: (text: string) => Promise<void>;
}

export function libraryViewStorage(
  settings: Pick<SettingsService, "update" | "flush" | "current">,
): LibraryViewStorage {
  const keep = async (patch: Partial<LibraryViewDocument>) => {
    settings.update((current) => ({
      [KEY]: serializeLibraryViewDocument({
        ...parseLibraryViewDocument(current[KEY] ?? null),
        ...patch,
      }),
    }));
    await settings.flush();
  };
  return {
    ...pluginDataStorage(settings, {
      key: KEY,
      value: (text, stored) =>
        serializeLibraryViewDocument(
          documentWithText(parseLibraryViewDocument(stored), text),
        ),
    }),
    document: () => parseLibraryViewDocument(settings.current?.[KEY] ?? null),
    select: (node) => keep({ node }),
    search: (search) => keep({ search }),
  };
}
