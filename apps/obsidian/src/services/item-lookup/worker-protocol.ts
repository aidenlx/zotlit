import type { IndexedItem } from "@zotlit/db";
import type { SearchHit } from "@zotlit/item-lookup";

export type IndexHit = SearchHit<Pick<IndexedItem, "itemID">>;
export type IndexCommand = { index: number } & (
  | { type: "begin"; libraries: number[]; locale: string }
  | {
      type: "add";
      items: (Omit<IndexedItem, "dateModified"> & { dateModified: number })[];
      tokens: [string, string[]][];
    }
  | { type: "build" }
  | { type: "search"; query: string; tokens: string[]; limit: number }
  | { type: "drop" }
);
export type IndexRequest = IndexCommand & { id: number };
export type IndexReply =
  | { type: "ready" }
  | { type: "result"; id: number; value?: number | IndexHit[] }
  | { type: "error"; id: number; message: string };

/** Electron remote passes strings by value; ordinary objects become remote proxies. */
export function encodeIndexReply(reply: IndexReply): string {
  return JSON.stringify(reply, (key, value: unknown) =>
    key === "score" && value === Infinity ? "Infinity" : value,
  );
}

export function decodeIndexReply(text: string): IndexReply {
  return JSON.parse(text, (key, value: unknown) =>
    key === "score" && value === "Infinity" ? Infinity : value,
  ) as IndexReply;
}
