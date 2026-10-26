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

const GROUP_READS = readsAnswering({
  Libraries: () => Effect.succeed([GROUP_LIBRARY]),
  ScopeItemIDs: () => Effect.succeed([3, 4]),
});

it("resolves the plan of an exact target", async () => {
  await using stack = new AsyncDisposableStack();
  const zoteroReads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
    snapshot: Effect.succeed(GROUP_READS),
  });

  await expect(
    batchScopeOver(zoteroReads, UNUSED_SCOPE, stack).plan("notes", {
      groupID: 7,
    }),
  ).resolves.toEqual({
    outcome: "resolved",
    itemIDs: [3, 4],
    unavailableLibraries: 0,
  });
});

it("rejects with the plan's own failure", async () => {
  await using stack = new AsyncDisposableStack();
  const failure = new DbUnavailable({ message: "the read failed" });
  const zoteroReads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
    snapshot: Effect.fail(failure),
  });

  await expect(
    batchScopeOver(zoteroReads, UNUSED_SCOPE, stack).plan("notes", {}),
  ).rejects.toBe(failure);
});

it("settles a pending plan after the runtime is disposed", async () => {
  const stack = new AsyncDisposableStack();
  const opened = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const zoteroReads = stubService<ZoteroReads["Service"]>("ZoteroReads", {
    snapshot: Effect.promise(async () => {
      opened.resolve();
      await gate.promise;
      return GROUP_READS;
    }),
  });
  const plan = batchScopeOver(zoteroReads, UNUSED_SCOPE, stack).plan("notes", {
    groupID: 7,
  });

  await opened.promise;
  await stack.disposeAsync();
  gate.resolve();

  await expect(plan).resolves.toEqual({
    outcome: "resolved",
    itemIDs: [3, 4],
    unavailableLibraries: 0,
  });
});
