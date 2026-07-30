import Ajv2020 from "ajv/dist/2020";
import { type DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import annotationSchema from "@zotlit/db/contract/annotation.schema.json";
import filenameSchema from "@zotlit/db/contract/filename.schema.json";
import noteSchema from "@zotlit/db/contract/note.schema.json";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { defaults as settingsDefaults } from "@/services/settings/schema";
import { InertTemplateError } from "@/services/template/errors";

import {
  createTemplateWorkbenchHandlers,
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_RENDER_COMMAND,
} from "./cli";
import { loadTemplateData, type TemplateDataDeps } from "./data";

describe("zotlit:template-data with the real loader", () => {
  it("renders through inert resolvers without invoking a write surface", async () => {
    using fixture = createFixture({
      render: (name, data) => {
        const noteLink = (
          data as { notes: { noteLink: () => string }[] }
        ).notes[0]!.noteLink();
        return `${name}:${noteLink}`;
      },
    });

    expect(await runTemplateRender(fixture.deps, "MAIN2345")).toMatchObject({
      ok: true,
      request: {
        key: "MAIN2345",
        template: "note",
        format: "json",
      },
      markdown: "note:",
    });
    expect(fixture.writeCalls).toEqual([]);
  });

  it.each([
    ["note", "MAIN2345", noteSchema],
    ["annotation", "ANNA2345", annotationSchema],
    ["filename", "MAIN2345", filenameSchema],
  ] as const)(
    "serializes fixture data that conforms to the %s schema",
    async (root, key, schema) => {
      using fixture = createFixture();
      const result = await runTemplateData(fixture.deps, key, root);
      const validate = new Ajv2020({ strict: true }).compile(schema);

      expect(result.ok).toBe(true);
      expect(
        validate(result.data),
        JSON.stringify(validate.errors, null, 2),
      ).toBe(true);
    },
  );

  it("returns the selected annotation at the annotation root", async () => {
    using fixture = createFixture();

    const result = await runTemplateData(
      fixture.deps,
      "ANNA2345",
      "annotation",
    );

    expect(result).toMatchObject({
      contractVersion: 1,
      command: TEMPLATE_DATA_COMMAND,
      ok: true,
      request: {
        key: "ANNA2345",
        root: "annotation",
        format: "json",
      },
      identity: {
        vault: { id: "Test Vault" },
        source: { id: "a1b2c3d4" },
      },
      data: {
        key: "ANNA2345",
        indexedKey: "ANNA2345",
        citation: "Fixture citation",
      },
    });
  });

  it.each([
    {
      error: new InertTemplateError("JavaScript Templates are disabled"),
      compileError: null,
      code: "ETA_OPT_IN_REQUIRED",
    },
    {
      error: new Error("cite cannot compile"),
      compileError: "Unexpected token",
      code: "TEMPLATE_COMPILE_ERROR",
    },
    {
      error: new Error("cite render failed"),
      compileError: null,
      code: "TEMPLATE_RENDER_ERROR",
    },
  ] as const)(
    "returns $code when citation evaluation fails",
    async ({ error, compileError, code }) => {
      using fixture = createFixture({ renderError: error, compileError });

      expect(
        await runTemplateData(fixture.deps, "ANNA2345", "annotation"),
      ).toMatchObject({
        contractVersion: 1,
        command: TEMPLATE_DATA_COMMAND,
        ok: false,
        request: {
          key: "ANNA2345",
          root: "annotation",
          format: "json",
        },
        identity: {
          vault: { id: "Test Vault" },
          source: { id: "a1b2c3d4" },
        },
        diagnostic: {
          code,
          details: { template: "cite" },
        },
      });
    },
  );

  it("resolves a group-library annotation at the annotation root", async () => {
    using fixture = createFixture();

    expect(
      await runTemplateData(fixture.deps, "GANN2345g42", "annotation"),
    ).toMatchObject({
      ok: true,
      data: {
        indexedKey: "GANN2345g42",
        parentItem: { indexedKey: "GRUP2345g42" },
      },
    });
  });

  it.each(["MAIN2345", "ATCH2345", "NATE2345"])(
    "requires an annotation for selector %s at the annotation root",
    async (key) => {
      using fixture = createFixture();

      expect(
        await runTemplateData(fixture.deps, key, "annotation"),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "ANNOTATION_REQUIRED" },
      });
    },
  );

  it("distinguishes an unknown annotation selector", async () => {
    using fixture = createFixture();

    expect(
      await runTemplateData(fixture.deps, "MISS2345", "annotation"),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "KEY_NOT_FOUND" },
    });
  });

  it("serves a standalone annotation with a null parent item", async () => {
    using fixture = createFixture();

    const result = await runTemplateData(
      fixture.deps,
      "STAN2345",
      "annotation",
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        key: "STAN2345",
        parentItem: null,
        citation: null,
      },
    });
    expect(
      await runTemplateData(fixture.deps, "STAN2345", "note"),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "NO_PARENT_ITEM" },
    });
    expect(
      await runTemplateData(fixture.deps, "STAN2345", "filename"),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "NO_PARENT_ITEM" },
    });
  });

  it("returns the Filename Template's single-item data", async () => {
    using fixture = createFixture();

    const result = await runTemplateData(fixture.deps, "MAIN2345", "filename");

    expect(result).toMatchObject({
      contractVersion: 1,
      command: TEMPLATE_DATA_COMMAND,
      ok: true,
      request: {
        key: "MAIN2345",
        root: "filename",
        format: "json",
      },
      identity: {
        vault: { id: "Test Vault" },
        source: { id: "a1b2c3d4" },
      },
      data: {
        indexedKey: "MAIN2345",
        notePath: "",
        noteLink: {
          $helper: "noteLink",
          signature: "(alias?: string, subpath?: string) => string | null",
          value: "",
        },
      },
    });
    expect(
      (result.data as Record<string, unknown>).annotations,
    ).toBeUndefined();
  });

  it.each([
    ["ANNA2345", "MAIN2345"],
    ["ATCH2345", "MAIN2345"],
    ["NATE2345", "MAIN2345"],
    ["GRUP2345g42", "GRUP2345g42"],
  ])(
    "walks selector %s to Item %s at the filename root",
    async (key, itemKey) => {
      using fixture = createFixture();

      expect(
        await runTemplateData(fixture.deps, key, "filename"),
      ).toMatchObject({
        ok: true,
        data: { indexedKey: itemKey },
      });
    },
  );

  it.each([
    ["MAIN2345", "MAIN2345"],
    ["ATCH2345", "MAIN2345"],
    ["ANNA2345", "MAIN2345"],
    ["NATE2345", "MAIN2345"],
    ["GRUP2345g42", "GRUP2345g42"],
  ])("builds note data for selector %s from item %s", async (key, itemKey) => {
    using fixture = createFixture();
    const result = await runTemplateData(fixture.deps, key);

    expect(result).toMatchObject({
      ok: true,
      request: { key, root: "note", format: "json" },
      data: { indexedKey: itemKey },
    });
  });

  it.each(["FREE2345", "LANE2345"])(
    "rejects standalone child %s",
    async (key) => {
      using fixture = createFixture();
      expect(await runTemplateData(fixture.deps, key)).toMatchObject({
        ok: false,
        diagnostic: { code: "NO_PARENT_ITEM" },
      });
    },
  );

  it.each(["FREE2345", "LANE2345"])(
    "rejects standalone child %s at the filename root",
    async (key) => {
      using fixture = createFixture();

      expect(
        await runTemplateData(fixture.deps, key, "filename"),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "NO_PARENT_ITEM" },
      });
    },
  );

  it.each(["MISS2345", "MAIN2345g999"])(
    "reports unresolved selector %s",
    async (key) => {
      using fixture = createFixture();
      expect(await runTemplateData(fixture.deps, key)).toMatchObject({
        ok: false,
        diagnostic: { code: "KEY_NOT_FOUND" },
      });
    },
  );

  it("serializes real inert resolvers without invoking a write surface", async () => {
    using fixture = createFixture();

    const result = await runTemplateData(fixture.deps, "MAIN2345");

    expect(result).toMatchObject({
      ok: true,
      data: {
        noteLink: {
          $helper: "noteLink",
          signature: "(alias?: string, subpath?: string) => string | null",
          value: null,
        },
        annotations: [
          {
            imgLink: { $inert: expect.any(String) },
            parentItem: { $ref: "zt" },
          },
        ],
        notes: [{ noteLink: { $inert: expect.any(String) } }],
      },
    });
    expect(fixture.writeCalls).toEqual([]);
  });
});

