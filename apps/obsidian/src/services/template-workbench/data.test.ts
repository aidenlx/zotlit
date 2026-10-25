import Ajv2020 from "ajv/dist/2020";
import type { DatabaseSync } from "node:sqlite";
import type { CliData } from "obsidian";
import { describe, expect } from "vitest";

import { citekeysToCiteTemplateData } from "@zotlit/db";
import type { ContractRoot } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import annotationSchema from "@zotlit/db/contract/annotation.schema.json";
import citationSchema from "@zotlit/db/contract/citation.schema.json";
import filenameSchema from "@zotlit/db/contract/filename.schema.json";
import noteSchema from "@zotlit/db/contract/note.schema.json";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { TemplateEngine } from "@zotlit/templates";
import { CITATION_EXAMPLE_IDS } from "@zotlit/workbench/render";
import type { CitationExampleId } from "@zotlit/workbench/render";

import { fakeCliHost } from "@/lib/__fixtures__/cli-host";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { defaults as settingsDefaults } from "@/services/settings/schema";
import { InertTemplateError } from "@/services/template/errors";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { createTemplateWorkbenchHandlers, TEMPLATE_DATA_COMMAND } from "./cli";
import { readCitationData, readTemplateData } from "./data";
import type { TemplateDataDeps } from "./data";
import { registerTemplateWorkbench } from "./register";

function registeredData(deps: FixtureDeps) {
  const { host, command } = fakeCliHost();
  Object.assign(deps.app.vault, {
    getName: () => "Data fixture",
    adapter: { getBasePath: () => "/fixture" },
    getMarkdownFiles: () => [{ path: "Notes/Paper.md", basename: "Paper" }],
  });
  Object.assign(deps.app, {
    metadataCache: {
      getFileCache: () => ({ frontmatter: { "zotero-key": "MAIN2345" } }),
    },
  });
  Object.assign(deps.zoteroPref, {
    sourceId: "fixture-source",
    databasePath: "/Zotero/zotero.sqlite",
  });
  Object.assign(deps.templates, { waitUntilSettled: async () => "settled" });
  registerTemplateWorkbench({ ...host, manifest: { version: "test" } }, {
    runtime: testRuntime(),
    ...deps,
    profile: {
      ready: Promise.resolve(),
      profileOf: () => ({ ok: true, profile: { selector: "default" } }),
    },
  } as never);
  const { handler } = command(TEMPLATE_DATA_COMMAND);
  return (params: CliData) =>
    handler(params).pipe(
      Effect.map((output) => JSON.parse(output) as Record<string, any>),
    );
}

