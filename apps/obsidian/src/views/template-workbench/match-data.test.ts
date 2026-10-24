// Vault-wide suggestions and the Match test of a real Item read one database.
import type { Vault } from "obsidian";
import { expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { testRuntime } from "@/lib/__fixtures__/runtime";
import { QueryService } from "@/services/item-query/service";
import { inertUseLedger } from "@/services/use-ledger/__fixtures__";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { createMatchData } from "./match-data";

it("includes Libraries outside the chosen paper and keeps automatic Tags and direct Collection paths", async () => {
  await using stack = new AsyncDisposableStack();
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
  const service = stack.use(inProcessReadsService(sharedClientOpener(client)));
  const dispose = vi.fn();
  const db = {
    acquireRead: async () => {
      const lease = await service.acquireRead();
      return {
        reads: lease.reads,
        [Symbol.asyncDispose]: () => {
          dispose();
          return lease[Symbol.asyncDispose]();
        },
      };
    },
  };
  await using query = new QueryService({
    runtime: testRuntime(),
    useLedger: inertUseLedger,
    pluginVersion: "2.2.0",
    reads: service,
    zoteroPref: {
      sourceId: "match-data",
      databasePath: ":memory:",
      dataDir: "/zotero",
      baseAttachmentPath: "/zotero/linked",
    },
    libraryScope: {
      effective: { mode: "all" },
    },
    vault: {
      getName: () => "Match tests",
      adapter: { getBasePath: () => "/vault" },
    } as unknown as Vault,
  });
  const data = createMatchData(db, query);
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
  // Automatic Tags and direct Collection paths count, as in selection.
  for (const [filter, matched] of [
    ['itemType == "book" && library == "personal"', true],
    ['tags.containsAll("Automatic", "Manual")', true],
    ['collections.contains("Project/Drafts")', true],
    ['collections.contains("Project")', false],
    ['collections.within("Project")', true],
    ['tags.contains("Other paper")', false],
  ] as const)
    await expect(data.matches("BKKKK222", filter), filter).resolves.toEqual({
      kind: "result",
      matched,
    });
  await expect(data.matches("ABSENT22", "true")).resolves.toEqual({
    kind: "missing",
  });
  await expect(
    data.matches("BKKKK222", "tags.contain(1)"),
  ).resolves.toMatchObject({
    kind: "problem",
    span: { from: 5, to: 12 },
  });
  expect(dispose).toHaveBeenCalledTimes(3);
});
