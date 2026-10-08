// Excerpt preparation reads the database before the vault, through ZoteroReads.
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, it } from "vitest";

import { getAnnotationsByKey } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { defaults } from "@/services/settings/schema";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import type { ExcerptRequest } from "./contract";
import { createExcerptPreparation } from "./prepare";

const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', 0, 12);
  insert into settings (setting, key, value) values
    ('account', 'userID', 42),
    ('account', 'localUserKey', 'LOCALKEY'),
    ('localAPI', 'serverID', 'SERVER000001');
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values
    (1, 1, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 1, 'RUGIER24'),
    (2, 2, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 1, 'RGRPDF24'),
    (3, 4, '2025-01-01 00:00:00', '2025-01-01 00:00:00', 1, 'FDRFQ7C2');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (2, 1, 0, 'application/pdf', 'storage:paper.pdf');
  insert into itemAnnotations (itemID, parentItemID, type, color, pageLabel, position)
    values (3, 2, 3, '#ffd400', '1', '{"pageIndex":0,"rects":[[0,0,10,10]]}');
`;

const READ_OPERATIONS = [
  "AttachmentsByKeys",
  "DatabaseIdentity",
  "Libraries",
] as const;

it("reads every database input before it reads the previous note", async () => {
  await using stack = new AsyncDisposableStack();
  const client = stack.adopt(createClient(":memory:"), (db) =>
    db.$client.close(),
  );
  createFixtureSchema(client.$client);
  client.$client.exec(SEED);
  const { reads } = await stack.use(
    inProcessReadsService(sharedClientOpener(client)),
  ).ready;
  const log: string[] = [];
  const logged = { ...reads } as Record<string, unknown>;
  for (const operation of READ_OPERATIONS) {
    const call = reads[operation] as (payload: object) => unknown;
    logged[operation] = (payload: object) => {
      log.push(operation);
      return call(payload);
    };
  }
  const requests: ExcerptRequest[] = [];
  const app = {
    vault: {
      adapter: {},
      cachedRead: async () => {
        log.push("vault");
        return "";
      },
    },
    workspace: { iterateAllLeaves: () => {} },
  } as unknown as App;
  const prepared = createExcerptPreparation({
    app,
    paths: { dataDir: "/zotero", baseAttachmentPath: null },
    resolver: {
      operation: () => ({
        resolve: async (request: ExcerptRequest) => {
          requests.push(request);
          return { kind: "unavailable" as const };
        },
        [Symbol.asyncDispose]: async () => {},
      }),
    },
  })({
    reads: logged as unknown as ZoteroReadsApi,
    notePath: "Note.md",
    settings: { ...defaults, "attachment.import": true },
    previousNote: Object.assign(new TFile(), { path: "Note.md" }),
  });
  const [annotation] = getAnnotationsByKey(client, ["FDRFQ7C2"], 1);
  prepared.annotationImageLink(annotation!);

  await prepared.prepare();

  expect(log.at(-1)).toBe("vault");
  expect(log.slice(0, -1).toSorted()).toEqual([...READ_OPERATIONS]);
  expect(requests).toMatchObject([
    {
      attachmentKey: "RGRPDF24",
      libraryID: 1,
      pdfPath: "/zotero/storage/RGRPDF24/paper.pdf",
      source: {
        kind: "zotero-db",
        database: {
          userID: 42,
          localUserKey: "LOCALKEY",
          serverID: "SERVER000001",
        },
        libraryID: 1,
        libraryRevision: 12,
      },
    },
  ]);
});
