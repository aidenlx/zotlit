// Service reads and writes one Workbench leaf runs on its runner.
import { Effect } from "effect";
import type { TFile } from "obsidian";

import { isChildItemFields, parseIndexedKey } from "@zotlit/db";

import { itemSummary } from "@/lib/item-summary";
import { listInstalledStylesOrNone } from "@/services/pandoc/installed-styles";
import { Profile } from "@/services/profile/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { getSampleItem } from "./selection-data";

/**
 * The Item `indexedKey` names, once a read confirms it is a top-level Item;
 * `null` when it is not, or the database is degraded.
 */
export const readSelectableItem = Effect.fn("TemplateWorkbench.readItem")(
  function* (indexedKey: string) {
    const sample = getSampleItem(indexedKey);
    if (sample) return { id: indexedKey, title: sample.item.title ?? null };
    if (!parseIndexedKey(indexedKey)) return null;
    const db = yield* ZoteroReads;
    if ((yield* db.current).state === "degraded") return null;
    const items = yield* db.reads.ItemsByIndexedKeys({
      indexedKeys: [indexedKey],
    });
    const item = items.get(indexedKey);
    return !item || isChildItemFields(item.fields)
      ? null
      : { id: indexedKey, title: itemSummary(item, item.fields).formatted };
  },
);

/** The built-in Default Profile's source. */
export const builtInSource = Effect.gen(function* () {
  return yield* (yield* Profile).getBuiltInSource;
});

/** The Profile that renders `file`. */
export const profileOfFile = Effect.fn("TemplateWorkbench.profileOf")(
  function* (file: TFile) {
    return yield* (yield* Profile).profileOf(file);
  },
);

/** Writes the Default Profile to its document, for Customize. */
export const materializeDefault = Effect.gen(function* () {
  return yield* (yield* Profile).materializeDefault;
});

/** The citation styles installed in the Zotero data folder. */
export const installedStyles = Effect.gen(function* () {
  const { dataDir } = yield* (yield* ZoteroPref).current;
  return dataDir ? yield* listInstalledStylesOrNone(dataDir) : [];
});

/** The Default Profile's source as the vault holds it. */
export const defaultSource = Effect.gen(function* () {
  return yield* (yield* Profile).getSource("default");
});
