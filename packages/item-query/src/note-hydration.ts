// The Child Note loading descriptor: its scan row and its parent Item.
import { Effect } from "effect";

import type { NoteScanRow } from "@zotlit/db/item-query";

import type { FieldNeeds, QueryItem } from "./fields";
import { ITEM_LOADING } from "./hydration";
import type { QueryNote } from "./note-fields";
import { parentRecord } from "./record-loader";
import type { LoadingDescriptor } from "./record-loader";

/** What Hydration loads for a Child Note field. The scan row holds its own fields. */
export interface NoteNeeds {
  readonly item?: readonly FieldNeeds[];
}

interface NoteLinks {
  readonly parent: QueryItem;
}

export const NOTE_LOADING: LoadingDescriptor<
  NoteNeeds,
  NoteScanRow,
  null,
  NoteLinks,
  QueryNote
> = {
  own: () =>
    Effect.succeed({
      hydrates: false,
      load: (chunk) => Effect.succeed(chunk.map(() => null)),
    }),
  relations: {
    parent: parentRecord({
      needs: (need: NoteNeeds) => need.item,
      descriptor: () => ITEM_LOADING,
      row: (row: NoteScanRow) => row.parent,
      required: true,
    }),
  },
  record: (_own, { scan, library, related }) => ({
    scan,
    groupID: library.groupID,
    parent: related.parent!,
  }),
};
