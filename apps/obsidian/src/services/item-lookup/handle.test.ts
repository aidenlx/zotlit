// The Item search's Promise edge after the runtime under it is disposed.
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { layerRcRef } from "@/services/zotero-reads/connection";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { buildItemLookup } from "./__fixtures__";

const SEED = `
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 1, 0);
  insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
  insert into fieldsCombined (fieldID, fieldName, custom) values (10, 'title', 0);
  insert into itemDataValues (valueID, value) values (1, 'Alpha');
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ALPHA222');
  insert into itemData (itemID, fieldID, valueID) values (1, 10, 1);
`;

const keysOf = (hits: readonly { item: { indexedKey: string } }[]) =>
  hits.map((hit) => hit.item.indexedKey);

it.effect("answers every search empty after the runtime is disposed", () =>
  Effect.promise(async () => {
    const stack = new AsyncDisposableStack();
    const lookup = await buildItemLookup(
      inProcessClient(layerRcRef(memoryOpener(() => SEED).open)),
      [{ selector: { type: "personal" }, libraryID: 1, name: null }],
      stack,
    );
    using live = lookup.openSession();
    expect(keysOf(await lookup.search("Alpha"))).not.toEqual([]);
    expect(keysOf(await live.search("Alpha"))).not.toEqual([]);

    await stack.disposeAsync();

    expect(await lookup.search("Alpha")).toEqual([]);
    expect(await live.search("Alpha")).toEqual([]);
    using later = lookup.openSession();
    expect(await later.search("Alpha")).toEqual([]);
  }),
);