describe("registered field discovery", () => {
  it.effect(
    "joins real values with definitions and expressions, with note and environment identity",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        const run = registeredData(fixture.deps);
        const result = yield* run({
          note: "Notes/Paper.md",
          root: "note",
          query: "citekey",
          "expect-source": "fixture-source",
        });
        expect(result).toMatchObject({
          ok: true,
          identity: {
            vault: { path: "/fixture" },
            source: { id: "fixture-source" },
          },
          selection: {
            key: "MAIN2345",
            note: "Notes/Paper.md",
            profile: "default",
            root: "note",
          },
        });
        expect(result.discovery.matches[0]).toMatchObject({
          path: "zt.citekey",
          presence: "present",
          value: "fixture2024",
          definition: {
            name: "citekey",
            description: expect.stringContaining("citation"),
          },
          examples: { liquid: "{{ zt.citekey }}", eta: "<%= zt.citekey %>" },
        });
        expect(result.zt).toBeUndefined();
        expect(fixture.writeCalls).toEqual([]);
      }),
  );

  it.effect("builds data from the selected note when an item has several", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();
      const run = registeredData(fixture.deps);
      // A resolved note makes the excerpt-image context read the attachment
      // folder, which the base fixture's FileManager does not answer.
      Object.assign(fixture.deps.app.fileManager, {
        getAvailablePathForAttachment: async (name: string) =>
          `attachments/${name}`,
      });
      const notes = [
        { path: "Notes/One.md", basename: "One" },
        { path: "Notes/Two.md", basename: "Two" },
      ];
      fixture.deps.app.vault.getMarkdownFiles = () => notes as never;
      fixture.deps.noteIndex.getNotesByItemKey = () => notes as never;

      const result = yield* run({
        note: "Notes/Two.md",
        root: "note",
        path: "zt.notePath",
      });

      expect(result.selection).toMatchObject({ note: "Notes/Two.md" });
      expect(result.discovery.matches[0]).toMatchObject({
        path: "zt.notePath",
        value: "Notes/Two.md",
      });
    }),
  );

  it.effect(
    "inspects nested annotations and preserves empty arrays and absent fields",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        const run = registeredData(fixture.deps);
        const selected = { key: "MAIN2345", root: "note" };
        expect(
          (yield* run({ ...selected, path: "zt.annotations[0].pageLabel" }))
            .discovery.matches[0],
        ).toMatchObject({
          value: "1",
          presence: "present",
          examples: { liquid: "{{ zt.annotations[0].pageLabel }}" },
        });
        expect(
          (yield* run({ ...selected, path: "zt.tags" })).discovery.matches[0],
        ).toMatchObject({ value: [], presence: "present" });
        expect(
          (yield* run({ ...selected, path: "zt.title" })).discovery.matches[0],
        ).toMatchObject({ value: null, presence: "present" });
        expect(
          (yield* run({ ...selected, path: "zt.conferenceName" })).discovery
            .matches[0],
        ).toMatchObject({
          presence: "absent",
          definition: { name: "conferenceName" },
        });
        const absent = (yield* run({
          ...selected,
          path: "zt.annotations[99].comment",
        })).discovery.matches[0];
        expect(absent.presence).toBe("absent");
        expect(absent).not.toHaveProperty("value");
        expect((yield* run({ ...selected })).zt).toBeUndefined();
        expect((yield* run({ ...selected, full: "" })).zt.indexedKey).toBe(
          "MAIN2345",
        );
        expect(fixture.writeCalls).toEqual([]);
      }),
  );

  it.effect(
    "keeps focused reads independent of unrelated getters and rejects a different source",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture({
          renderError: new Error("Citation must not run"),
        });
        const run = registeredData(fixture.deps);
        expect(
          yield* run({
            key: "ANNA2345",
            root: "annotation",
            path: "zt.pageLabel",
          }),
        ).toMatchObject({ ok: true, discovery: { matches: [{ value: "1" }] } });
        expect(
          yield* run({
            key: "MAIN2345",
            root: "note",
            query: "title",
            "expect-source": "different-source",
          }),
        ).toMatchObject({ ok: false, diagnostic: { code: "TARGET_MISMATCH" } });
        expect(fixture.writeCalls).toEqual([]);
      }),
  );

  it.effect(
    "keeps Annotation and Citation caller roots distinct and evaluates inert helpers",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        const run = registeredData(fixture.deps);
        expect(
          yield* run({
            key: "ANNA2345",
            root: "annotation",
            path: "zt.pageLabel",
          }),
        ).toMatchObject({
          selection: { key: "ANNA2345", root: "annotation" },
          discovery: { matches: [{ value: "1" }] },
        });
        expect(
          yield* run({
            example: "two-items",
            root: "citation",
            path: "zt.citations[1].item.citekey",
          }),
        ).toMatchObject({
          selection: { example: "two-items", root: "citation" },
          discovery: { matches: [{ value: "Kahneman2011" }] },
        });
        const helper = yield* run({
          key: "MAIN2345",
          root: "note",
          path: "zt.notes[0].noteLink",
        });
        expect(helper.discovery.matches[0]).toMatchObject({
          value: {
            $helper: "noteLink",
            value: "[Child](zotero://select/library/items/NATE2345)",
          },
          examples: { eta: "<%= zt?.notes?.[0]?.noteLink?.() %>" },
        });
        expect(fixture.writeCalls).toEqual([]);
      }),
  );

  it.effect(
    "inspects dictionary keys and retains each possible date-day type",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        const run = registeredData(fixture.deps);
        const field = (yield* run({
          key: "MAIN2345",
          root: "note",
          path: 'zt.extra.fields["tex.mendeley-tags"]',
        })).discovery.matches[0];
        expect(field).toMatchObject({
          presence: "present",
          value: "reading",
          definition: { type: { kind: "primitive", type: "string" } },
        });
        const day = (yield* run({
          key: "MAIN2345",
          root: "note",
          path: "zt.date.day",
        })).discovery.matches[0];
        expect(day).toMatchObject({
          value: 2,
          definition: {
            type: {
              kind: "union",
              options: expect.arrayContaining([
                { kind: "primitive", type: "number" },
                { kind: "primitive", type: "null" },
              ]),
            },
          },
        });
        expect(day.definition.description).toContain("Day of month");
      }),
  );

  it.effect(
    "runs Eta helper examples for present, null, and absent selected values",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        const run = registeredData(fixture.deps);
        const engine = new TemplateEngine();
        const present = (yield* run({
          key: "MAIN2345",
          root: "note",
          path: "zt.notes[0].noteLink",
        })).discovery.matches[0];
        const absent = (yield* run({
          key: "MAIN2345",
          root: "note",
          path: "zt.notes[99].noteLink",
        })).discovery.matches[0];
        expect(
          engine.renderString(present.examples.eta, {
            notes: [{ noteLink: () => "[[Child]]" }],
          }),
        ).toBe("[[Child]]");
        expect(
          engine.renderString(present.examples.eta, {
            notes: [{ noteLink: null }],
          }),
        ).toBe("");
        expect(engine.renderString(absent.examples.eta, { notes: [] })).toBe(
          "",
        );
        const author = (yield* run({
          example: "two-items",
          root: "citation",
          path: "zt.items[0].creators[0].family",
        })).discovery.matches[0];
        expect(author).toMatchObject({ value: "Ioannidis" });
        expect(
          engine.renderString(author.examples.eta, {
            items: [{ creators: [{ family: "Ioannidis" }] }],
          }),
        ).toBe("Ioannidis");
        expect(
          (yield* run({
            key: "MAIN2345",
            root: "note",
            path: "zt.creators[0].family",
          })).ok,
        ).toBe(true);
      }),
  );

  it.effect.each<CliData>([
    { key: "MAIN2345", root: "annotation", query: "text" },
    { key: "MISS2345", root: "note", query: "title" },
    { key: "MAIN2345", root: "note", path: "zt.citations[0]" },
    { key: "MAIN2345", root: "note", path: "zt.title()" },
    { key: "MAIN2345", root: "note", query: "title", full: "" },
    { note: "missing", root: "note", query: "title" },
  ])("gives recovery for invalid discovery %j", (params) =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();
      const result = yield* registeredData(fixture.deps)(params);
      expect(result).toMatchObject({
        ok: false,
        diagnostic: { message: expect.any(String), hint: expect.any(String) },
      });
      expect(fixture.writeCalls).toEqual([]);
    }),
  );
});

