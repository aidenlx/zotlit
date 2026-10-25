import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  COLLECTIONS,
  ITEMS,
  LIBRARIES,
  discardFixture,
  getFixtureLayout,
} from "@zotlit/scripts/fixture";
import type { FixtureItem } from "@zotlit/scripts/fixture";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable } from "./e2e-run-fixture.ts";
import {
  BYTE_ORDER_MARK,
  annotationItem,
  attachmentAnnotations,
  e2eFixture,
  positionDocumentItem,
  targetItem,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import {
  SEGMENTER_CACHE_DIR,
  SYNTHETIC_CORPUS_SIZE,
  SYNTHETIC_MARKER,
  addMyLibraryItems,
  clickModalButton,
  recordFrames,
  rendererHeap,
  signalDatabaseUpdated,
  syntheticTitles,
} from "./e2e-run-note-helpers.ts";
import {
  expectQueryDiagnostic,
  itemsByModified,
} from "./e2e-run-query-types.ts";
import type {
  ItemQueryReport,
  ItemQuerySchemaReport,
  LibraryScopeReport,
} from "./e2e-run-query-types.ts";
import {
  cli,
  cliCommand,
  obEval,
  obEvalUntil,
  obJson,
  waitFor,
} from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";
import { clearVault, e2eVaultDir, vaultScript } from "./vault-script.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  it("projects aligned Relation Lists with [] through zotlit:query", async () => {
    const query = async (fields: string[]) =>
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { fields: fields.join(","), limit: "all" },
        }),
      ) as ItemQueryReport;
    const source = await query(["citationKey", "creators", "tags"]);
    const projected = await query([
      "citationKey",
      "creators[].fullName",
      "tags[].name",
    ]);
    expect(source.ok).toBe(true);
    expect(projected.ok).toBe(true);
    expect(projected.rows!.length).toBeGreaterThan(0);
    expect(projected.rows!.map((row) => row.indexedKey)).toEqual(
      source.rows!.map((row) => row.indexedKey),
    );
    expect(
      source.rows!.some((row) => (row.values.creators as unknown[]).length > 1),
    ).toBe(true);
    expect(
      source.rows!.some((row) => (row.values.tags as unknown[]).length > 0),
    ).toBe(true);
    for (const [index, row] of projected.rows!.entries()) {
      const values = source.rows![index]!.values;
      expect(row.values).toEqual({
        citationKey: values.citationKey,
        "creators[].fullName": (
          values.creators as { fullName: string | null }[]
        ).map((creator) => creator.fullName),
        "tags[].name": (values.tags as { name: string | null }[]).map(
          (tag) => tag.name,
        ),
      });
    }
  });

  it("projects library selectors through zotlit:query across the Fixture Libraries", async () => {
    const answer = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: { library: "all", fields: "citationKey,library" },
      }),
    ) as ItemQueryReport;
    expect(answer.ok).toBe(true);
    expect(answer.returnedCount).toBe(ITEMS.length);
    expect(answer.truncated).toBe(false);
    expect(new Set(answer.rows!.map((row) => row.values.library))).toEqual(
      new Set(
        LIBRARIES.map(({ groupID }) =>
          groupID === null ? "personal" : `group:${groupID}`,
        ),
      ),
    );
    for (const library of LIBRARIES) {
      for (const item of ITEMS.filter(
        (item) => item.libraryID === library.libraryID,
      )) {
        const indexedKey =
          library.groupID === null
            ? item.key
            : `${item.key}g${library.groupID}`;
        expect(
          answer.rows!.find((row) => row.indexedKey === indexedKey)?.values,
        ).toEqual({
          citationKey: item.citationKey,
          library:
            library.groupID === null ? "personal" : `group:${library.groupID}`,
        });
      }
    }
  });

  it("reads the Diagnostic Report of a failed zotlit:template-check", async () => {
    const answer = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:template-check", {
        args: { mode: "sideways" },
      }),
    ) as {
      contractVersion: number;
      ok: boolean;
      diagnostic: {
        code: string;
        message: string;
        hint: string;
        report: string[];
      };
    };
    expect(answer.contractVersion).toBe(8);
    expect(answer.ok).toBe(false);
    expect(answer.diagnostic.code).toBe("INVALID_SELECTOR");
    expect(answer.diagnostic.report[0]).toBe(answer.diagnostic.message);
    expect(answer.diagnostic.report.at(-1)).toBe(answer.diagnostic.hint);
  });

  it("answers zotlit:query over the Library Scope and over named Libraries with the Fixture's Indexed Keys", async () => {
    const [myLibrary, sharedReading] = LIBRARIES;
    const wireOf = (library: (typeof LIBRARIES)[number]) =>
      library.groupID === null
        ? { type: "personal" }
        : { type: "group", groupID: library.groupID, name: library.name };
    const selectorOf = (library: (typeof LIBRARIES)[number]) =>
      library.groupID === null ? "personal" : `group:${library.groupID}`;

    // Dispatched as a registered CLI command with arguments, the way an agent
    // calls it. Without a Library argument, the query reads the available
    // Libraries of the Library Scope, which `zotlit:library-scope` reports.
    const scope = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:library-scope"),
    ) as LibraryScopeReport;
    const inScope = (scope.available ?? []).map((entry) =>
      LIBRARIES.find((library) => library.libraryID === entry.libraryID)!,
    );
    expect(inScope.length).toBeGreaterThan(1);

    const limited = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          fields: "[]",
          limit: "3",
        },
      }),
    ) as ItemQueryReport;

    expect(limited).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: true,
      libraries: inScope.map(wireOf),
      request: {
        from: "items",
        library: inScope.map(selectorOf),
        fields: [],
        limit: 3,
      },
      returnedCount: 3,
      truncated: true,
    });
    expect(limited.rows!.map((row) => row.indexedKey)).toEqual(
      itemsByModified(inScope).slice(0, 3),
    );

    // A named range, in another order than the canonical one.
    const range = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          library: [selectorOf(sharedReading!), selectorOf(myLibrary!)].join(
            ",",
          ),
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;

    expect(range).toMatchObject({
      ok: true,
      libraries: [wireOf(myLibrary!), wireOf(sharedReading!)],
      request: {
        library: [selectorOf(myLibrary!), selectorOf(sharedReading!)],
        limit: null,
      },
      truncated: false,
    });
    expect(range.rows!.map((row) => row.indexedKey)).toEqual(
      itemsByModified([myLibrary!, sharedReading!]),
    );

    const group = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          library: selectorOf(sharedReading!),
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;

    expect(group).toMatchObject({
      ok: true,
      libraries: [wireOf(sharedReading!)],
      request: { library: [selectorOf(sharedReading!)], limit: null },
      truncated: false,
    });
    expect(group.rows!.map((row) => row.indexedKey)).toEqual(
      itemsByModified([sharedReading!]),
    );

    // The Bases helpers through the shipped plugin: a regular expression and
    // an element expression over the Creators, each against My Library.
    const personalKeys = (
      predicate: (item: (typeof ITEMS)[number]) => boolean,
    ) => {
      const keys = new Set(
        ITEMS.filter(
          (item) => item.libraryID === myLibrary!.libraryID && predicate(item),
        ).map((item) => item.key),
      );
      return itemsByModified([myLibrary!]).filter((key) => keys.has(key));
    };
    const fullName = (creator: (typeof ITEMS)[number]["creators"][number]) =>
      creator.fieldMode === 1
        ? creator.lastName
        : `${creator.firstName} ${creator.lastName}`.trim();
    for (const [filter, predicate] of [
      [
        "/duplicate/i.matches(title)",
        (item: (typeof ITEMS)[number]) => /duplicate/i.test(item.title),
      ],
      [
        'creators.filter(index > 0).map(value.split(" ")[0]).contains("Michael")',
        (item: (typeof ITEMS)[number]) =>
          item.creators
            .slice(1)
            .some((creator) => fullName(creator).split(" ")[0] === "Michael"),
      ],
    ] as const) {
      const expected = personalKeys(predicate);
      expect(expected.length).toBeGreaterThan(1);
      const helpers = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: {
            library: selectorOf(myLibrary!),
            filter,
            fields: "[]",
            limit: "all",
          },
        }),
      ) as ItemQueryReport;
      expect(helpers).toMatchObject({
        ok: true,
        returnedCount: expected.length,
        truncated: false,
      });
      expect(helpers.rows!.map((row) => row.indexedKey)).toEqual(expected);
    }

    // The production command exports the same response and keeps an existing file.
    const exportPath = join(e2eFixture.root, "query-export.json");
    await using exportCleanup = new AsyncDisposableStack();
    exportCleanup.defer(() => rm(exportPath, { force: true }));
    const exportArgs = {
      library: selectorOf(sharedReading!),
      fields: "[]",
      limit: "all",
      output: exportPath,
    };
    const receipt = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", { args: exportArgs }),
    );
    const exportedText = await readFile(exportPath, "utf8");
    expect(receipt).toMatchObject({
      ok: true,
      returnedCount: group.returnedCount,
      file: {
        path: exportPath,
        bytes: Buffer.byteLength(exportedText),
        format: "json",
      },
    });
    expect(receipt).not.toHaveProperty("rows");
    expect(JSON.parse(exportedText)).toEqual(group);
    const repeated = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", { args: exportArgs }),
    );
    expect(repeated).toMatchObject({
      ok: false,
      diagnostic: { code: "output-error" },
    });
    expect(await readFile(exportPath, "utf8")).toBe(exportedText);

    // A held Snapshot leaves new queries free to read a changed source. The
    // new copy carries a numeric field beyond JavaScript's exact integer range.
    const otherDir = join(e2eFixture.root, "query-other-source");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => rm(otherDir, { recursive: true, force: true }));
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async()=>{
        const state=window.__zotlitQuerySource;
        if(!state)return true;
        const services=app.plugins.plugins.zotlit.services;
        services.zoteroPref.setDataDir(state.previous);
        await state.lease?.[Symbol.asyncDispose]();
        delete window.__zotlitQuerySource;
        await services.zoteroReads.refresh();
        return true;
      })()`,
      );
    });
    await mkdir(otherDir, { recursive: true });
    const otherPath = join(otherDir, "zotero.sqlite");
    await copyFile(limited.identity!.source.databasePath, otherPath);
    {
      using sqlite = new DatabaseSync(otherPath);
      sqlite.exec(`
        insert into itemDataValues (value) values (9007199254740993);
        insert or replace into itemData (itemID, fieldID, valueID)
          select ${targetItem.itemID}, fieldID, last_insert_rowid()
          from fieldsCombined where fieldName = 'volume' and custom = 0;
      `);
    }
    await obEval(
      run.vaultId,
      `(async()=>{
      const services=app.plugins.plugins.zotlit.services;
      const lease=await services.zoteroReads.acquireRead();
      window.__zotlitQuerySource={lease,previous:services.zoteroPref.dataDirOverride};
      services.zoteroPref.setDataDir(${JSON.stringify(otherDir)});
      await services.zoteroReads.refresh();
      return true;
    })()`,
    );
    const integerQuery = {
      library: "personal",
      filter: 'volume == "9007199254740993"',
      fields: "volume",
    };
    for (const filter of [
      integerQuery.filter,
      'volume.lower() == "9007199254740993"',
    ]) {
      const changed = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { ...integerQuery, filter },
        }),
      ) as ItemQueryReport;
      expect(changed).toMatchObject({
        ok: true,
        identity: { source: { databasePath: otherPath } },
        rows: [
          {
            indexedKey: targetItem.key,
            values: { volume: "9007199254740993" },
          },
        ],
      });
    }
  });

  it("binds this to an Item and an Attachment through zotlit:query", async () => {
    const parents = ATTACHMENTS.filter(
      (attachment) => attachment.parentItemID === annotationItem.itemID,
    );
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { fields: "[]", limit: "all", library: "personal", ...args },
        }),
      ) as ItemQueryReport;
    const keysOf = (report: ItemQueryReport) =>
      report.rows!.map((row) => row.indexedKey).toSorted();

    const marks = await query({
      from: "annotations",
      filter: "item == this.item",
      "this-item": annotationItem.key,
    });
    expect(marks).toMatchObject({
      ok: true,
      request: { context: { item: annotationItem.key } },
      warnings: [],
    });
    expect(keysOf(marks)).toEqual(
      ANNOTATIONS.filter((annotation) =>
        parents.some((parent) => parent.itemID === annotation.parentItemID),
      )
        .map((annotation) => annotation.key)
        .toSorted(),
    );

    const attachment = parents[0]!;
    const attachmentMarks = await query({
      from: "annotations",
      filter: "attachment == this.attachment",
      "this-attachment": attachment.key,
    });
    expect(keysOf(attachmentMarks)).toEqual(
      ANNOTATIONS.filter(
        (annotation) => annotation.parentItemID === attachment.itemID,
      )
        .map((annotation) => annotation.key)
        .toSorted(),
    );

    const files = await query({
      from: "attachments",
      filter: "item == this.item",
      "this-item": annotationItem.key,
    });
    expect(keysOf(files)).toEqual(
      parents.map((parent) => parent.key).toSorted(),
    );

    const item = await query({
      filter: "indexedKey == this.item.indexedKey",
      "this-item": annotationItem.key,
    });
    expect(keysOf(item)).toEqual([annotationItem.key]);

    const unbound = await query({
      from: "annotations",
      filter: "item == this.item",
    });
    expect(unbound).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unbound-context",
        location: { argument: "filter", span: { from: 8, to: 17 } },
      },
    });
  });

  it("groups marks per paper through zotlit:query", async () => {
    const report = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          from: "annotations",
          group: "item.citationKey",
          limit: "3",
          sort: "-dateModified",
          library: "personal",
          filter: `item.indexedKey == "${annotationItem.key}"`,
          fields: "dateModified,item.citationKey",
        },
      }),
    ) as ItemQueryReport;
    const parents = ATTACHMENTS.filter(
      (attachment) => attachment.parentItemID === annotationItem.itemID,
    );
    const marks = ANNOTATIONS.filter((annotation) =>
      parents.some((parent) => parent.itemID === annotation.parentItemID),
    );
    expect(marks.length).toBeGreaterThan(3);
    expect(report).toMatchObject({
      ok: true,
      request: { group: "item.citationKey" },
      totalCount: marks.length,
      returnedCount: 3,
      truncated: true,
      groups: [{ value: annotationItem.citationKey, count: marks.length }],
    });
    expect(report).not.toHaveProperty("rows");
    expect(report.groups![0]!.rows.map((row) => row.indexedKey)).toEqual(
      marks
        .toSorted(
          (a, b) =>
            b.dateModified.localeCompare(a.dateModified) ||
            a.sortIndex.localeCompare(b.sortIndex) ||
            a.key.localeCompare(b.key),
        )
        .slice(0, 3)
        .map((mark) => mark.key),
    );
  });

  it("groups papers per year through zotlit:query", async () => {
    const report = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          group: "date.year",
          limit: "1",
          library: "personal",
          fields: "title,date.year",
        },
      }),
    ) as ItemQueryReport;
    const papers = ITEMS.filter((item) => item.libraryID === 1);
    const years = [
      ...new Set(papers.map((item) => Number(item.date.slice(0, 4)))),
    ].sort((a, b) => a - b);
    expect(report).toMatchObject({
      ok: true,
      request: { group: "date.year" },
      totalCount: papers.length,
      returnedCount: years.length,
      truncated: true,
    });
    expect(report).not.toHaveProperty("rows");
    expect(
      report.groups!.map(({ value, count, rows }) => [
        value,
        count,
        rows.length,
      ]),
    ).toEqual(
      years.map((year) => [
        year,
        papers.filter((paper) => Number(paper.date.slice(0, 4)) === year)
          .length,
        1,
      ]),
    );
    for (const group of report.groups!)
      expect(group.rows[0]!.values["date.year"]).toBe(group.value);
    const split = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: { group: "library", library: "all", limit: "3" },
      }),
    ) as ItemQueryReport;
    expect(split).toMatchObject({ ok: true, totalCount: ITEMS.length });
    expect(split.groups).toHaveLength(LIBRARIES.length);
  });

  it("exports papers per year as CSV and every paper as TSV through zotlit:query", async () => {
    const args = {
      group: "date.year",
      limit: "1",
      library: "personal",
      fields: "title,date.year",
    };
    const report = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", { args }),
    ) as ItemQueryReport;
    expect(report.groups!.length).toBeGreaterThan(1);
    const quote = (text: string, separator: string) =>
      text.includes(separator) || /["\n]/.test(text)
        ? `"${text.replaceAll('"', '""')}"`
        : text;
    // Each cell here is a scalar: a title, a year, or an Indexed Key.
    const line = (cells: unknown[], separator: string) =>
      cells
        .map((value) =>
          quote(
            value == null
              ? ""
              : typeof value === "string"
                ? value
                : JSON.stringify(value),
            separator,
          ),
        )
        .join(separator);
    const csvPath = join(e2eFixture.root, "query-per-year.csv");
    const tsvPath = join(e2eFixture.root, "query-papers.tsv");
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => rm(csvPath, { force: true }));
    cleanup.defer(() => rm(tsvPath, { force: true }));

    // A grouped CSV export: the group value first, a byte order mark, CRLF.
    const receipt = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: { ...args, format: "csv", output: csvPath },
      }),
    );
    const csv = await readFile(csvPath);
    expect(receipt).toMatchObject({
      ok: true,
      returnedCount: report.returnedCount,
      file: { path: csvPath, bytes: csv.byteLength, format: "csv" },
    });
    expect(receipt).not.toHaveProperty("groups");
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(csv)).toBe(
      BYTE_ORDER_MARK +
        [
          "group,indexedKey,title,date.year",
          ...report.groups!.flatMap((group) =>
            group.rows.map((row) =>
              line(
                [
                  group.value,
                  row.indexedKey,
                  row.values.title,
                  row.values["date.year"],
                ],
                ",",
              ),
            ),
          ),
        ]
          .map((text) => `${text}\r\n`)
          .join(""),
    );

    // A TSV export of every paper: no byte order mark, LF.
    const papers = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: { library: "personal", fields: "title", limit: "all" },
      }),
    ) as ItemQueryReport;
    await cliCommand(run.vaultId, "zotlit:query", {
      args: {
        library: "personal",
        fields: "title",
        limit: "all",
        format: "tsv",
        output: tsvPath,
      },
    });
    expect(await readFile(tsvPath, "utf8")).toBe(
      [
        "indexedKey\ttitle",
        ...papers.rows!.map((row) =>
          line([row.indexedKey, row.values.title], "\t"),
        ),
      ]
        .map((text) => `${text}\n`)
        .join(""),
    );

    // The answer itself is JSON: CSV without a file is refused.
    expect(
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { ...args, format: "csv" },
        }),
      ),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        details: { parameter: "format" },
      },
    });
  });

  it("computes Formulas on a Fixture Item through ZotLit Query", async () => {
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { library: "personal", ...args },
        }),
      ) as ItemQueryReport;

    const computed = await query({
      filter: `indexedKey == "${annotationItem.key}"`,
      formulas: JSON.stringify({
        next: "date.year + 1",
        lower: "title.lower()",
        unused: "title",
      }),
      fields: "title,formula.next,formula.lower",
    });
    expect(computed).toMatchObject({
      ok: true,
      request: {
        formulas: {
          next: "date.year + 1",
          lower: "title.lower()",
          unused: "title",
        },
        fields: ["title", "formula.next", "formula.lower"],
      },
      warnings: [
        {
          code: "unused-formula",
          severity: "warning",
          location: { argument: "formulas", path: "unused" },
        },
      ],
      rows: [
        {
          indexedKey: annotationItem.key,
          values: {
            title: annotationItem.title,
            "formula.next": Number(annotationItem.date.slice(0, 4)) + 1,
            "formula.lower": annotationItem.title.toLowerCase(),
          },
        },
      ],
    });

    // A value that the Item cannot compute is an Error Value cell; a filter
    // that meets one excludes the Item.
    const failed = await query({
      filter: `indexedKey == "${annotationItem.key}"`,
      formulas: JSON.stringify({ volumes: "number(title)" }),
      fields: "formula.volumes",
    });
    expect(failed).toMatchObject({
      ok: true,
      rows: [
        {
          indexedKey: annotationItem.key,
          values: {
            "formula.volumes": {
              kind: "error",
              code: "unparseable-text",
              message: `number() cannot read ${JSON.stringify(annotationItem.title)} as a number.`,
            },
          },
        },
      ],
    });
    const excluded = await query({
      filter: `indexedKey == "${annotationItem.key}" && number(title) > 0`,
    });
    expect(excluded).toMatchObject({ ok: true, rows: [] });

    const arithmetic = await query({
      formulas: JSON.stringify({ twice: "title * 2" }),
      fields: "formula.twice",
    });
    expect(arithmetic).toMatchObject({
      ok: false,
      diagnostic: {
        code: "wrong-operand-type",
        location: { argument: "formulas", path: "twice" },
      },
    });

    const wrong = await query({
      formulas: JSON.stringify({ short: "title.nope()" }),
      fields: "formula.short",
    });
    expect(wrong).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unknown-function",
        location: { argument: "formulas", path: "short" },
      },
    });
    expect(wrong.diagnostic!.report.join("\n")).toContain("formula.short");

    const undefinedFormula = await query({ fields: "formula.year" });
    expect(undefinedFormula).toMatchObject({
      ok: false,
      diagnostic: {
        code: "unknown-formula",
        location: { argument: "fields", index: 0 },
      },
    });
  });

  it("filters by a Formula and reads a dependent Formula through ZotLit Query", async () => {
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { library: "personal", ...args },
        }),
      ) as ItemQueryReport;
    const yearOf = (item: FixtureItem) => Number(item.date.slice(0, 4));
    const recent = ITEMS.filter(
      (item) => item.libraryID === 1 && yearOf(item) >= 2020,
    );
    expect(recent.length).toBeGreaterThan(1);

    const report = await query({
      formulas: JSON.stringify({
        year: "date.year",
        next: "formula.year + 1",
      }),
      filter: "formula.year >= 2020",
      fields: "formula.next",
      limit: "100",
    });
    expect(report).toMatchObject({ ok: true, warnings: [] });
    expect(report.rows).toHaveLength(recent.length);
    expect(report.rows).toEqual(
      expect.arrayContaining(
        recent.map((item) => ({
          indexedKey: item.key,
          values: { "formula.next": yearOf(item) + 1 },
        })),
      ),
    );

    const cycle = await query({
      formulas: JSON.stringify({ a: "formula.b + 1", b: "formula.a" }),
      fields: "formula.a",
    });
    expect(cycle).toMatchObject({
      ok: false,
      diagnostic: {
        code: "formula-cycle",
        location: { argument: "formulas", path: "b" },
      },
    });
    expect(cycle.diagnostic!.report.join("\n")).toContain(
      "formula.a → formula.b → formula.a",
    );
  });

  it("groups papers per tag and per Collection through zotlit:query", async () => {
    const papers = ITEMS.filter((item) => item.libraryID === 1);
    /** Each group value with the keys of its papers, from the Fixture Spec. */
    const expectedGroups = (values: (paper: FixtureItem) => string[]) => {
      const groups = new Map<string | null, string[]>();
      for (const paper of papers) {
        const distinct = [...new Set(values(paper))];
        for (const value of distinct.length ? distinct : [null])
          groups.set(value, [...(groups.get(value) ?? []), paper.key]);
      }
      return groups;
    };
    const groupsOf = (report: ItemQueryReport) =>
      new Map(
        report.groups!.map(({ value, count, rows }) => [
          value,
          { count, keys: rows.map((row) => row.indexedKey).toSorted() },
        ]),
      );
    const query = async (args: Record<string, string>) =>
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { library: "personal", limit: "all", fields: "[]", ...args },
        }),
      ) as ItemQueryReport;

    const byTag = await query({ group: "tags[].name" });
    const tags = expectedGroups((paper) =>
      (paper.tags ?? []).map((tag) => tag.name),
    );
    expect(tags.size).toBeGreaterThan(2);
    expect(byTag).toMatchObject({
      ok: true,
      request: { group: "tags[].name" },
      totalCount: papers.length,
      truncated: false,
    });
    expect(groupsOf(byTag)).toEqual(
      new Map(
        [...tags].map(([value, keys]) => [
          value,
          { count: keys.length, keys: keys.toSorted() },
        ]),
      ),
    );
    expect(byTag.groups!.at(-1)!.value).toBeNull();
    // A paper with two Tags is in two groups, so the counts add up to more.
    expect(byTag.returnedCount).toBe(
      [...tags.values()].reduce((sum, keys) => sum + keys.length, 0),
    );
    expect(byTag.returnedCount).toBeGreaterThan(papers.length);

    const pathOf = (collectionID: number): string => {
      const collection = COLLECTIONS.find(
        (entry) => entry.collectionID === collectionID,
      )!;
      return collection.parentCollectionID === undefined
        ? collection.name
        : `${pathOf(collection.parentCollectionID)}/${collection.name}`;
    };
    const parent = COLLECTIONS.find(({ key }) => key === "PERSNAL2")!;
    const byCollection = await query({
      group: "collections[]",
      filter: `collections.within(${JSON.stringify(parent.name)})`,
    });
    const filed = papers.filter((paper) =>
      paper.collectionIDs.some((id) => pathOf(id).startsWith(parent.name)),
    );
    const collections = expectedGroups((paper) =>
      filed.includes(paper) ? paper.collectionIDs.map(pathOf) : [],
    );
    collections.delete(null);
    expect(byCollection).toMatchObject({
      ok: true,
      request: { group: "collections[]" },
      totalCount: filed.length,
    });
    expect(groupsOf(byCollection)).toEqual(
      new Map(
        [...collections].map(([value, keys]) => [
          value,
          { count: keys.length, keys: keys.toSorted() },
        ]),
      ),
    );
    expect(collections.has(`${parent.name}/Personal child`)).toBe(true);
  });

  it("queries an Item's reading record through zotlit:query from=annotations", async () => {
    // Own the Fixture and vault so earlier cases cannot leave this query's
    // linked Attachment paths pointing at a vault they have removed.
    const queryFixture = getFixtureLayout(
      join(workspaceRoot, ".scratch", "e2e-annotation-query-fixture"),
    );
    const queryVaultPath = e2eVaultDir(workspaceRoot, "annotation-query-vault");
    const queryVaultScript = vaultScript(workspaceRoot, queryFixture.root);
    await clearVault(queryVaultScript, queryVaultPath);
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await queryVaultScript(["remove", queryVaultPath, "--purge"]);
      await discardFixture(queryFixture);
    });
    const created = await queryVaultScript(["create", queryVaultPath]);
    const queryVaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(queryVaultId);
    const report = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: `item.indexedKey == "${annotationItem.key}"`,
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(report).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      request: { from: "annotations" },
      ok: true,
      truncated: false,
    });
    const parents = ATTACHMENTS.filter(
      (attachment) => attachment.parentItemID === annotationItem.itemID,
    );
    const expected = ANNOTATIONS.filter((annotation) =>
      parents.some((parent) => parent.itemID === annotation.parentItemID),
    );
    expect(report.returnedCount).toBe(expected.length);
    expect(report.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
      expected.map((annotation) => annotation.key).toSorted(),
    );
    expect(report.rows![0]).toMatchObject({
      itemIndexedKey: annotationItem.key,
      attachmentIndexedKey: expect.any(String),
      values: {
        type: expect.any(String),
        colorName: expect.any(String),
        pageIndex: expect.any(Number),
        "item.title": annotationItem.title,
        attachment: { path: expect.any(String), exists: true },
      },
    });
    expect(report.rows![0]!.values).not.toHaveProperty("position");
    const filtered = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: `item.indexedKey == "${annotationItem.key}" && type == "image" && item.title == ${JSON.stringify(annotationItem.title)}`,
          fields: "type,item.title,item.date",
          sort: "pageIndex",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(filtered).toMatchObject({
      ok: true,
      command: "zotlit:query",
    });
    expect(filtered.rows!.map((row) => row.indexedKey).toSorted()).toEqual(
      expected
        .filter((annotation) => annotation.type === 3)
        .map((annotation) => annotation.key)
        .toSorted(),
    );
    const schema = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query-schema", {
        args: { from: "annotations" },
      }),
    ) as ItemQuerySchemaReport;
    expect(schema).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query-schema",
      ok: true,
      schema: { url: expect.stringContaining("/query.schema.json") },
      defaults: {
        annotations: {
          fields: expect.arrayContaining(["type", "item.title"]),
          limit: 100,
        },
      },
    });
    const catalog = JSON.parse(
      await readFile(
        join(workspaceRoot, "packages/item-query/dist/query.schema.json"),
        "utf8",
      ),
    ) as { datasets: { annotations: { fields: object[] } } };
    expect(catalog.datasets.annotations.fields).toContainEqual({
      path: "item.title",
      type: "string",
      filter: "string",
      projection: true,
      group: true,
      sort: true,
    });
    const invalid = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: { from: "annotations", filter: "item.title.startsWith(1)" },
      }),
    ) as ItemQueryReport;
    expect(invalid).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: false,
      diagnostic: {
        code: "wrong-argument-type",
        location: { argument: "filter", span: { from: 22, to: 23 } },
      },
    });

    const positions = JSON.parse(
      await cliCommand(queryVaultId, "zotlit:query", {
        args: {
          from: "annotations",
          filter: `${JSON.stringify([annotationItem.key, positionDocumentItem.key])}.contains(item.indexedKey)`,
          fields: "position",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(positions).toMatchObject({ ok: true, truncated: false });
    const byKey = Object.fromEntries(
      positions.rows!.map((row) => [row.indexedKey, row.values.position]),
    );
    expect(byKey).toMatchObject({
      HIGHLGHT: { kind: "pdf-rects" },
      EPUBAN22: { kind: "epub-cfi" },
      SNAPAN22: { kind: "snapshot-css" },
    });
  });

  it("runs every zotlit:query-guide example on the Fixture", async () => {
    const guide = await cliCommand(run.vaultId, "zotlit:query-guide");
    const prefix = "obsidian zotlit:query ";
    const examples = guide
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.startsWith(prefix) && !line.slice(prefix.length).startsWith("["),
      );
    expect(examples.length).toBeGreaterThan(10);
    for (const line of examples) {
      // Guide examples quote whole values with single quotes; the unit test
      // verifies that their values contain no single quote themselves.
      const tokens: string[] = [];
      let token = "";
      let quoted = false;
      for (const char of line.slice(prefix.length)) {
        if (char === "'") quoted = !quoted;
        else if (char === " " && !quoted) {
          if (token) tokens.push(token);
          token = "";
        } else token += char;
      }
      if (token) tokens.push(token);
      const result = JSON.parse(
        await cli([`vault=${run.vaultId}`, "zotlit:query", ...tokens]),
      ) as ItemQueryReport;
      expect(result, line).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: true,
        warnings: [],
      });
    }
    for (const topic of [
      "datasets",
      "filter",
      "fields",
      "sort",
      "group",
      "results",
      "schema",
      "cancel",
    ]) {
      const text = await cliCommand(run.vaultId, "zotlit:query-guide", {
        args: { topic },
      });
      expect(guide).toContain(text);
      expect(text.length).toBeLessThan(guide.length);
    }
  });

  it("describes ZotLit Query through zotlit:query-schema", async () => {
    const version = await obEval(
      run.vaultId,
      "app.plugins.plugins.zotlit.manifest.version",
    );
    const answer = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query-schema"),
    ) as ItemQuerySchemaReport;

    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query-schema",
      ok: true,
      schema: {
        url: `https://github.com/aidenlx/zotlit/releases/download/res-${version}/query.schema.json`,
        fileName: `zotlit-query-${version}.schema.json`,
      },
      defaults: {
        items: {
          fields: ["itemType", "title", "creators", "date", "dateModified"],
          sort: [{ field: "dateModified", direction: "desc" }],
          limit: 100,
          library: { source: "library-scope" },
        },
      },
    });
    expect(answer.customFields).toEqual(expect.any(Array));
    expect(Object.keys(answer.schema!)).toEqual(["url", "fileName"]);
    // Dev versions have no Resource Release; inspect the same build artifact
    // that release CI stages and verifies at the reported version-pinned URL.
    const catalog = JSON.parse(
      await readFile(
        join(workspaceRoot, "packages/item-query/dist/query.schema.json"),
        "utf8",
      ),
    ) as {
      datasets: Record<string, { fields: object[] }>;
      functions: { name: string }[];
      types: string[];
      methods: object[];
    };
    expect(catalog.datasets.items!.fields).toContainEqual({
      path: "title",
      type: "string",
      filter: "string",
      projection: true,
      group: true,
      sort: true,
    });
    for (const dataset of ["items", "attachments", "annotations"])
      for (const path of ["indexedKey", "key"])
        expect(catalog.datasets[dataset]!.fields).toContainEqual(
          expect.objectContaining({ path, projection: true, sort: true }),
        );
    expect(catalog.datasets.attachments!.fields).toContainEqual(
      expect.objectContaining({
        path: "fileType",
        projection: true,
        filter: "string",
        sort: true,
        group: true,
        valueForms: ["pdf", "epub", "web", "other"],
      }),
    );
    expect(catalog.functions.map(({ name }) => name)).toContain("today");
    expect(catalog.types).toContain("regexp");
    expect(catalog.methods).toContainEqual(
      expect.objectContaining({
        name: "filter",
        on: "list",
        scope: ["value", "index"],
      }),
    );
  });

  it("rejects unavailable datasets and the removed libraries parameter through zotlit:query", async () => {
    const unsupported = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: { from: "unknown" },
      }),
    );
    expect(unsupported).toMatchObject({
      ok: false,
      diagnostic: {
        code: "invalid-argument",
        expected: ["items", "attachments", "annotations"],
      },
    });
    const removed = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: { libraries: "all" },
      }),
    );
    expect(removed).toMatchObject({
      ok: false,
      diagnostic: { hint: expect.stringContaining("Use library=") },
    });
  });

  it("answers an invalid zotlit:query with the code, location, and hint", async () => {
    for (const [name, value] of [
      ["filter", 'title == "no such item"'],
      ["limit", "all"],
    ] as const) {
      const malformed = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { [`--${name}`]: value },
        }),
      ) as ItemQueryReport;
      expect(malformed).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          details: { parameter: `--${name}` },
        },
      });
    }
    const answer = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          filter: "title.startsWith(1)",
        },
      }),
    ) as ItemQueryReport;

    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: false,
      diagnostic: {
        code: "wrong-argument-type",
        location: { argument: "filter", span: { from: 17, to: 18 } },
        found: "a number",
        expected: ["a string"],
      },
    });
  });

  // Failure modes: CLI serialization must preserve syntax corrections, ranked
  // names, and successful warnings; report boundaries must match legacy fields.
  it("reports zotlit:query syntax, unknown names, and never-true warnings", async () => {
    const query = async (filter: string) =>
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { filter, fields: "[]", limit: "1" },
        }),
      ) as ItemQueryReport;
    for (const probe of [
      {
        filter: 'itemType == "book" AND date.year > 2010',
        code: "invalid-filter",
        at: "AND",
        suggestion: 'itemType == "book" && date.year > 2010',
      },
      {
        filter: "year > 2015",
        code: "unknown-field",
        at: "year",
        suggestion: "date.year",
      },
    ]) {
      const answer = await query(probe.filter);
      expect(answer).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: false,
      });
      expectQueryDiagnostic(answer.diagnostic, { ...probe, severity: "error" });
    }

    const probe = {
      filter: 'tags == "bulk"',
      code: "never-true",
      at: 'tags == "bulk"',
      suggestion: 'tags.contains("bulk")',
    };
    const answer = await query(probe.filter);
    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: true,
      returnedCount: 0,
      rows: [],
      truncated: false,
    });
    expect(answer.warnings).toHaveLength(1);
    expectQueryDiagnostic(answer.warnings?.[0], {
      ...probe,
      severity: "warning",
    });
    expect(Object.keys(answer).indexOf("warnings")).toBeLessThan(
      Object.keys(answer).indexOf("rows"),
    );
  });

  it("reports zotlit:query from=annotations syntax, unknown names, and never-true warnings", async () => {
    const query = async (filter: string) =>
      JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: { from: "annotations", filter, fields: "[]", limit: "1" },
        }),
      ) as ItemQueryReport;
    for (const probe of [
      {
        filter: 'type == "image" AND item.date.year > 2010',
        code: "invalid-filter",
        at: "AND",
        suggestion: 'type == "image" && item.date.year > 2010',
      },
      {
        filter: "pageLable == 1",
        code: "unknown-field",
        at: "pageLable",
        suggestion: "pageLabel",
      },
    ]) {
      const answer = await query(probe.filter);
      expect(answer).toMatchObject({
        contractVersion: 3,
        command: "zotlit:query",
        ok: false,
      });
      expectQueryDiagnostic(answer.diagnostic, { ...probe, severity: "error" });
    }

    const probe = {
      filter: 'tags == "bulk"',
      code: "never-true",
      at: 'tags == "bulk"',
      suggestion: 'tags.contains("bulk")',
    };
    const answer = await query(probe.filter);
    expect(answer).toMatchObject({
      contractVersion: 3,
      command: "zotlit:query",
      ok: true,
      returnedCount: 0,
      rows: [],
      truncated: false,
    });
    expect(answer.warnings).toHaveLength(1);
    expectQueryDiagnostic(answer.warnings?.[0], {
      ...probe,
      severity: "warning",
    });
    expect(Object.keys(answer).indexOf("warnings")).toBeLessThan(
      Object.keys(answer).indexOf("rows"),
    );
  });

  it("rejects retired ZotLit Query selectors with filter guidance", async () => {
    for (const parameter of ["item", "attachment"]) {
      const result = JSON.parse(
        await cliCommand(run.vaultId, "zotlit:query", {
          args: {
            from: "annotations",
            [parameter]: "QANITM22",
            library: "personal",
          },
        }),
      ) as ItemQueryReport;
      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: "invalid-argument",
          location: { argument: parameter },
          hint: `Use filter='${parameter}.indexedKey == "<key>"' to select by Indexed Key.`,
        },
      });
      expect(result.diagnostic!.report.at(-1)).toBe(result.diagnostic!.hint);
    }
  });

  it("discovers Collection paths with zotlit:query-values and warns about unknown paths", async () => {
    const listing = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query-values", {
        args: { kind: "collections", library: "personal", limit: "all" },
      }),
    ) as {
      ok: boolean;
      contractVersion: number;
      values: { library: string; values: string[]; truncated: boolean }[];
    };
    expect(listing).toMatchObject({
      ok: true,
      contractVersion: 3,
      values: [{ library: "personal", truncated: false }],
    });
    const collection = COLLECTIONS.find(({ key }) => key === "PERSCHLD")!;
    const parent = COLLECTIONS.find(
      ({ collectionID }) => collectionID === collection.parentCollectionID,
    )!;
    const path = listing.values[0]!.values.find(
      (value) => value === `${parent.name}/${collection.name}`,
    );
    expect(path).toBeDefined();
    const found = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          library: "personal",
          filter: `collections.within(${JSON.stringify(path)})`,
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(found.ok).toBe(true);
    expect(found.returnedCount).toBeGreaterThan(0);
    expect(found.warnings).toEqual([]);
    const wrong = path!.toUpperCase();
    expect(wrong).not.toBe(path);
    const unknown = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          library: "personal",
          filter: `collections.within(${JSON.stringify(wrong)})`,
          fields: "[]",
        },
      }),
    ) as ItemQueryReport;
    expect(unknown).toMatchObject({
      ok: true,
      rows: [],
      warnings: [
        { code: "unknown-collection", severity: "warning", found: wrong },
      ],
    });
    expect(unknown.warnings![0]!.suggestions[0]).toBe(path);
    expect(unknown.warnings![0]!.hint).toContain(
      "zotlit:query-values kind=collections",
    );
  });

  it("warns for a ZotLit Query Indexed Key outside the Target Libraries", async () => {
    const groupLibrary = LIBRARIES.find((library) => library.groupID !== null)!;
    const groupItem = ITEMS.find(
      (item) => item.libraryID === groupLibrary.libraryID,
    )!;
    const indexedKey = `${groupItem.key}g${groupLibrary.groupID}`;
    const result = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          library: "personal",
          filter: `indexedKey == "${indexedKey}"`,
          fields: "[]",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;
    expect(result).toMatchObject({
      ok: true,
      rows: [],
      returnedCount: 0,
      truncated: false,
      libraries: [{ type: "personal" }],
      request: { library: ["personal"] },
      warnings: [
        {
          code: "key-outside-target-libraries",
          severity: "warning",
          found: indexedKey,
          suggestions: [`library=personal,group:${groupLibrary.groupID}`],
        },
      ],
    });
  });

  it("answers a -- token on a required or format parameter with the zotlit decoder's diagnostic", async () => {
    // Obsidian itself checks a required flag and turns a format alias into
    // format=<value>; each token here must still reach the zotlit decoder.
    const resolved = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:resolve", {
        args: { "--file": "/tmp/a.md" },
      }),
    ) as { errors: { code: string; message: string }[] };
    expect(resolved.errors).toEqual([
      {
        code: "flags-invalid",
        message: expect.stringContaining("use file=<value>"),
      },
    ]);

    const data = JSON.parse(
      await cli([
        `vault=${run.vaultId}`,
        "zotlit:template-data",
        "root=note",
        "key=ABCD2345",
        "--json",
      ]),
    ) as unknown;
    expect(data).toMatchObject({
      ok: false,
      diagnostic: {
        code: "INVALID_SELECTOR",
        details: { parameter: "--json" },
      },
    });
  });

  it("sorts titles in the pinned ZotLit Query string order", async () => {
    // The order Node gives in the package tests; this run proves that the
    // collator of Obsidian's Electron gives the same.
    const answer = JSON.parse(
      await cliCommand(run.vaultId, "zotlit:query", {
        args: {
          filter:
            '["Zebra", "apple", "Éclair", "eclair", "10", "9"].contains(title)',
          fields: "title",
          sort: "title",
          limit: "all",
        },
      }),
    ) as ItemQueryReport;

    expect(answer.ok).toBe(true);
    expect(answer.rows!.map((row) => row.values.title)).toEqual([
      "10",
      "9",
      "apple",
      "eclair",
      "Éclair",
      "Zebra",
    ]);
  });
  it("refreshes the database from a Freshness Signal", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const autoRefresh = await obEval(
      run.vaultId,
      `String(${services}.settings.current['zotero.auto-refresh'])`,
    );
    await using cleanup = new AsyncDisposableStack();
    // Only the signal may refresh: the file watchers stay unbound.
    await obEval(
      run.vaultId,
      `${services}.settings.update({'zotero.auto-refresh':false});true`,
    );
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `${services}.settings.update({'zotero.auto-refresh':${autoRefresh}});true`,
      );
    });
    await obEval(
      run.vaultId,
      `window.zotlitE2EChanged=0;window.zotlitE2EOffChanged=${services}.bridge.subscribe(${services}.zoteroReads.changed,function(){window.zotlitE2EChanged++;});true`,
    );
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        "window.zotlitE2EOffChanged();delete window.zotlitE2EOffChanged;delete window.zotlitE2EChanged;true",
      );
    });
    // The annotation sidebar keeps its cards while the refresh reads again.
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        "(async()=>{await window.zotlitE2ESidebar?.cleanup.disposeAsync();delete window.zotlitE2ESidebar;return true;})()",
      );
    });
    expect(
      await obEval(
        run.vaultId,
        `(async()=>{${PAGE}
          await using cleanup=new AsyncDisposableStack();
          const leaf=cleanup.adopt(app.workspace.getRightLeaf(true),leaf=>leaf.detach());
          await leaf.setViewState({type:'zotero-annotation-view',state:{followMode:'pinned',pinnedItemKey:${JSON.stringify(annotationItem.key)}}});
          const view=leaf.view;await view.read;
          const count=()=>view.contentEl.querySelectorAll('.zt-annot-card').length;
          await until('sidebar cards',()=>count()>0,5000).catch(()=>{});
          const watch={before:count(),least:count()};
          watch.observer=new MutationObserver(()=>{watch.least=Math.min(watch.least,count());});
          cleanup.defer(()=>watch.observer.disconnect());
          watch.observer.observe(view.contentEl,{childList:true,subtree:true});
          watch.cleanup=cleanup.move();window.zotlitE2ESidebar=watch;
          return String(watch.before);
        })()`,
      ),
    ).toBe(String(attachmentAnnotations.length));
    const signal = () => signalDatabaseUpdated(run.vaultId);
    // A Zotero edit moves the Item's title and its modification time.
    const edit = (title: string, dateModified: string) => {
      using database = new DatabaseSync(e2eFixture.databasePath);
      database
        .prepare(
          "update itemDataValues set value = ? where valueID = (select itemData.valueID from itemData join fieldsCombined using (fieldID) where itemData.itemID = ? and fieldsCombined.fieldName = 'title')",
        )
        .run(title, targetItem.itemID);
      database
        .prepare("update items set dateModified = ? where itemID = ?")
        .run(dateModified, targetItem.itemID);
    };
    const original = (() => {
      using database = new DatabaseSync(e2eFixture.databasePath);
      return database
        .prepare("select dateModified from items where itemID = ?")
        .get(targetItem.itemID) as { dateModified: string };
    })();
    const finds = (query: string) =>
      obEvalUntil(
        run.vaultId,
        `(async function(){var hits=await ${services}.itemLookup.search(${JSON.stringify(query)});return String(hits.some(function(hit){return hit.item.itemID===${targetItem.itemID};}));})()`,
        { expected: "true" },
      );

    edit("Freshness signal probe zqxv", "2031-01-01 00:00:00");
    cleanup.defer(async () => {
      edit(targetItem.title, original.dateModified);
      await signal();
      expect(await finds(targetItem.title)).toBe(true);
    });
    await signal();
    expect(
      await obEvalUntil(run.vaultId, "String(window.zotlitE2EChanged>=1)", {
        expected: "true",
      }),
    ).toBe(true);
    expect(await finds("zqxv")).toBe(true);
    expect(
      await obEval(
        run.vaultId,
        "JSON.stringify({least:window.zotlitE2ESidebar.least,now:window.zotlitE2ESidebar.observer&&document.querySelectorAll('.workspace-leaf .zt-annot-card').length>0})",
      ),
    ).toBe(JSON.stringify({ least: attachmentAnnotations.length, now: true }));
  });

  it("rebuilds the worker's Item Index off the renderer, then inserts a citation from it", async () => {
    const finds = (query: string, itemID: number) =>
      `(async function(){var hits=await app.plugins.plugins.zotlit.services.itemLookup.search(${JSON.stringify(query)});return String(hits.some(function(hit){return hit.item.itemID===${itemID};}));})()`;
    // An empty index answers fast; it fails the run here, before any timing.
    expect(
      await obEval(run.vaultId, finds("simple rules", annotationItem.itemID)),
    ).toBe("true");
    await using cleanup = new AsyncDisposableStack();

    // A sync lands a large Library: the worker builds its index while the
    // renderer keeps painting.
    const corpus = syntheticTitles(SYNTHETIC_CORPUS_SIZE);
    const lastTitleQuery = `${SYNTHETIC_MARKER} ${corpus.at(-1)!.split(" ").at(-1)!}`;
    const heapBefore = await rendererHeap(run.vaultId);
    await using frames = await recordFrames(run.vaultId);
    const added = addMyLibraryItems(e2eFixture.databasePath, corpus);
    const lastItemID = added.firstItemID + corpus.length - 1;
    cleanup.defer(async () => {
      added[Symbol.dispose]();
      await signalDatabaseUpdated(run.vaultId);
      expect(
        await obEvalUntil(run.vaultId, finds(lastTitleQuery, lastItemID), {
          expected: "false",
        }),
      ).toBe(true);
    });
    await signalDatabaseUpdated(run.vaultId);
    // Until the build completes, the held index answers: a known Item stays
    // found. The new Items show once it completes. The 10 ms pause is the
    // sampling cadence of the measurement, not a wait for a state.
    const rebuild = JSON.parse(
      await obEval(
        run.vaultId,
        `(async function(){var lookup=app.plugins.plugins.zotlit.services.itemLookup;var has=function(hits,id){return hits.some(function(hit){return hit.item.itemID===id;});};var start=performance.now();var waits=[];var staleMisses=0;while(performance.now()-start<60000){if(has(await lookup.search(${JSON.stringify(lastTitleQuery)}),${lastItemID}))return JSON.stringify({builtMs:Math.round(performance.now()-start),polls:waits.length,staleMisses:staleMisses,waitMedianMs:waits.sort(function(a,b){return a-b;})[waits.length>>1],waitMaxMs:waits.at(-1)});var t0=performance.now();if(!has(await lookup.search('simple rules'),${annotationItem.itemID}))staleMisses++;waits.push(Math.round((performance.now()-t0)*10)/10);await new Promise(function(resolve){setTimeout(resolve,10);});}return JSON.stringify({builtMs:null});})()`,
        90_000,
      ),
    ) as {
      builtMs: number | null;
      polls: number;
      staleMisses: number;
      waitMedianMs: number;
      waitMaxMs: number;
    };
    const painted = await frames.read();
    const heapGrowth = (await rendererHeap(run.vaultId)) - heapBefore;
    console.info("Item Index rebuild, 10,000 Items", {
      ...rebuild,
      ...painted,
      rendererHeapGrowthMB: Math.round(heapGrowth / 1e5) / 10,
    });
    expect(rebuild.builtMs).not.toBeNull();
    // A search that misses the new Items answered before the build ended, so
    // the held index answered at least once.
    expect(rebuild.polls).toBeGreaterThan(0);
    expect(rebuild.staleMisses).toBe(0);
    expect(painted.frames).toBeGreaterThan(1);
    // The renderer may take a short long task of its own; none blocks it
    // for more than 100 ms while the worker builds.
    expect(painted.longestTaskMs).toBeLessThanOrEqual(100);
    // ADR 0069 measured about 1 MB of index per 1,000 Items; the renderer
    // keeps less than a quarter of that.
    expect(heapGrowth).toBeLessThan((corpus.length * 1000) / 4);

    // Query cost through the shipped adapter, for ADR 0069's Measurements.
    // Each query must find Items, so its time includes the hydration.
    const words = corpus[123]!.split(" ");
    const queries = [
      "k",
      words[2]!,
      `${SYNTHETIC_MARKER} ${words[3]!}`,
      `Synthauthor${added.firstItemID + 12}`,
      lastTitleQuery,
    ];
    const timings = JSON.parse(
      await obEval(
        run.vaultId,
        `(async function(){var lookup=app.plugins.plugins.zotlit.services.itemLookup;var out={};for(var query of ${JSON.stringify(queries)}){var times=[];var hits=0;for(var i=0;i<21;i++){var t0=performance.now();hits=(await lookup.search(query)).length;times.push(performance.now()-t0);}times.sort(function(a,b){return a-b;});out[query]={hits:hits,medianMs:Math.round(times[10]*10)/10,p95Ms:Math.round(times[19]*10)/10};}return JSON.stringify(out);})()`,
        90_000,
      ),
    ) as Record<string, { hits: number; medianMs: number; p95Ms: number }>;
    console.info("Item Index queries, 10,000 Items", timings);
    for (const query of queries)
      expect(timings[query]!.hits).toBeGreaterThan(0);

    // A large classification bounds renderer request encoding as well as
    // worker replies, while every request uses the same Snapshot (#1351).
    await obEval(
      run.vaultId,
      `(()=>{const original=Worker.prototype.postMessage;const requests=[];Worker.prototype.postMessage=function(message,...rest){const request=message?.[1];if(request?.tag==='DisplayRefs')requests.push({count:request.payload.itemIDs.length,snapshot:request.payload.snapshot});return original.call(this,message,...rest);};window.zotlitE2EClassifyRequests={requests,restore:()=>{Worker.prototype.postMessage=original;}};return true;})()`,
    );
    try {
      expect(
        await obEval(
          run.vaultId,
          "app.commands.executeCommandById('zotlit:update-all-notes')",
        ),
      ).toBe("true");
      expect(
        await obEvalUntil(
          run.vaultId,
          `String(Array.from(activeDocument.querySelectorAll('.modal button')).some(button=>button.textContent.trim()===${JSON.stringify(run.m.batch_update_confirm_button())}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      const requests = JSON.parse(
        await obEval(
          run.vaultId,
          "JSON.stringify(window.zotlitE2EClassifyRequests.requests)",
        ),
      ) as { count: number; snapshot: string }[];
      expect(
        requests.reduce((total, request) => total + request.count, 0),
      ).toBeGreaterThanOrEqual(SYNTHETIC_CORPUS_SIZE);
      expect(requests.every(({ count }) => count <= 500)).toBe(true);
      expect(requests[0]?.snapshot).toBeDefined();
      expect(new Set(requests.map(({ snapshot }) => snapshot)).size).toBe(1);
    } finally {
      await clickModalButton(run.vaultId, run.m.modal_cancel());
      await obEval(
        run.vaultId,
        "window.zotlitE2EClassifyRequests.restore();delete window.zotlitE2EClassifyRequests;true",
      );
    }

    // The Citation Suggester over that Library. It comes after the
    // measurement: a rendered citation can start the Pandoc engine, and that
    // start is renderer work of its own.
    const source = "Citation suggester source.md";
    await obEval(
      run.vaultId,
      `(async function(){var file=await app.vault.create(${JSON.stringify(source)},'');var leaf=app.workspace.getLeaf(true);await leaf.openFile(file,{state:{mode:'source',source:true}});leaf.view.editor.focus();return true;})()`,
    );
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async function(){var file=app.vault.getAbstractFileByPath(${JSON.stringify(source)});for(var leaf of app.workspace.getLeavesOfType('markdown'))if(leaf.view.file===file)leaf.detach();await app.fileManager.trashFile(file);return true;})()`,
      );
    });
    const editor = `app.workspace.getLeavesOfType('markdown').find(function(leaf){return leaf.view.file?.path===${JSON.stringify(source)};}).view.editor`;
    // One key every 70 ms, past Obsidian's 50 ms suggester delay, so each
    // keystroke sends its own search. The popup opens at `[@` and stays
    // open through every answer after it.
    expect(
      await obEval(
        run.vaultId,
        `(async function(){var cm=${editor}.cm;var watch={opened:false,closed:false};var observer=new MutationObserver(function(records){for(var record of records)for(var node of record.removedNodes)if(node.classList?.contains('suggestion-container'))watch.closed=true;});try{for(var ch of ${JSON.stringify("[@ten simple")}){cm.dispatch(cm.state.replaceSelection(ch),{userEvent:'input.type'});await new Promise(function(resolve){setTimeout(resolve,70);});if(!watch.opened&&activeDocument.querySelector('.suggestion-container')){watch.opened=true;observer.observe(activeDocument.body,{childList:true,subtree:true});}}}finally{observer.disconnect();}return JSON.stringify(watch);})()`,
      ),
    ).toBe(JSON.stringify({ opened: true, closed: false }));
    const popup =
      "Array.from(activeDocument.querySelectorAll('.suggestion-container')).at(-1)";
    // The list matches the final query: its Item comes first. The popup is
    // `aria-busy` while its rows answer an earlier query.
    expect(
      await obEvalUntil(
        run.vaultId,
        `String(!!${popup}&&!${popup}.hasAttribute('aria-busy')&&!!${popup}.querySelector('.suggestion-item')?.textContent.includes(${JSON.stringify(annotationItem.title)}))`,
        { expected: "true" },
      ),
    ).toBe(true);
    await obEval(
      run.vaultId,
      `(function(){var row=${popup}.querySelector('.suggestion-item');row.dispatchEvent(new activeWindow.MouseEvent('mousemove',{bubbles:true}));row.dispatchEvent(new activeWindow.MouseEvent('click',{bubbles:true}));return true;})()`,
    );
    expect(
      await obEvalUntil(run.vaultId, `${editor}.getValue()`, {
        expected: `[@${annotationItem.citationKey}]`,
      }),
    ).toBe(true);
  }, 180_000);

  it("finds a word inside a Chinese title once the Chinese Segmenter is installed, with no reload", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const segmenter = `${services}.chineseSegmenter`;
    await using cleanup = new AsyncDisposableStack();
    // The binary cache is device-wide: copy it now and put the copy back at
    // the end, whatever happens between.
    await obEval(
      run.vaultId,
      `(async function(){var saved=[];try{var dir=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('zotlit')).getDirectoryHandle(${JSON.stringify(SEGMENTER_CACHE_DIR)});for await(var [name,handle] of dir.entries())if(handle.kind==='file')saved.push({name:name,bytes:new Uint8Array(await (await handle.getFile()).arrayBuffer())});}catch(error){if(error.name!=='NotFoundError')throw error;}window.zotlitE2ESegmenterCache=saved;return true;})()`,
    );
    cleanup.defer(async () => {
      await obEval(
        run.vaultId,
        `(async function(){var root=await (await navigator.storage.getDirectory()).getDirectoryHandle('zotlit',{create:true});await root.removeEntry(${JSON.stringify(SEGMENTER_CACHE_DIR)},{recursive:true}).catch(function(error){if(error.name!=='NotFoundError')throw error;});var saved=window.zotlitE2ESegmenterCache;if(saved.length>0){var dir=await root.getDirectoryHandle(${JSON.stringify(SEGMENTER_CACHE_DIR)},{create:true});for(var entry of saved){var writable=await (await dir.getFileHandle(entry.name,{create:true})).createWritable();await writable.write(entry.bytes);await writable.close();}}delete window.zotlitE2ESegmenterCache;return true;})()`,
      );
    });
    // Start from no binary, as a user who has not installed it yet.
    await obEval(
      run.vaultId,
      `${segmenter}.uninstall().then(function(){return true;})`,
    );
    const added = addMyLibraryItems(e2eFixture.databasePath, [
      "长江流域的城市化研究",
    ]);
    cleanup.defer(async () => {
      added[Symbol.dispose]();
      await signalDatabaseUpdated(run.vaultId);
    });
    await signalDatabaseUpdated(run.vaultId);
    const finds = (query: string) =>
      `(async function(){var hits=await ${services}.itemLookup.search(${JSON.stringify(query)});return String(hits.some(function(hit){return hit.item.itemID===${added.firstItemID};}));})()`;
    expect(
      await obEvalUntil(run.vaultId, finds("长江流域"), { expected: "true" }),
    ).toBe(true);
    // `Intl.Segmenter` keeps `长江流域` one word, so the word inside misses.
    expect(await obEval(run.vaultId, finds("流域"))).toBe("false");

    await obEval(
      run.vaultId,
      "window.zotlitE2EPlugin=app.plugins.plugins.zotlit;true",
    );
    cleanup.defer(async () => {
      await obEval(run.vaultId, "delete window.zotlitE2EPlugin;true");
    });
    expect(
      await obEval(
        run.vaultId,
        `${segmenter}.install().then(function(){return ${segmenter}.getStatus().kind;})`,
        120_000,
      ),
    ).toBe("installed");
    expect(
      await obEvalUntil(run.vaultId, finds("流域"), { expected: "true" }),
    ).toBe(true);

    await obEval(
      run.vaultId,
      `${segmenter}.uninstall().then(function(){return true;})`,
    );
    expect(
      await obEvalUntil(run.vaultId, finds("流域"), { expected: "false" }),
    ).toBe(true);
    expect(await obEval(run.vaultId, finds("长江流域"))).toBe("true");
    expect(
      await obEval(
        run.vaultId,
        "String(window.zotlitE2EPlugin===app.plugins.plugins.zotlit)",
      ),
    ).toBe("true");
  }, 180_000);

  it("writes the database worker's log records to the plugin's log file at the configured level", async () => {
    const services = "app.plugins.plugins.zotlit.services";
    const logPath =
      "app.plugins.plugins.zotlit.manifest.dir+'/zotlit.log.jsonl'";
    /** Note where the log file ends, then refresh the database. */
    const refresh = `(async function(){window.zotlitE2ELogStart=(await app.vault.adapter.read(${logPath})).length;await ${services}.zoteroReads.refresh();return true;})()`;
    /**
     * Once the refresh's `Opened Zotero database` record is in the file, the
     * count of `DEBUG` records the refresh added under categories only the
     * database worker logs to; `pending` before.
     */
    const workerDebugRecords = `(async function(){var added=(await app.vault.adapter.read(${logPath})).slice(window.zotlitE2ELogStart).split('\\n').filter(Boolean).map(function(line){return JSON.parse(line);});if(!added.some(function(record){return record.message==='Opened Zotero database';}))return 'pending';return String(added.filter(function(record){return record.level==='DEBUG'&&/^zotlit\\.(db|item-lookup|obsidian\\.database)\\./.test(record.logger);}).length);})()`;
    /** Refresh, and count its worker `DEBUG` records once they are written. */
    const workerDebugRecordsOfARefresh = async () => {
      await obEval(run.vaultId, refresh);
      let count = "pending";
      await waitFor(async () => {
        count = await obEval(run.vaultId, workerDebugRecords);
        return count !== "pending";
      });
      return count;
    };
    const previous = await obEval(
      run.vaultId,
      `JSON.stringify({'log.level':${services}.settings.current['log.level'],'log.to-file':${services}.settings.current['log.to-file']})`,
    );
    try {
      await obEval(
        run.vaultId,
        `${services}.settings.update({'log.level':'debug','log.to-file':true});true`,
      );
      expect(
        await obEvalUntil(
          run.vaultId,
          `app.vault.adapter.exists(${logPath}).then(String)`,
          { expected: "true" },
        ),
      ).toBe(true);
      // At `debug`, the worker's read snapshot and Item Index records reach the file.
      expect(
        await waitFor(
          async () => Number(await workerDebugRecordsOfARefresh()) > 0,
          10,
        ),
      ).toBe(true);
      // At `info`, the worker forwards its `Opened Zotero database` record and
      // none of them. The level reaches the worker after the settings change,
      // so a refresh repeats until it does.
      await obEval(
        run.vaultId,
        `${services}.settings.update({'log.level':'info'});true`,
      );
      expect(
        await waitFor(
          async () => (await workerDebugRecordsOfARefresh()) === "0",
          10,
        ),
      ).toBe(true);
    } finally {
      await obEval(
        run.vaultId,
        `${services}.settings.update(${previous});true`,
      );
    }
  }, 180_000);

  it("removes every ZotLit vault and metadata cache handler as ZotLit is disabled, while its database worker still closes", async () => {
    // ZotLit's handlers are the entries its enable adds to the listener
    // lists. The worker may take seconds to close; the handlers go at once.
    const survivors = await obJson<string[]>(
      run.vaultId,
      `(async()=>{
        const listed=()=>[app.vault,app.metadataCache].flatMap(e=>Object.entries(e._??{}).flatMap(([name,entries])=>entries.map(entry=>[name,entry])));
        try{
          await app.plugins.disablePlugin('zotlit');
          const before=new Set(listed().map(([,entry])=>entry));
          await app.plugins.enablePlugin('zotlit');
          await app.plugins.plugins.zotlit.services.zoteroReads.ready;
          const added=listed().filter(([,entry])=>!before.has(entry));
          if(added.length===0)throw new Error('ZotLit added no handler');
          await app.plugins.disablePlugin('zotlit');
          const end=Date.now()+1000;
          let left=added;
          while(true){
            const now=new Set(listed().map(([,entry])=>entry));
            left=added.filter(([,entry])=>now.has(entry));
            if(left.length===0||Date.now()>end)break;
            await new Promise(r=>setTimeout(r,20));
          }
          return JSON.stringify(left.map(([name,entry])=>name+': '+String(entry.fn).slice(0,120)));
        }finally{
          if(!app.plugins.plugins.zotlit)await app.plugins.enablePlugin('zotlit');
        }
      })()`,
    );
    expect(survivors).toEqual([]);
  }, 120_000);
});
