// Service reads and writes one Workbench leaf runs on its runner.
import { Effect } from "effect";
import type { TFile } from "obsidian";

import { isChildItemFields, parseIndexedKey } from "@zotlit/db";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";

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

/** The Item Snapshot of the Item a parsed Indexed Key names, under one read. */
export const readItemSnapshot = Effect.fn("TemplateWorkbench.readSnapshot")(
  function* (parsed: NonNullable<ReturnType<typeof parseIndexedKey>>) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* (yield* ZoteroReads).snapshot;
        return yield* reads.ItemSnapshot({
          selection: {
            key: parsed.key,
            library:
              parsed.groupID === null
                ? { type: "personal" }
                : { type: "group", groupID: parsed.groupID },
          },
          provenance: {
            kind: "connected",
            installationId: "obsidian",
            vault: "preview",
          },
        });
      }),
    );
  },
);

/** The chosen Item: its title and the data every surface renders against. */
export interface ChosenItem {
  readonly title: string | null;
  readonly snapshot: ItemSnapshot;
}

/**
 * The one read of a chosen Item: a Sample Item carries its data; a library
 * Item is read once a read confirms it is a top-level Item. `null` when it is
 * not one, or the database is degraded.
 */
export const readChosenItem = Effect.fn("TemplateWorkbench.readChosenItem")(
  function* (indexedKey: string) {
    const sample = getSampleItem(indexedKey);
    if (sample) return { title: sample.item.title ?? null, snapshot: sample };
    const choice = yield* readSelectableItem(indexedKey);
    const parsed = parseIndexedKey(indexedKey);
    if (!choice || !parsed) return null;
    const snapshot: ItemSnapshot = yield* readItemSnapshot(parsed);
    return { title: choice.title, snapshot } satisfies ChosenItem;
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