describe("zotlit:template-data with the real loader", () => {
  it.effect.each([
    ["note", "MAIN2345", noteSchema],
    ["annotation", "ANNA2345", annotationSchema],
    ["filename", "MAIN2345", filenameSchema],
    ["citation", "MAIN2345", citationSchema],
  ] as const)(
    "serializes fixture data that conforms to the %s schema",
    ([root, key, schema]) =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        const result = yield* runTemplateData(fixture.deps, key, root);
        const validate = new Ajv2020({ strict: true }).compile(schema);

        expect(result.ok).toBe(true);
        expect(
          validate(result.zt),
          JSON.stringify(validate.errors, null, 2),
        ).toBe(true);
      }),
  );

  it.effect("returns the selected annotation at the annotation root", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      const result = yield* runTemplateData(
        fixture.deps,
        "ANNA2345",
        "annotation",
      );

      expect(result).toMatchObject({
        contractVersion: 8,
        command: TEMPLATE_DATA_COMMAND,
        ok: true,
        request: {
          key: "ANNA2345",
          root: "annotation",
          format: "json",
        },
        identity: {
          vault: { name: "Test Vault" },
          source: { id: "a1b2c3d4" },
        },
        zt: {
          key: "ANNA2345",
          indexedKey: "ANNA2345",
          citation: "Fixture citation",
        },
      });
    }),
  );

  it.effect.each([
    {
      error: new InertTemplateError("JavaScript Templates are disabled"),
      compileError: null,
      code: "ETA_OPT_IN_REQUIRED",
    },
    {
      error: new Error("citation cannot compile"),
      compileError: "Unexpected token",
      code: "TEMPLATE_COMPILE_ERROR",
    },
    {
      error: new Error("citation render failed"),
      compileError: null,
      code: "TEMPLATE_RENDER_ERROR",
    },
  ] as const)(
    "returns $code when citation evaluation fails",
    ({ error, compileError, code }) =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture({
          renderError: error,
          compileError,
        });

        expect(
          yield* runTemplateData(fixture.deps, "ANNA2345", "annotation"),
        ).toMatchObject({
          contractVersion: 8,
          command: TEMPLATE_DATA_COMMAND,
          ok: false,
          request: {
            key: "ANNA2345",
            root: "annotation",
            format: "json",
          },
          identity: {
            vault: { name: "Test Vault" },
            source: { id: "a1b2c3d4" },
          },
          diagnostic: {
            code,
            details: { template: "citation" },
          },
        });
      }),
  );

  it.effect("resolves a group-library annotation at the annotation root", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      expect(
        yield* runTemplateData(fixture.deps, "GANN2345g42", "annotation"),
      ).toMatchObject({
        ok: true,
        zt: {
          indexedKey: "GANN2345g42",
          parentItem: { indexedKey: "GRUP2345g42" },
        },
      });
    }),
  );

  it.effect.each(["MAIN2345", "ATCH2345", "NATE2345"])(
    "requires an annotation for selector %s at the annotation root",
    (key) =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();

        expect(
          yield* runTemplateData(fixture.deps, key, "annotation"),
        ).toMatchObject({
          ok: false,
          diagnostic: { code: "ANNOTATION_REQUIRED" },
        });
      }),
  );

  it.effect("distinguishes an unknown annotation selector", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      expect(
        yield* runTemplateData(fixture.deps, "MISS2345", "annotation"),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "KEY_NOT_FOUND" },
      });
    }),
  );

  it.effect("reports an Annotation whose parent Attachment row is absent", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      expect(
        yield* runTemplateData(fixture.deps, "RPHM2345", "annotation"),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "ANNOTATION_ATTACHMENT_MISSING" },
      });
      expect(
        yield* runTemplateData(fixture.deps, "RPHM2345", "note"),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "ANNOTATION_ATTACHMENT_MISSING" },
      });
    }),
  );

  it.effect("serves a standalone annotation with a null parent item", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      const result = yield* runTemplateData(
        fixture.deps,
        "STAN2345",
        "annotation",
      );

      expect(result).toMatchObject({
        ok: true,
        zt: {
          key: "STAN2345",
          parentItem: null,
          citation: null,
        },
      });
      expect(
        yield* runTemplateData(fixture.deps, "STAN2345", "note"),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "NO_PARENT_ITEM" },
      });
      expect(
        yield* runTemplateData(fixture.deps, "STAN2345", "filename"),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: "NO_PARENT_ITEM" },
      });
    }),
  );

  it.effect("returns the Filename Template's single-item data", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      const result = yield* runTemplateData(
        fixture.deps,
        "MAIN2345",
        "filename",
      );

      expect(result).toMatchObject({
        contractVersion: 8,
        command: TEMPLATE_DATA_COMMAND,
        ok: true,
        request: {
          key: "MAIN2345",
          root: "filename",
          format: "json",
        },
        identity: {
          vault: { name: "Test Vault" },
          source: { id: "a1b2c3d4" },
        },
        zt: {
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
        (result.zt as Record<string, unknown>).annotations,
      ).toBeUndefined();
    }),
  );

  it.effect("cites the selected Item alone, with no locator", () =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      const result = yield* runTemplateData(
        fixture.deps,
        "MAIN2345",
        "citation",
      );

      expect(result).toMatchObject({
        command: TEMPLATE_DATA_COMMAND,
        ok: true,
        request: { key: "MAIN2345", root: "citation", format: "json" },
        zt: {
          variant: "main",
          citations: [
            {
              item: { citationKey: "fixture2024", citekey: "fixture2024" },
              locator: null,
              label: null,
              labelShort: "p.",
              suppressAuthor: false,
              prefix: null,
              suffix: null,
            },
          ],
        },
      });
      const zt = result.zt as {
        items: unknown[];
        citations: { item: unknown }[];
      };
      expect(zt.items).toEqual([zt.citations[0]!.item]);
    }),
  );

  it.effect.each(CITATION_EXAMPLE_IDS)(
    "returns the %s example set without reading the database",
    (example) =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();

        const result = yield* runTemplateData(
          fixture.deps,
          { example },
          "citation",
        );

        expect(result).toMatchObject({
          ok: true,
          request: { example, root: "citation", format: "json" },
          zt: { variant: "main" },
        });
        const zt = result.zt as { citations: { item: { citekey: string } }[] };
        expect(zt.citations.length).toBeGreaterThan(0);
        for (const citation of zt.citations) {
          expect(citation.item.citekey).not.toBe("fixture2024");
        }
      }),
  );

  it.effect(
    "cites the journal article and the book for the two-items example",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();

        const result = yield* runTemplateData(
          fixture.deps,
          { example: "two-items" },
          "citation",
        );

        const zt = result.zt as {
          citations: { item: { citekey: string; itemType: string } }[];
        };
        expect(zt.citations.map(({ item }) => item.citekey)).toEqual([
          "ioannidisWhyMost2005",
          "Kahneman2011",
        ]);
        expect(zt.citations.map(({ item }) => item.itemType)).toEqual([
          "journalArticle",
          "book",
        ]);
      }),
  );

  it.effect.each<[string, string]>([
    ["ANNA2345", "MAIN2345"],
    ["ATCH2345", "MAIN2345"],
    ["NATE2345", "MAIN2345"],
    ["GRUP2345g42", "GRUP2345g42"],
  ])("walks selector %s to Item %s at the filename root", ([key, itemKey]) =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();

      expect(
        yield* runTemplateData(fixture.deps, key, "filename"),
      ).toMatchObject({
        ok: true,
        zt: { indexedKey: itemKey },
      });
    }),
  );

  it.effect.each<[string, string]>([
    ["MAIN2345", "MAIN2345"],
    ["ATCH2345", "MAIN2345"],
    ["ANNA2345", "MAIN2345"],
    ["NATE2345", "MAIN2345"],
    ["GRUP2345g42", "GRUP2345g42"],
  ])("builds note data for selector %s from item %s", ([key, itemKey]) =>
    Effect.gen(function* () {
      const fixture = yield* scopedFixture();
      const result = yield* runTemplateData(fixture.deps, key);

      expect(result).toMatchObject({
        ok: true,
        request: { key, root: "note", format: "json" },
        zt: { indexedKey: itemKey },
      });
    }),
  );

  it.effect.each(["FREE2345", "LANE2345"])(
    "rejects standalone child %s",
    (key) =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        expect(yield* runTemplateData(fixture.deps, key)).toMatchObject({
          ok: false,
          diagnostic: { code: "NO_PARENT_ITEM" },
        });
      }),
  );

  it.effect.each(["FREE2345", "LANE2345"])(
    "rejects standalone child %s at the filename root",
    (key) =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();

        expect(
          yield* runTemplateData(fixture.deps, key, "filename"),
        ).toMatchObject({
          ok: false,
          diagnostic: { code: "NO_PARENT_ITEM" },
        });
      }),
  );

  it.effect.each(["MISS2345", "MAIN2345g999"])(
    "reports unresolved selector %s",
    (key) =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();
        expect(yield* runTemplateData(fixture.deps, key)).toMatchObject({
          ok: false,
          diagnostic: { code: "KEY_NOT_FOUND" },
        });
      }),
  );

  it.effect(
    "serializes real inert resolvers without invoking a write surface",
    () =>
      Effect.gen(function* () {
        const fixture = yield* scopedFixture();

        const result = yield* runTemplateData(fixture.deps, "MAIN2345");

        expect(result).toMatchObject({
          ok: true,
          zt: {
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
            notes: [
              {
                noteLink: {
                  $helper: "noteLink",
                  value: "[Child](zotero://select/library/items/NATE2345)",
                },
              },
            ],
          },
        });
        expect(fixture.writeCalls).toEqual([]);
      }),
  );
});

