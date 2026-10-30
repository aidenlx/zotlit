import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ATTACHMENTS,
  ITEMS,
  LIBRARIES,
  discardFixture,
  getFixtureLayout,
} from "@zotlit/scripts/fixture";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable } from "./e2e-run-fixture.ts";
import { attachmentAnnotations, workspaceRoot } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks } from "./e2e-run-lifecycle.ts";
import type { ItemQueryReport } from "./e2e-run-query-types.ts";
import { cliCommand } from "./obsidian-cli.ts";
import { clearVault, e2eVaultDir, vaultScript } from "./vault-script.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  describe("ZotLit Query attachments", () => {
    const queryFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-attachment-query-fixture"),
    );
    const queryVaultPath = e2eVaultDir(workspaceRoot, "attachment-query-vault");
    const queryVaultScript = vaultScript(workspaceRoot, queryFixture.root);
    let queryVaultId: string;
    beforeAll(async () => {
      await clearVault(queryVaultScript, queryVaultPath);
      const created = await queryVaultScript(["create", queryVaultPath]);
      queryVaultId = created.stdout.trim().split("\n")[0]!.trim();
      await prepareRunWindow(queryVaultId);
    });
    afterAll(async () => {
      await queryVaultScript(["remove", queryVaultPath, "--purge"]);
      await discardFixture(queryFixture);
    });
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(queryVaultId, "zotlit:query", {
          args: { from: "attachments", ...args },
        }),
      ) as ItemQueryReport;

    it("projects and sorts keys and groups file types through ZotLit Query", async () => {
      for (const from of ["items", "attachments", "annotations"]) {
        const answer = await query({
          from,
          library: "all",
          fields: "indexedKey,key",
          sort: "indexedKey",
          limit: "all",
        });
        expect(answer).toMatchObject({
          ok: true,
          contractVersion: 3,
          truncated: false,
        });
        expect(answer.returnedCount).toBeGreaterThan(0);
        const keys = answer.rows!.map((row) => row.indexedKey);
        expect(keys).toEqual([...keys].sort());
        for (const row of answer.rows!) {
          expect(row.values.indexedKey).toBe(row.indexedKey);
          expect(row.values.key).toBe(row.indexedKey.slice(0, 8));
        }
      }
      const files = await query({
        library: "personal",
        group: "fileType",
        fields: "fileType",
        limit: "all",
      });
      expect(files).toMatchObject({ ok: true, truncated: false });
      expect(files.groups!.map(({ value, count }) => [value, count])).toEqual([
        ["pdf", 11],
        ["web", 3],
      ]);
      for (const group of files.groups!)
        for (const row of group.rows)
          expect(row.values.fileType).toBe(group.value);
    });

    it("groups files by type with a per-group limit", async () => {
      const answer = await query({
        group: "contentType",
        library: "personal",
        limit: "1",
        fields: "contentType",
      });
      const files = ATTACHMENTS.filter(
        (file) =>
          file.libraryID === 1 &&
          ITEMS.some((item) => item.itemID === file.parentItemID),
      );
      const types = [...new Set(files.map((file) => file.contentType))].sort();
      expect(answer).toMatchObject({
        ok: true,
        totalCount: files.length,
        returnedCount: types.length,
        truncated: true,
      });
      expect(answer).not.toHaveProperty("rows");
      expect(
        answer.groups!.map(({ value, count, rows }) => [
          value,
          count,
          rows.length,
        ]),
      ).toEqual(
        types.map((type) => [
          type,
          files.filter((file) => file.contentType === type).length,
          1,
        ]),
      );
      for (const group of answer.groups!)
        expect(group.rows[0]!.values.contentType).toBe(group.value);
    });

    it("finds broken linked files", async () => {
      // Demo paper files are copied only to the demo Vault Case. Their linked
      // rows remain in the configured Fixture and are also missing here.
      const answer = await query({
        filter: 'linkMode == "linked_file" && !exists',
        fields: "title,path,exists,tags",
        library: "all",
        limit: "all",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 3,
        truncated: false,
        rows: [
          {
            indexedKey: "MISSLNK2",
            values: {
              title: "Missing linked PDF",
              path: join(queryFixture.linkedFilesDir, "missing-linked.pdf"),
              exists: false,
              tags: ["repair-file"],
            },
          },
          { indexedKey: "DMRGRPDF", values: { exists: false } },
          { indexedKey: "DMIANPDF", values: { exists: false } },
        ],
      });
    });
    it("lists files of one paper", async () => {
      const paper = ITEMS.find((item) => item.itemID === 46)!;
      const answer = await query({
        filter: `item.citationKey == ${JSON.stringify(paper.citationKey)}`,
        fields: "title,contentType,path",
        limit: "all",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 1,
        truncated: false,
        rows: [
          {
            indexedKey: "RGRPDF24",
            itemIndexedKey: paper.key,
            values: {
              title: "Rougier et al. 2014 PDF",
              contentType: "application/pdf",
              path: join(queryVaultPath, "attachments", "rougier-2014.pdf"),
            },
          },
        ],
      });
      for (const filter of [
        'indexedKey == "RGRPDF24"',
        '["RGRPDF24"].contains(indexedKey)',
        `item.indexedKey == ${JSON.stringify(paper.key)}`,
        `[${JSON.stringify(paper.key)}].contains(item.indexedKey)`,
      ]) {
        const selected = await query({
          filter,
          fields: "title,contentType,path",
          limit: "all",
        });
        expect(selected).toMatchObject({
          ok: true,
          rows: answer.rows,
          warnings: [],
        });
      }
      const outsideKey = `RGRPDF24g${LIBRARIES.find((library) => library.groupID !== null)!.groupID}`;
      const scoped = await query({
        library: "personal",
        filter: `indexedKey == "${outsideKey}" || indexedKey == "RGRPDF24"`,
        fields: "title,contentType,path",
      });
      expect(scoped).toMatchObject({
        ok: true,
        libraries: [{ type: "personal" }],
        rows: answer.rows,
        warnings: [{ code: "key-outside-target-libraries", found: outsideKey }],
      });
      const schema = JSON.parse(
        await cliCommand(queryVaultId, "zotlit:query-schema", {
          args: { from: "attachments" },
        }),
      );
      expect(Object.keys(schema.datasets)).toEqual(["attachments"]);
      expect(schema.defaults.attachments.fields).toEqual([
        "title",
        "contentType",
        "linkMode",
        "path",
        "exists",
        "item.title",
        "item.citationKey",
      ]);
    });
    it("projects Library selectors and parent citation keys across all Libraries", async () => {
      const answer = await query({
        library: "all",
        fields: "title,library,item.citationKey",
        limit: "all",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 14,
        truncated: false,
      });
      expect(answer.libraries).toHaveLength(LIBRARIES.length);
      // The three image Attachments of a Note are outside the Query Dataset.
      const attachedToItems = ATTACHMENTS.filter((attachment) =>
        ITEMS.some((item) => item.itemID === attachment.parentItemID),
      );
      expect(answer.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
        attachedToItems.map((attachment) => attachment.key).toSorted(),
      );
      for (const attachment of attachedToItems) {
        const library = LIBRARIES.find(
          (library) => library.libraryID === attachment.libraryID,
        )!;
        const parent = ITEMS.find(
          (item) => item.itemID === attachment.parentItemID,
        )!;
        const key =
          library.groupID === null
            ? attachment.key
            : `${attachment.key}g${library.groupID}`;
        expect(
          answer.rows!.find((row) => row.indexedKey === key)?.values,
        ).toEqual({
          title: attachment.title,
          library:
            library.groupID === null ? "personal" : `group:${library.groupID}`,
          "item.citationKey": parent.citationKey,
        });
      }
    });
  });

  describe("ZotLit Query Relation Lists", () => {
    const queryFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-relation-query-fixture"),
    );
    const queryVaultPath = e2eVaultDir(workspaceRoot, "relation-query-vault");
    const queryVaultScript = vaultScript(workspaceRoot, queryFixture.root);
    let queryVaultId: string;
    beforeAll(async () => {
      await clearVault(queryVaultScript, queryVaultPath);
      const created = await queryVaultScript(["create", queryVaultPath]);
      queryVaultId = created.stdout.trim().split("\n")[0]!.trim();
      await prepareRunWindow(queryVaultId);
    });
    afterAll(async () => {
      await queryVaultScript(["remove", queryVaultPath, "--purge"]);
      await discardFixture(queryFixture);
    });
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(queryVaultId, "zotlit:query", {
          args: { library: "personal", limit: "all", sort: "[]", ...args },
        }),
      ) as ItemQueryReport;
    const papers = '["PREPRNT2", "RUGIER24", "SAKIMA22"].contains(key)';

    it("finds relation candidates through each existence form and nested marks", async () => {
      for (const filter of [
        'annotations.filter(value.tags.contains("methodology")).length > 0',
        'annotations.filter(value.tags.contains("methodology")).length >= 1',
        '!annotations.filter(value.tags.contains("methodology")).isEmpty()',
        'attachments.filter(value.annotations.filter(value.tags.contains("methodology")).length > 0).length > 0',
      ]) {
        const answer = await query({ filter, fields: "title" });
        expect(answer.ok).toBe(true);
        expect(answer.rows!.map((row) => row.indexedKey)).toEqual(["RUGIER24"]);
      }
      const files = await query({
        from: "attachments",
        filter:
          'annotations.filter(value.tags.contains("methodology")).length > 0',
        fields: "title",
      });
      expect(files.ok).toBe(true);
      expect(files.rows!.map((row) => row.indexedKey)).toEqual(["RGRPDF24"]);
    });
    it("lists the Child Notes of each paper across the Fixture Libraries", async () => {
      const answer = await query({
        library: "all",
        filter: "!notes.isEmpty()",
        fields: "notes[].title",
        sort: "indexedKey",
      });
      expect(answer.ok).toBe(true);
      expect(
        answer.rows!.map((row) => [
          row.indexedKey,
          row.values["notes[].title"],
        ]),
      ).toEqual([
        ["AAAAAAAA", ["Reading notes on the personal alpha"]],
        ["AAAAAAAAg4200309", ["Reading notes on the shared alpha"]],
        ["EEEE5555", ["Reading notes on the unkeyed personal item"]],
        ["HHHH8888g118", ["Reading notes on the lab archive alpha"]],
        ["IIII9999g990117", ["Reading notes on the consortium alpha"]],
        ["PREPRNT2", ["Reading notes on the preprint"]],
      ]);
      const paper = await query({
        filter: 'key == "AAAAAAAA"',
        fields: "notes",
      });
      expect(paper).toMatchObject({
        ok: true,
        rows: [
          {
            indexedKey: "AAAAAAAA",
            values: {
              notes: [
                {
                  indexedKey: "NNNNAAAA",
                  title: "Reading notes on the personal alpha",
                },
              ],
            },
          },
        ],
      });
    });
    it("finds papers with no usable PDF on this machine", async () => {
      const answer = await query({
        filter: `(${papers} || ["AAAAAAAA", "DMRGRART"].contains(key)) && attachments.filter(value.contentType == "application/pdf" && value.exists).isEmpty()`,
        fields: "title",
      });
      expect(answer.ok).toBe(true);
      expect(answer.rows!.map((row) => row.indexedKey)).toEqual([
        "AAAAAAAA",
        "DMRGRART",
      ]);
    });
    it("finds papers in a Collection with no highlight yet", async () => {
      const answer = await query({
        filter: `${papers} && collections.contains("Shared key") && annotations.filter(value.type == "highlight").isEmpty()`,
        fields: "title",
      });
      expect(answer.ok).toBe(true);
      expect(answer.rows!.map((row) => row.indexedKey)).toEqual(["PREPRNT2"]);
    });
    it("finds papers with more than one PDF", async () => {
      const answer = await query({
        filter: `${papers} && attachments.filter(value.contentType == "application/pdf").length > 1`,
        fields: "title",
      });
      expect(answer.ok).toBe(true);
      expect(answer.rows!.map((row) => row.indexedKey)).toEqual([
        "PREPRNT2",
        "SAKIMA22",
      ]);
    });
    it("lists each file path with nulls in their source positions", async () => {
      const answer = await query({
        filter: 'key == "SAKIMA22"',
        fields: "attachments[].path",
      });
      expect(answer).toMatchObject({
        ok: true,
        returnedCount: 1,
        rows: [
          {
            indexedKey: "SAKIMA22",
            values: {
              "attachments[].path": [
                null,
                join(
                  queryFixture.dataDir,
                  "storage",
                  "HTMLSNAP",
                  "sakimas-song.html",
                ),
                null,
                join(
                  queryFixture.dataDir,
                  "storage",
                  "MISSNG22",
                  "deliberately-missing.pdf",
                ),
                join(queryFixture.linkedFilesDir, "sakimas-song.pdf"),
                join(
                  queryFixture.dataDir,
                  "storage",
                  "PDFSTR22",
                  "sakimas-song.pdf",
                ),
              ],
            },
          },
        ],
      });
    });
    it("reports the number of marks for each paper and file", async () => {
      const answer = await query({
        filter: papers,
        fields: "annotations.length",
      });
      expect(answer.ok).toBe(true);
      expect(
        answer.rows!.map((row) => [
          row.indexedKey,
          row.values["annotations.length"],
        ]),
      ).toEqual([
        ["PREPRNT2", 0],
        ["RUGIER24", attachmentAnnotations.length],
        ["SAKIMA22", 4],
      ]);
      const file = await query({
        from: "attachments",
        filter: 'key == "RGRPDF24"',
        fields: "annotations.length",
      });
      expect(file).toMatchObject({
        ok: true,
        rows: [
          {
            indexedKey: "RGRPDF24",
            values: { "annotations.length": attachmentAnnotations.length },
          },
        ],
      });
    });
  });
});
