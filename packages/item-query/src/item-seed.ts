// An Item as plain JSON, and the Item a filter reads from it: a record that
// a caller holds outside the database, such as a sample Item, keeps the
// values the Items dataset filters on.
import { Effect } from "effect";

import {
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readUniverseRows,
} from "@zotlit/db/item-query";
import type {
  HydratedCreator,
  HydratedTag,
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import { BUILT_IN_NAMES, fieldDefinition } from "./fields";
import type { QueryItem } from "./fields";

/**
 * The values of one top-level Item, as JSON. The Item itself alone: a filter
 * that reads its Attachments, Annotations, or Notes finds none.
 */
export interface QueryItemSeed {
  readonly scan: ScanRow;
  /** `null` for the personal Library. */
  readonly groupID: number | null;
  /** Each built-in field with a value, by name. */
  readonly fields: Readonly<Record<string, string>>;
  /** Each custom field with a value, by its source name. */
  readonly custom: Readonly<Record<string, string>>;
  /** Every custom field of the source, with a value or not. */
  readonly customFieldNames: readonly string[];
  readonly creators: readonly HydratedCreator[];
  readonly tags: readonly HydratedTag[];
  /** The root-first name path of each Collection the Item is in. */
  readonly collections: readonly (readonly string[])[];
}

/** The Item that a filter reads from `seed`. */
export function queryItemFrom(seed: QueryItemSeed): QueryItem {
  return {
    scan: seed.scan,
    groupID: seed.groupID,
    hydrated: {
      fields: new Map(Object.entries(seed.fields)),
      custom: new Map(Object.entries(seed.custom)),
      creators: seed.creators,
      tags: seed.tags,
      collections: seed.collections,
    },
    customFieldNames: seed.customFieldNames,
    attachments: [],
    annotations: [],
    notes: [],
  };
}

/**
 * Read the seed of one top-level Item with every value the Items filter
 * reads; `null` when the Item is not a live top-level Item of the Library.
 */
export function readQueryItemSeed(item: {
  readonly itemID: number;
  readonly libraryID: number;
  readonly groupID: number | null;
}): Effect.Effect<
  QueryItemSeed | null,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const [scan] = yield* readUniverseRows({
      libraryID: item.libraryID,
      itemIDs: [item.itemID],
    });
    if (!scan) return null;
    const vocabulary = yield* readFieldVocabulary();
    const builtIn = new Set(
      BUILT_IN_NAMES.flatMap(
        (name) => fieldDefinition(name)?.needs([]).builtIn ?? [],
      ),
    );
    const hydrated = (yield* readHydrateChunk({
      vocabulary,
      itemIDs: [item.itemID],
      fields: { builtIn: [...builtIn], custom: vocabulary.customFieldNames },
      relations: ["creators", "tags", "collections"],
      collectionPaths: yield* readCollectionPaths({
        libraryID: item.libraryID,
      }),
    })).get(item.itemID);
    if (!hydrated) return null;
    return {
      scan,
      groupID: item.groupID,
      fields: Object.fromEntries(hydrated.fields),
      custom: Object.fromEntries(hydrated.custom),
      customFieldNames: vocabulary.customFieldNames,
      creators: hydrated.creators ?? [],
      tags: hydrated.tags ?? [],
      collections: hydrated.collections ?? [],
    };
  });
}
