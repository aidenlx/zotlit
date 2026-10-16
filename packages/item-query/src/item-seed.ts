// An Item as plain JSON, and the Item a filter reads from it: a record that
// a caller holds outside the database, such as a sample Item, keeps the
// values the Items dataset filters on.
import { Effect } from "effect";
import * as v from "valibot";

import {
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
  readUniverseRows,
} from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import { BUILT_IN_NAMES, fieldDefinition } from "./fields";
import type { QueryItem } from "./fields";

const readonlyArray = <TItem extends v.GenericSchema>(item: TItem) =>
  v.pipe(v.array(item), v.readonly());

/**
 * The values of one top-level Item, as JSON. The Item itself alone: a filter
 * that reads its Attachments, Annotations, or Notes finds none. The schema is
 * the one definition of the seed; a host that stores or receives a seed
 * validates it with this schema.
 */
export const queryItemSeedSchema = v.pipe(
  v.object({
    scan: v.pipe(
      v.object({
        itemID: v.number(),
        key: v.string(),
        itemType: v.string(),
        dateAdded: v.nullable(v.number()),
        dateModified: v.nullable(v.number()),
      }),
      v.readonly(),
    ),
    /** `null` for the personal Library. */
    groupID: v.nullable(v.number()),
    /** Each built-in field with a value, by name. */
    fields: v.pipe(v.record(v.string(), v.string()), v.readonly()),
    /** Each custom field with a value, by its source name. */
    custom: v.pipe(v.record(v.string(), v.string()), v.readonly()),
    /** Every custom field of the source, with a value or not. */
    customFieldNames: readonlyArray(v.string()),
    creators: readonlyArray(
      v.pipe(
        v.object({
          firstName: v.string(),
          lastName: v.string(),
          fieldMode: v.picklist([0, 1]),
          creatorType: v.string(),
          primary: v.boolean(),
        }),
        v.readonly(),
      ),
    ),
    tags: readonlyArray(
      v.pipe(
        v.object({ name: v.string(), type: v.picklist([0, 1]) }),
        v.readonly(),
      ),
    ),
    /** The root-first name path of each Collection the Item is in. */
    collections: readonlyArray(readonlyArray(v.string())),
  }),
  v.readonly(),
);

export type QueryItemSeed = v.InferOutput<typeof queryItemSeedSchema>;

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
    const { itemID, key, itemType, dateAdded, dateModified } = scan;
    return {
      scan: { itemID, key, itemType, dateAdded, dateModified },
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
