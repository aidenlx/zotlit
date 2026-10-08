import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { QueryClientService } from "@/services/query-client/service";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import {
  holdConnectionReadout,
  readConnectionStatus,
  readConnectionSync,
} from "./connection";

/** One regular item per row in `libraryItems`, as [libraryID, count] pairs. */
function itemsSql(libraryItems: [libraryID: number, count: number][]): string {
  let itemID = 0;
  return libraryItems
    .map(([libraryID, count]) => {
      const library =
        libraryID === 1
          ? `insert into libraries (libraryID, type) values (1, 'user');`
          : `insert into libraries (libraryID, type) values (${libraryID}, 'group');
             insert into groups (groupID, libraryID, name) values (${libraryID * 100}, ${libraryID}, 'Group ${libraryID}');`;
      const items = Array.from({ length: count }, () => {
        itemID += 1;
        return `insert into items (itemID, itemTypeID, libraryID, key) values (${itemID}, 1, ${libraryID}, 'ITEM${String(itemID).padStart(4, "0")}');`;
      });
      return [library, ...items].join("\n");
    })
    .join("\n");
}

const ONE_LIBRARY = `insert into itemTypes (itemTypeID, typeName) values (1, 'book');
${itemsSql([[1, 2]])}`;

async function setup(
  stack: AsyncDisposableStack,
  seeds: (string | null)[],
  dataDir = "/opt/zotero-data",
) {
  const { open } = memoryOpener((n) => seeds[n - 1] ?? null);
  const reads = stack.use(inProcessReadsService(open));
  const queries = stack.use(new QueryClientService());
  stack.defer(holdConnectionReadout({ reads, queries }));
  await reads.ready;
  return { reads, queries, zoteroPref: { dataDir } };
}

describe("readConnectionStatus", () => {
  it("database that cannot open → missing", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [null]);

    expect(await readConnectionStatus(deps)).toEqual({ status: "missing" });
  });

  it("ready but last refresh failed → missing", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [ONE_LIBRARY, null]);
    await readConnectionStatus(deps);

    await deps.reads.refresh().catch(() => {});

    expect(await readConnectionStatus(deps)).toEqual({ status: "missing" });
  });

  it("ready → connected with the item count of the one library", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [ONE_LIBRARY]);

    expect(await readConnectionStatus(deps)).toEqual({
      status: "connected",
      path: "/opt/zotero-data",
      itemCount: 2,
    });
  });

  it("totals every library the database holds, whatever the library scope is", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [
      `insert into itemTypes (itemTypeID, typeName) values (1, 'book');
       ${itemsSql([
         [1, 4],
         [2, 2],
         [3, 1],
       ])}`,
    ]);

    expect(await readConnectionStatus(deps)).toMatchObject({
      status: "connected",
      itemCount: 7,
    });
  });

  it("abbreviates a data dir under the home directory to ~", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [ONE_LIBRARY], join(homedir(), "Zotero"));

    expect(await readConnectionStatus(deps)).toMatchObject({
      path: "~/Zotero",
    });
  });
});

describe("readConnectionSync", () => {
  it("answers nothing until a count is held, then the held count", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [ONE_LIBRARY]);

    expect(readConnectionSync(deps)).toBeNull();
    await readConnectionStatus(deps);

    expect(readConnectionSync(deps)).toEqual({
      status: "connected",
      path: "/opt/zotero-data",
      itemCount: 2,
    });
  });

  it("keeps the previous count after a refresh until the fresh readout lands", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [
      ONE_LIBRARY,
      `insert into itemTypes (itemTypeID, typeName) values (1, 'book');
       ${itemsSql([[1, 5]])}`,
    ]);
    await readConnectionStatus(deps);

    await deps.reads.refresh();

    expect(readConnectionSync(deps)).toMatchObject({ itemCount: 2 });
    expect(await readConnectionStatus(deps)).toMatchObject({ itemCount: 5 });
    expect(readConnectionSync(deps)).toMatchObject({ itemCount: 5 });
  });

  it("answers missing when the database cannot open", async () => {
    await using stack = new AsyncDisposableStack();
    const deps = await setup(stack, [null]);
    await readConnectionStatus(deps);

    expect(readConnectionSync(deps)).toEqual({ status: "missing" });
  });
});