type FixtureDeps = TemplateDataDeps & {
  bridge: { runSync: typeof Effect.runSync };
  templates: TemplateDataDeps["templates"] & {
    compileErrors: ReadonlyMap<string, { message: string }>;
  };
};

/** {@link createFixture}, closed when the test's scope closes. */
const scopedFixture = (options?: Parameters<typeof createFixture>[0]) =>
  Effect.acquireDisposable(
    Effect.tryPromise(async () => createFixture(options)),
  );

function createFixture(options?: {
  renderError?: Error;
  compileError?: string | null;
  render?: (name: string, data: object) => string;
}): {
  deps: FixtureDeps;
  writeCalls: string[];
  [Symbol.asyncDispose](): Promise<void>;
} {
  const client = createClient(":memory:");
  const sqlite = client.$client as DatabaseSync;
  const writeCalls: string[] = [];
  try {
    seed(sqlite);
    sqlite.exec("PRAGMA query_only = ON");
    // The service closes before the database it reads.
    const resources = new AsyncDisposableStack();
    resources.adopt(sqlite, (database) => database.close());
    const zoteroReads = resources.use(
      inProcessReadsService(sharedClientOpener(client)),
    );
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
        zoteroReads,
        noteIndex: {
          getNotesByItemKey: () => [],
          getImportedNoteByNoteKey: () => [],
          whenIndexed: async () => {},
        },
        settings: {
          current: Effect.succeed(settingsDefaults),
        },
        bridge: { runSync: Effect.runSync },
        templates: {
          compileErrors: options?.compileError
            ? new Map([["citation", { message: options.compileError }]])
            : new Map(),
          renderCitation: (refs, variant) => {
            if (options?.renderError) throw options.renderError;
            if (options?.render) {
              return options.render(
                "citation",
                citekeysToCiteTemplateData(refs, variant),
              );
            }
            return "Fixture citation";
          },
          render: (name, data) => {
            if (options?.renderError) throw options.renderError;
            if (options?.render) return options.render(name, data);
            return "Fixture citation\n";
          },
        },
        zoteroPref: {
          dataDir: "/Zotero",
          baseAttachmentPath: null,
        },
      },
      writeCalls,
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function runTemplateData(
  deps: FixtureDeps,
  selector: string | { example: CitationExampleId },
  root: ContractRoot = "note",
): Effect.Effect<Record<string, unknown>, unknown> {
  const handlers = createTemplateWorkbenchHandlers({
    selectNote: async () => ({
      error: "TARGET_NOT_FOUND" as const,
      matches: [],
    }),
    pluginVersion: "1.2.3",
    getIdentity: () => ({
      vault: { name: "Test Vault", path: "/vaults/test" },
      source: { id: "a1b2c3d4", databasePath: "/Zotero/zotero.sqlite" },
    }),
    loadCitation: (citation, variant) =>
      readCitationData(deps, citation, variant),
    loadData: (indexedKey, root) => readTemplateData(deps, indexedKey, root),
    templates: {
      getCitationTemplateStatus: () => ({
        path: "Templates/zotlit-citation.md",
        customized: false,
        language: "liquid" as const,
        inertPath: null,
        compileError: null,
      }),
      renderCitationData: () => "",
      javascriptTemplatesEnabled: false,
      compileErrors: deps.templates.compileErrors,
      getTemplateFileStatuses: () => [],
      getPartialDocument: () => null,
      render: deps.templates.render,
      renderFilename: (data) => deps.templates.render("filename", data),
      analyzeRootVariables: () => null,
      getTemplateSource: async () => "",
      waitUntilSettled: async () => "settled" as const,
    },
    frontmatter: {
      read: () => ({
        fields: [],
        inertKeys: [],
        javascriptTemplatesEnabled: false,
      }),
      evaluate: () => ({ values: {}, errors: {}, inertKeys: [] }),
      validateExpr: () => null,
      write: () => {},
    },
  });
  return handlers[TEMPLATE_DATA_COMMAND]({
    ...(typeof selector === "string" ? { key: selector } : selector),
    root,
    full: "",
    format: "json",
  }).pipe(
    Effect.map((output) => JSON.parse(output) as Record<string, unknown>),
  );
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
      values (10, 'citationKey', 0), (11, 'date', 0), (12, 'extra', 0);
    insert into itemDataValues (valueID, value)
      values (100, 'fixture2024'), (101, '2024-01-02 2024-01-02'), (102, 'tex.mendeley-tags: reading');
    insert into itemData (itemID, fieldID, valueID)
      values (1, 10, 100), (1, 11, 101), (1, 12, 102);

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'MAIN2345'),
        (10, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
        (20, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNA2345'),
        (21, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'STAN2345'),
        (22, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'RPHM2345'),
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
      ),
      (
        22, 999, 1, null, 'orphan', null, '#ffd400', '4',
        '00000|000004|00000', '{"pageIndex":3,"rects":[]}', 0
      );

    insert into itemNotes (itemID, parentItemID, note, title)
      values
        (30, 1, '<p>child</p>', 'Child'),
        (50, null, '<p>standalone</p>', 'Standalone');
  `);
}