function createFixture(options?: {
  renderError?: Error;
  compileError?: string | null;
  render?: (name: string, data: object) => string;
}): {
  deps: TemplateDataDeps;
  writeCalls: string[];
  [Symbol.dispose](): void;
} {
  const client = createClient(":memory:");
  const sqlite = client.$client as DatabaseSync;
  const writeCalls: string[] = [];
  try {
    seed(sqlite);
    return {
      deps: {
        app: {
          fileManager: {
            generateMarkdownLink: () => "",
            renameFile: () => {
              writeCalls.push("fileManager.renameFile");
            },
          },
          vault: {
            getFileByPath: () => null,
            create: () => {
              writeCalls.push("vault.create");
            },
            createBinary: () => {
              writeCalls.push("vault.createBinary");
            },
            modify: () => {
              writeCalls.push("vault.modify");
            },
          },
        } as never,
        db: {
          acquireRead: async () =>
            ({
              client,
              [Symbol.dispose]() {},
            }) as never,
        },
        noteIndex: {
          getNotesByItemKey: () => [],
          getNotesByCitekey: () => [],
          getImportedNoteByNoteKey: () => [],
          whenIndexed: async () => {},
        },
        settings: {
          loaded: Promise.resolve(settingsDefaults),
        },
        templates: {
          ready: Promise.resolve(),
          compileErrors: options?.compileError
            ? new Map([["cite", options.compileError]])
            : new Map(),
          render: (name, data) => {
            if (options?.renderError) throw options.renderError;
            if (options?.render) return options.render(name, data);
            return "Fixture citation\n";
          },
        },
        zoteroPref: {
          ready: Promise.resolve(),
          dataDir: "/Zotero",
          baseAttachmentPath: null,
        },
      },
      writeCalls,
      [Symbol.dispose]() {
        sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

async function runTemplateData(
  deps: TemplateDataDeps,
  key: string,
  root: "note" | "annotation" | "filename" = "note",
): Promise<Record<string, unknown>> {
  const handlers = createTemplateWorkbenchHandlers({
    getIdentity: () => ({
      vault: { id: "Test Vault", path: "/vaults/test" },
      source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
    }),
    loadData: (indexedKey, root) => loadTemplateData(deps, indexedKey, root),
    templates: {
      javascriptTemplatesEnabled: false,
      compileErrors: deps.templates.compileErrors,
      getTemplateFileStatuses: () => [],
      render: deps.templates.render,
      renderFilename: (data) => deps.templates.render("filename", data),
      waitUntilSettled: async () => "settled" as const,
    },
  });
  return JSON.parse(
    await handlers[TEMPLATE_DATA_COMMAND]({
      key,
      root,
      format: "json",
    }),
  ) as Record<string, unknown>;
}

async function runTemplateRender(
  deps: TemplateDataDeps,
  key: string,
): Promise<Record<string, unknown>> {
  const handlers = createTemplateWorkbenchHandlers({
    getIdentity: () => ({
      vault: { id: "Test Vault", path: "/vaults/test" },
      source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
    }),
    loadData: (indexedKey, root) => loadTemplateData(deps, indexedKey, root),
    templates: {
      javascriptTemplatesEnabled: false,
      compileErrors: deps.templates.compileErrors,
      getTemplateFileStatuses: () => [
        {
          name: "note",
          winner: {
            language: "liquid",
            source: { kind: "embedded-default" },
          },
          editablePath: "Templates/zotlit-note.liquid.md",
          shadowedFiles: [],
          inertFiles: [],
          compileError: null,
        },
      ],
      render: deps.templates.render,
      renderFilename: (data) => deps.templates.render("filename", data),
      waitUntilSettled: async () => "settled" as const,
    },
  });
  return JSON.parse(
    await handlers[TEMPLATE_RENDER_COMMAND]({
      key,
      template: "note",
      format: "json",
    }),
  ) as Record<string, unknown>;
}

function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into libraries (libraryID, type, editable, filesEditable)
      values (1, 'user', 1, 1), (2, 'group', 1, 1);
    insert into groups (groupID, libraryID, name, description, version)
      values (42, 2, 'Shared', '', 1);

    insert into itemTypes (itemTypeID, typeName)
      values
        (1, 'journalArticle'),
        (2, 'attachment'),
        (3, 'annotation'),
        (4, 'note');

    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'citationKey', 0);
    insert into itemDataValues (valueID, value)
      values (100, 'fixture2024');
    insert into itemData (itemID, fieldID, valueID)
      values (1, 10, 100);

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'MAIN2345'),
        (10, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
        (20, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNA2345'),
        (21, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'STAN2345'),
        (30, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'NATE2345'),
        (40, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'FREE2345'),
        (50, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'LANE2345'),
        (60, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 2, 'GRUP2345'),
        (61, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 2, 'GATT2345'),
        (62, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 2, 'GANN2345');

    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
      values
        (10, 1, 0, 'application/pdf', 'storage:paper.pdf'),
        (40, null, 0, 'application/pdf', 'storage:standalone.pdf'),
        (61, 60, 0, 'application/pdf', 'storage:group.pdf');

    insert into itemAnnotations (
      itemID, parentItemID, type, authorName, text, comment, color, pageLabel,
      sortIndex, position, isExternal
    ) values
      (
        20, 10, 3, null, 'excerpt', null, '#ffd400', '1',
        '00000|000001|00000', '{"pageIndex":0,"rects":[]}', 0
      ),
      (
        21, 40, 1, null, 'standalone', null, '#ffd400', '2',
        '00000|000002|00000', '{"pageIndex":1,"rects":[]}', 0
      ),
      (
        62, 61, 1, null, 'group', null, '#ffd400', '3',
        '00000|000003|00000', '{"pageIndex":2,"rects":[]}', 0
      );

    insert into itemNotes (itemID, parentItemID, note, title)
      values
        (30, 1, '<p>child</p>', 'Child'),
        (50, null, '<p>standalone</p>', 'Standalone');
  `);
}
