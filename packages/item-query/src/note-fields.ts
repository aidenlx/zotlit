// The record vocabulary of a Child Note, an element of the `notes` Relation
// List of an Item. Child Notes are not a Query Dataset.
import type { NoteScanRow } from "@zotlit/db/item-query";

import { BUILT_IN_NAMES } from "./fields";
import type {
  FieldDefinition as ItemFieldDefinition,
  FieldNeeds,
  QueryItem,
  ValueShape,
} from "./fields";
import { timestamp } from "./filter-dates";
import type { FilterRegistry } from "./filter-plan";
import { keyField, indexedKeyField } from "./key-fields";
import { libraryField } from "./library-field";
import type { NoteNeeds } from "./note-hydration";
import { liftParentRecord } from "./parent-records";
import { definitionFilter } from "./record-field";
import { itemVocabulary } from "./record-vocabularies";

type FieldDefinition = ItemFieldDefinition<QueryNote, NoteNeeds>;

export interface QueryNote {
  readonly scan: NoteScanRow;
  readonly parent: QueryItem;
  readonly groupID: number | null;
}

const string: ValueShape = { kind: "scalar", type: "string" };

export const NOTE_FIELDS = new Map<string, FieldDefinition>([
  ["library", libraryField],
  ["indexedKey", indexedKeyField],
  ["key", keyField],
  [
    "title",
    {
      shape: string,
      needs: () => ({}),
      read: (note) => note.scan.title,
      filter: { type: "string", read: (note) => note.scan.title },
    },
  ],
  ...(["dateAdded", "dateModified"] as const).map(
    (name) =>
      [
        name,
        {
          shape: string,
          needs: () => ({}),
          read: (note: QueryNote) =>
            note.scan[name] === null
              ? null
              : Temporal.Instant.fromEpochMilliseconds(note.scan[name]),
          filter: {
            type: "date" as const,
            read: (note: QueryNote) =>
              note.scan[name] === null
                ? null
                : timestamp(
                    Temporal.Instant.fromEpochMilliseconds(note.scan[name]),
                  ),
          },
        },
      ] as const,
  ),
]);

const itemParent = liftParentRecord({
  name: "item",
  vocabulary: () => itemVocabulary(),
  read: (row: QueryNote) => row.parent,
  identity: (row: QueryNote) => ({
    scan: row.scan.parent,
    groupID: row.groupID,
  }),
  needs: (item: readonly FieldNeeds[]): NoteNeeds => ({ item }),
  candidates: [],
  sortable: [],
  listed: () => BUILT_IN_NAMES,
  syntax: "fields",
});
export const NOTE_PARENTS = [itemParent];

export function noteFieldDefinition(name: string): FieldDefinition | undefined {
  return NOTE_FIELDS.get(name) ?? itemParent.definition(name);
}

export const noteFilterRegistry: FilterRegistry<QueryNote, NoteNeeds> = {
  prefix: itemParent.name,
  field: (name) =>
    definitionFilter(NOTE_FIELDS.get(name)) ?? itemParent.filter(name),
  custom: itemParent.custom,
};
