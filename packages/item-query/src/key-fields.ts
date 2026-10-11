import { formatIndexedKey } from "@zotlit/db";

import type { FieldDefinition } from "./fields";

type KeyedRecord = {
  readonly scan: { readonly key: string };
  readonly groupID: number | null;
};

const readKey = (row: KeyedRecord) => row.scan.key;
const readIndexedKey = (row: KeyedRecord) =>
  formatIndexedKey(row.scan.key, row.groupID);

export const keyField: FieldDefinition<KeyedRecord, object> = {
  shape: { kind: "scalar", type: "string" },
  needs: () => ({}),
  read: readKey,
  sortKey: readKey,
  filter: { type: "string", read: readKey },
};

export const indexedKeyField: FieldDefinition<KeyedRecord, object> = {
  ...keyField,
  read: readIndexedKey,
  sortKey: readIndexedKey,
  filter: { type: "string", read: readIndexedKey },
};
