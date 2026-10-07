// One utility process retains the search indexes. Node workers run this entry in tests.
import { parentPort } from "node:worker_threads";

import { createLanguageLookup } from "@zotlit/db";
import { createIndexBuilder, searchIndex } from "@zotlit/item-lookup";
import type { SearchIndex, SearchIndexBuilder } from "@zotlit/item-lookup";

import { encodeIndexReply } from "./worker-protocol";
import type { IndexReply, IndexRequest } from "./worker-protocol";

if (process.parentPort) {
  const owner = Number(process.argv[2]);
  if (!Number.isSafeInteger(owner) || owner <= 0)
    throw new Error("Item Lookup process has no owner");
  setInterval(() => {
    try {
      process.kill(owner, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH")
        process.exit(0);
    }
  }, 1000).unref();
}
const port = process.parentPort ?? parentPort;
if (!port) throw new Error("Item Lookup worker has no parent port");
const send = (reply: IndexReply): void =>
  port.postMessage(encodeIndexReply(reply));

interface State {
  builder?: SearchIndexBuilder;
  index?: SearchIndex;
  tokens: Map<string, string[]>;
}
const indexes = new Map<number, State>();
function receive(text: string): void {
  const request = JSON.parse(text) as IndexRequest;
  try {
    let value: number | undefined;
    if (request.type === "begin") {
      const state: State = { tokens: new Map() };
      state.builder = createIndexBuilder(
        (text) => {
          const tokens = state.tokens.get(text);
          if (!tokens)
            throw new Error("Index text has no host-prepared tokens");
          return tokens;
        },
        {
          libraries: request.libraries,
          languageLookup: createLanguageLookup(request.locale),
        },
      );
      indexes.set(request.index, state);
    } else if (request.type === "drop") {
      indexes.delete(request.index);
    } else {
      const state = indexes.get(request.index);
      if (!state) throw new Error("Search index is closed");
      if (request.type === "add") {
        if (!state.builder) throw new Error("Search index is already built");
        state.tokens = new Map(request.tokens);
        try {
          state.builder.add(
            request.items.map((item) => ({
              ...item,
              dateModified: Temporal.Instant.fromEpochMilliseconds(
                item.dateModified,
              ),
            })),
          );
        } finally {
          state.tokens.clear();
        }
      } else if (request.type === "build") {
        if (!state.builder) throw new Error("Search index is already built");
        state.index = state.builder.build();
        state.builder = undefined;
        value = state.index.items.length;
      } else {
        const index = state.index;
        if (!index) throw new Error("Search index is not built");
        const hits =
          request.query.trim() === ""
            ? index.items
                .slice(0, request.limit)
                .map((item) => ({ item, score: 0, matches: [] }))
            : searchIndex(index, request.query, {
                tokenizer: () => request.tokens,
                limit: request.limit,
              });
        send({
          type: "result",
          id: request.id,
          value: hits.map(({ item, ...hit }) => ({
            ...hit,
            item: { itemID: item.itemID },
          })),
        });
        return;
      }
    }
    send({ type: "result", id: request.id, value });
  } catch (error) {
    send({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
if (process.parentPort) {
  process.parentPort.on("message", ({ data }: { data: string }) =>
    receive(data),
  );
} else {
  parentPort!.on("message", receive);
}
send({ type: "ready" });
