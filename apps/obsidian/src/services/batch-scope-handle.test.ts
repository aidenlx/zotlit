import { Effect } from "effect";
import { expect, it } from "vitest";

import type { Library } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type { ZoteroReads } from "@/services/zotero-reads/service";

import { batchScopeOver } from "./__fixtures__/batch-scope";
import type { ResolvedLibraryScope } from "./library-scope/scope";

const GROUP_LIBRARY: Library = {
  libraryID: 12,
  version: 0,
  clientVersion: null,
  type: "group",
  groupID: 7,
  name: "Reading group",
};

const UNUSED_SCOPE = (): ResolvedLibraryScope => {
  throw new Error("Library Scope read for an exact target");
};

it("resolves the plan of an exact target", async () => {
  const zoteroReads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
    snapshot: Effect.succeed(
      readsAnswering({
        Libraries: () => Effect.succeed([GROUP_LIBRARY]),
        ScopeItemIDs: () => Effect.succeed([3, 4]),
      }),
    ),
  });

  await expect(
    batchScopeOver(zoteroReads, UNUSED_SCOPE).plan("notes", { groupID: 7 }),
  ).resolves.toEqual({
    outcome: "resolved",
    itemIDs: [3, 4],
    unavailableLibraries: 0,
  });
});

it("rejects with the plan's own failure", async () => {
  const failure = new DbUnavailable({ message: "the read failed" });
  const zoteroReads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
    snapshot: Effect.fail(failure),
  });

  await expect(
    batchScopeOver(zoteroReads, UNUSED_SCOPE).plan("notes", {}),
  ).rejects.toBe(failure);
});
