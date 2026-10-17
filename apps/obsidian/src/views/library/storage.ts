// The Library View Document in plugin data: the Library View's Query View
// saves a toolbar change into it, and a reopened view reads it back.
import type { SettingsService } from "@/services/settings/service";
import { pluginDataStorage } from "@/views/query-view/plugin-data-storage";
import type { QueryViewHost } from "@/views/query-view/view";

import {
  documentWithNode,
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
} from "./document";
import type {
  LibraryNode,
  LibraryViewDocument,
  ReadingStateFacet,
} from "./document";
import { documentWithText } from "./query-text";

const KEY = "library.document";

export interface LibraryViewStorage extends Pick<QueryViewHost, "save"> {
  /** The document plugin data holds now. */
  document: () => LibraryViewDocument;
  /** Keep `node` as the tree selection, with the sort it writes. Settles once plugin data holds it; rejects where the write failed. */
  select: (node: LibraryNode) => Promise<void>;
  /** Keep `facets` as the active Reading State facets. Settles and rejects as {@link select} does. */
  setFacets: (facets: readonly ReadingStateFacet[]) => Promise<void>;
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
    select: (node) => keep((doc) => documentWithNode(doc, node)),
    setFacets: (facets) => keep((doc) => ({ ...doc, facets })),
  };

  async function keep(
    change: (doc: LibraryViewDocument) => LibraryViewDocument,
  ): Promise<void> {
    settings.update((current) => ({
      [KEY]: serializeLibraryViewDocument(
        change(parseLibraryViewDocument(current[KEY] ?? null)),
      ),
    }));
    await settings.flush();
  }
}
