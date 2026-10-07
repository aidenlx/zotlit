import { expect, it, vi } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import {
  MY_LIBRARY_SCOPE,
  resolveLibraryScope,
} from "@/services/library-scope/scope";
import { loadTemplateData } from "@/services/template-workbench/data";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { loadLiteratureNoteTemplateMigrationData } from "./migration";
import type { LiteratureNoteTemplateMigrationDataDeps } from "./migration";

vi.mock("@/services/template-workbench/data", async (original) => ({
  ...(await original<typeof import("@/services/template-workbench/data")>()),
  loadTemplateData: vi.fn(),
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

it("verifies against the first in-scope item that renders, its Citation read before the render", async () => {
  const events: string[] = [];
  await using reads = inProcessReadsService(memoryOpener(() => SEED).open, {
    wrap: (client) => ({
      ...client,
      ItemsByIndexedKeys: ((payload: {
        readonly indexedKeys: readonly string[];
      }) => {
        events.push(`read ${payload.indexedKeys.join()}`);
        return client.ItemsByIndexedKeys(payload);
      }) as unknown as ZoteroReadsClient["ItemsByIndexedKeys"],
    }),
  });
  vi.mocked(loadTemplateData).mockImplementation(async (_deps, key, root) => {
    if (root === "note") events.push(`render ${key}`);
    // The item modified last cannot render; the next one can.
    return key === "MAIN2345"
      ? { kind: "not-found" }
      : { kind: "data", data: { root, key } };
  });
  const deps = {
    zoteroReads: reads,
    libraryScope: {
      ready: Promise.resolve(),
      resolveLibraries: (libraries: readonly Library[]) =>
        resolveLibraryScope(libraries, MY_LIBRARY_SCOPE),
    },
  } as unknown as LiteratureNoteTemplateMigrationDataDeps;

  const data = await loadLiteratureNoteTemplateMigrationData(deps, {
    annotation: false,
  });

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
});
