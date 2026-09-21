import { expect, it } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import type { AnnotationRecord } from "@/services/annotation-repository/service";

import { excerptRequest } from "./request";
import { excerptKey } from "./service";

const annotation: AnnotationRecord = {
  key: "ANNTUV23",
  parentKey: "ATCHUV23",
  type: "image" as const,
  color: null,
  text: null,
  comment: null,
  pageLabel: "1",
  tags: [],
  version: 1,
  position: { kind: "pdf-rects" as const, pageIndex: 0, rects: [[1, 2, 3, 4]] },
};

it("publishes one verified database identity for API and database requests", () => {
  const client = createClient(":memory:");
  using cleanup = new DisposableStack();
  cleanup.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(`
      insert into libraries (libraryID, type, clientVersion)
        values (1, 'user', 7);
      insert into items (itemID, libraryID, key, dateAdded, dateModified)
        values
          (1, 1, 'PARENTUV', '2025-01-01 00:00:00', '2025-01-01 00:00:00'),
          (2, 1, 'ATCHUV23', '2025-01-01 00:00:00', '2025-01-01 00:00:00');
      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
      insert into settings (setting, key, value)
        values
          ('account', 'userID', 1),
          ('account', 'localUserKey', 'LOCAL'),
          ('localAPI', 'serverID', 'SERVER');
    `);
  const paths = { dataDir: "/zotero", baseAttachmentPath: null };
  const identity = {
    userID: 1,
    localUserKey: "LOCAL",
    serverID: "SERVER",
  };
  const api = excerptRequest({
    annotation,
    source: { kind: "zotero-local-api", serverID: "SERVER" },
    client,
    paths,
  });
  const database = excerptRequest({
    annotation,
    source: {
      kind: "zotero-db",
      database: identity,
      libraryID: 1,
      libraryRevision: 7,
    },
    client,
    paths,
  });

  expect(api).not.toBeNull();
  expect(database).not.toBeNull();
  expect(api?.verifiedDatabaseIdentity).toEqual(identity);
  expect(database?.verifiedDatabaseIdentity).toEqual(identity);
  expect(excerptKey(api!)).toBe(excerptKey(database!));
});
