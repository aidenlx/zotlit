import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect, vi } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import {
  MY_LIBRARY_SCOPE,
  resolveLibraryScope,
} from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { workbenchContext } from "@/services/template-workbench/__fixtures__";
import { readTemplateData } from "@/services/template-workbench/data";
import { layerRcRef } from "@/services/zotero-reads/connection";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import { layerZoteroReads } from "@/services/zotero-reads/service";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { readMigrationVerificationData } from "./migration-data";

vi.mock("@/services/template-workbench/data", async (original) => ({
  ...(await original<typeof import("@/services/template-workbench/data")>()),
  readTemplateData: vi.fn(),
}));

/**
 * My Library holds MAIN2345 (modified last) and RELA2345; the group holds
 * GRPITEMS, outside the saved scope.
 */
const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 1, 1), (2, 'group', 1, 1);
  insert into groups (groupID, libraryID, name) values (900, 2, 'Lab');
  insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');
  insert into fieldsCombined (fieldID, fieldName, custom)
    values (10, 'title', 0), (11, 'citationKey', 0);
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (1, 1, '2024-01-01 00:00:00', '2024-02-01 00:00:00', 1, 'MAIN2345'),
      (3, 1, '2024-01-01 00:00:00', '2024-01-03 00:00:00', 1, 'RELA2345'),
      (300, 1, '2024-01-01 00:00:00', '2024-03-01 00:00:00', 2, 'GRPITEMS');
  insert into itemDataValues (valueID, value)
    values (1, 'Main Study'), (2, 'Alpha Paper'), (3, 'rela2024');
  insert into itemData (itemID, fieldID, valueID)
    values (1, 10, 1), (3, 10, 2), (3, 11, 3);
`;

it.effect(
  "verifies against the first in-scope item that renders, its Citation read before the render",
  () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const client = inProcessClient(
        layerRcRef(memoryOpener(() => SEED).open),
      ).pipe(
        Effect.map((client): ZoteroReadsClient => ({
          ...client,
          ItemsByIndexedKeys: ((payload: {
            readonly indexedKeys: readonly string[];
          }) => {
            events.push(`read ${payload.indexedKeys.join()}`);
            return client.ItemsByIndexedKeys(payload);
          }) as unknown as ZoteroReadsClient["ItemsByIndexedKeys"],
        })),
      );
      const reads = yield* Layer.build(layerZoteroReads(client));
      vi.mocked(readTemplateData).mockImplementation((key, root) => {
        if (root === "note") events.push(`render ${key}`);
        // The item modified last cannot render; the next one can.
        return Effect.succeed(
          key === "MAIN2345"
            ? { kind: "not-found" as const }
            : { kind: "data" as const, data: { root, key } },
        );
      });

      const data = yield* readMigrationVerificationData({
        annotation: false,
      }).pipe(
        Effect.provideContext(workbenchContext(reads)),
        Effect.provideService(
          LibraryScope,
          stubService<LibraryScope["Service"]>("LibraryScope", {
            resolveLibraries: (libraries: readonly Library[]) =>
              Effect.sync(() =>
                resolveLibraryScope(libraries, MY_LIBRARY_SCOPE),
              ),
          }),
        ),
      );

      expect(data).toMatchObject({
        note: { root: "note", key: "RELA2345" },
        filename: { root: "filename", key: "RELA2345" },
        annotation: null,
        citation: [
          {
            citationKey: "rela2024",
            item: { libraryID: USER_LIBRARY_ID, indexedKey: "RELA2345" },
          },
        ],
      });
      expect(events).toEqual([
        "read MAIN2345",
        "render MAIN2345",
        "read RELA2345",
        "render RELA2345",
      ]);
    }),
);
