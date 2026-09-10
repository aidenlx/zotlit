// Vault-wide suggestions and Item facts use the same pinned database.
import { expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { createMatchData, loadMatchFacts } from "./match-data";

it("includes Libraries outside the chosen paper and keeps automatic Tags and direct Collection paths", async () => {
  using stack = new DisposableStack();
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID,type) values (1,'user'), (2,'group');
    insert into groups (groupID,libraryID,name) values (118,2,'Team');
    insert into itemTypes (itemTypeID,typeName) values (1,'book');
    insert into items (itemID,itemTypeID,libraryID,key) values (1,1,1,'BKKKK222');
    update items set dateAdded='2026-01-01 00:00:00',dateModified='2026-01-01 00:00:00',clientDateModified='2026-01-01 00:00:00';
    insert into tags (tagID,name) values (1,'Manual'), (2,'Automatic'), (3,'Other paper');
    insert into itemTags (itemID,tagID,type) values (1,1,0), (1,2,1);
    insert into collections (collectionID,collectionName,parentCollectionID,libraryID,key) values (1,'Project',null,1,'PROJ0001'), (2,'Drafts',1,1,'DRFT0001'), (3,'Team only',null,2,'TEAM0001'), (4,'A/B',null,1,'SLASH222');
    insert into collectionItems (collectionID,itemID) values (2,1), (4,1);
  `);
  const dispose = vi.fn();
  const db = {
    acquireRead: async () => ({ client, [Symbol.dispose]: dispose }),
  };
  const data = createMatchData(db);
  await expect(data.tags()).resolves.toEqual([
    "Automatic",
    "Manual",
    "Other paper",
  ]);
  // ADR 0040 accepts slash ambiguity in expressions; provider facts retain real segments.
  await expect(data.collections()).resolves.toEqual([
    ["A/B"],
    ["Project"],
    ["Project", "Drafts"],
    ["Team only"],
  ]);
  await expect(data.libraries()).resolves.toEqual([
    { id: "personal" },
    { id: "group:118", name: "Team" },
  ]);
  await expect(loadMatchFacts(db, "BKKKK222")).resolves.toEqual({
    library: { type: "personal" },
    itemType: "book",
    tags: ["Automatic", "Manual"],
    collections: [["Project", "Drafts"], ["A/B"]],
  });
  expect(dispose).toHaveBeenCalledTimes(4);
});
