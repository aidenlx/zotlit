// Tentative type sketches carried forward from the v1 wire format as a
// starting reference. v2 is free to change these — there is no installed-base
// compat constraint (both apps ship together). Revise alongside the first
// real `stringifyQuery` / `parseQuery` implementation.

/**
 * Reference to a single Zotero item, used in URL handoff payloads.
 *
 * `groupID` is present only when the item lives in a group library.
 */
export interface ItemQuery {
  key: string;
  id: number;
  libraryID: number;
  groupID?: number;
}

export type ProtocolAction = "open" | "export" | "update";

export type ProtocolPayload =
  | {
      type: "item";
      version: string;
      items: ItemQuery[];
    }
  | {
      type: "annotation";
      version: string;
      annots: ItemQuery[];
      parent: ItemQuery;
    };

/**
 * HTTP-notify event payloads — POSTed to the `notify-url` receiver.
 */
export type NotifyEvent =
  | {
      event: "regular-item/update";
      add: [id: number, lib: number][];
      modify: [id: number, lib: number][];
      trash: [id: number, lib: number][];
    }
  | {
      event: "reader/annot-select";
      updates: [annotItemId: number, selected: boolean][];
    }
  | {
      event: "reader/active";
      itemId: number;
      attachmentId: number;
    };
