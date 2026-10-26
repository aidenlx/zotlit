// Creation preparation and registry behavior over Profile documents and relational Item rows.

import { it } from "@effect/vitest";
import { Effect, Exit, Fiber } from "effect";
import { TFolder } from "obsidian";
import type { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";

import { formatIndexedKey, getLibraries } from "@zotlit/db";
import type { Item, NoteTemplateContext } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import type { MatchTree } from "@zotlit/templates/facade";
import type { ItemFields } from "@zotlit/zotero-types";

import { testEvents } from "@/lib/__fixtures__/event-stream";
import { testRuntime } from "@/lib/__fixtures__/runtime";
import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { buildQueryService } from "@/services/item-query/__fixtures__";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";
import { Template } from "@/services/template/service";
import type { TestReads } from "@/services/zotero-reads/__fixtures__";
import { listCollectionChoices } from "@/services/zotero-reads/membership";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type { ZoteroReadsEvents } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { noteFeatureHandle } from "./__fixtures__/note-feature";
import type { NoteFeatureSources } from "./__fixtures__/note-feature";
import type { CreationPlanOptions } from "./operations";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    // Rendering context is independent of match facts; all relational matching reads are real.
    buildNoteContextFromSource: vi.fn(
      ({ item }: { item: Item }): NoteTemplateContext =>
        ({
          indexedKey: item.indexedKey,
          citationKey: item.key.toLowerCase(),
          title: item.key,
          notePath: "",
          noteLink: () => "",
          relatedItems: [],
        }) as unknown as NoteTemplateContext,
    ),
  };
});

// `setImmediate` stays real: the in-process ZoteroReads runtime schedules on it.
beforeEach(() =>
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  }),
);
afterEach(() => vi.useRealTimers());
const books = "Bk3Qn7XvT2Lp" as ProfileId;
const papers = "Rz9Wm4YfH6Kd" as ProfileId;
const manual = "Mn4Vb8GhJ2Rt" as ProfileId;

/**
 * My Library (1) and the "Lab Archive" group (2, groupID 118).
 *
 * Collections: My Library holds Project (PROJ0001) > Drafts (DRFT0001) and
 * Other (OTHR0001); the group holds its own Project with the same key
 * PROJ0001.
 *
 * Items: the book BKPA2222 titled BOOK0001 (1) is filed in Drafts and Other, tagged "Read"
 * (manual) and "READ" (automatic); the group book BKGR2222
 * titled BOOK0002 (2) is filed in
 * the group's Project; the article ARTC2222 titled ARTC0001 (3) is filed directly in My
 * Library's Project, tagged "auto-tag" (automatic).
 */
function seed(client: NodeDatabaseClient): void {
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
    insert into groups (groupID, libraryID, name) values (118, 2, 'Lab Archive');
    insert into itemTypes (itemTypeID, typeName) values (1, 'book'), (2, 'journalArticle');
    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'BKPA2222'),
        (2, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 2, 'BKGR2222'),
        (3, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ARTC2222');
    insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key)
      values
        (100, 'Project', null, 1, 'PROJ0001'),
        (101, 'Drafts', 100, 1, 'DRFT0001'),
        (102, 'Other', null, 1, 'OTHR0001'),
        (200, 'Project', null, 2, 'PROJ0001');
    insert into collectionItems (collectionID, itemID)
      values (101, 1), (102, 1), (200, 2), (100, 3);
    insert into tags (tagID, name) values (1, 'Read'), (2, 'READ'), (3, 'auto-tag');
    insert into itemTags (itemID, tagID, type) values (1, 1, 0), (1, 2, 1), (3, 3, 1);
    insert into fieldsCombined (fieldID, fieldName, custom) values (1, 'title', 0);
  `);
  for (const { itemID } of [personalBook, groupBook, article])
    seedTitle(client, itemID, titles[itemID]!);
}

/** Gives a seeded Item its title, which its note filename renders from. */
function seedTitle(client: NodeDatabaseClient, itemID: number, title: string) {
  client.$client.exec(`
    insert into itemDataValues (valueID, value) values (${itemID}, '${title}');
    insert into itemData (itemID, fieldID, valueID) values (${itemID}, 1, ${itemID});
  `);
}

/** Each seeded Item's title, by itemID; a note filename renders from it. */
const titles: Record<number, string> = {
  1: "BOOK0001",
  2: "BOOK0002",
  3: "ARTC0001",
};

const personalBook = item({
  itemID: 1,
  libraryID: 1,
  groupID: null,
  key: "BKPA2222",
  itemType: "book",
});
const groupBook = item({
  itemID: 2,
  libraryID: 2,
  groupID: 118,
  key: "BKGR2222",
  itemType: "book",
});
const article = item({
  itemID: 3,
  libraryID: 1,
  groupID: null,
  key: "ARTC2222",
  itemType: "journalArticle",
});

function item(input: {
  itemID: number;
  libraryID: number;
  groupID: number | null;
  key: string;
  itemType: string;
}): Item {
  return {
    itemID: input.itemID,
    libraryID: input.libraryID,
    groupID: input.groupID,
    key: input.key,
    indexedKey: formatIndexedKey(input.key, input.groupID),
    dateAdded: {} as Item["dateAdded"],
    dateModified: {} as Item["dateModified"],
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    fields: {
      itemType: input.itemType,
      title: titles[input.itemID] ?? input.key,
      citationKey: input.key.toLowerCase(),
    } as ItemFields,
    baseFields: {
      publicationTitle: null,
      publisher: null,
      volume: null,
      issue: null,
      pages: null,
    },
    venue: null,
  };
}

function profileDocument(id: string, match?: MatchTree, extra = ""): string {
  const label = id === books ? "Books" : id === papers ? "Papers" : "Manual";
  return `---
${stringifyYaml({
  id,
  name: label,
  version: "1.0.0",
  contract: 2,
  // A colliding name takes a suffix; a free one renders as the title.
  filename: "{{ zt.title }}{% suffix %}",
  ...(id === "default" ? {} : { folder: id === books ? "Reading" : label }),
  ...(match === undefined ? {} : { match }),
})}${extra}
---
# {{ zt.title }}
{% managed %}DOCUMENT BODY{% endmanaged %}
--- zotlit:annotation ---
Annotation`;
}

async function harness(
  matches: Partial<Record<ProfileId, MatchTree | undefined>> = {},
  extraFiles: Record<string, string> = {},
  { sliceSize }: { sliceSize?: number } = {},
) {
  await using stack = new AsyncDisposableStack();
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  seed(client);
  const zoteroEvents = testEvents<ZoteroReadsEvents>(["changed", "degraded"]);
  // Library Scope reads the Libraries through ZoteroReads, over the same client.
  const readsEvents = {
    runtime: testRuntime(),
    reads: {
      Libraries: () =>
        Effect.suspend(() =>
          readable
            ? Effect.succeed(getLibraries(client))
            : Effect.fail(new DbUnavailable({ message: "Unavailable" })),
        ),
    },
    ...zoteroEvents.streams,
  } as unknown as TestReads;
  let readable = true;
  const fixture = stack.use(
    await profileServiceFixture(
      {
        ...Object.fromEntries(
          Object.entries(matches).map(([id, match]) => [
            `templates/zotlit-profile.${id}.md`,
            profileDocument(id, match),
          ]),
        ),
        ...extraFiles,
      },
      readsEvents,
    ),
  );
  const { app, vault, profile, settings, runtime } = fixture;
  // The Template members the Note Feature reads, on the fixture's service.
  const templateService = runtime.runSync(Template);
  const template: NoteFeatureSources["template"] = {
    render: (name, data) => runtime.runSync(templateService.render(name, data)),
    renderManagedContent: (data) =>
      runtime.runSync(templateService.renderManagedContent(data)),
    renderFilename: (data) =>
      runtime.runSync(templateService.renderFilename(data)),
    getLiteratureNoteTemplate: (reference) =>
      runtime.runSync(templateService.getLiteratureNoteTemplate(reference)),
    get frontmatterFields() {
      return runtime.runSync(templateService.frontmatterFields);
    },
  };
  const root = new TFolder();
  root.path = "";
  Object.assign(app.vault, {
    getRoot: () => root,
    createFolder: (path: string) => {
      const folder = new TFolder();
      folder.path = path;
      vault.folders.set(path, folder);
      return Promise.resolve(folder);
    },
  });
  const notesByKey = new Map<string, TFile[]>();
  const create = vault.create.bind(vault);
  vault.create = async (path, content) => {
    const file = await create(path, content);
    const indexedKey =
      app.metadataCache.getFileCache(file)?.frontmatter?.[FIELD_ZOTERO_KEY];
    if (indexedKey)
      notesByKey.set(indexedKey, [...(notesByKey.get(indexedKey) ?? []), file]);
    return file;
  };
  app.fileManager.generateMarkdownLink = () => "";
  const zoteroReads = inProcessReadsService(sharedClientOpener(client), {
    handlers: { sliceSize },
  });
  // ZotLit Query tests the Profile Matches over the same database.
  const { service: query } = await buildQueryService(
    {
      reads: zoteroReads.reads,
      source: {
        sourceId: "membership",
        databasePath: ":memory:",
        dataDir: "/zotero",
        baseAttachmentPath: "/zotero/linked",
      },
      effective: () => fixture.libraryScope.effective,
      vaultName: "Membership tests",
      basePath: "/vault",
    },
    stack,
  );
  const noteIndex: NoteFeatureSources["noteIndex"] = {
    whenIndexed: async () => {},
    getNotesByItemKey: (key) => notesByKey.get(key) ?? [],
    getImportedNoteByNoteKey: () => [],
  };
  const deps: NoteFeatureSources = {
    app,
    zoteroReads,
    profile,
    template,
    settings,
    noteIndex,
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    attachmentImport: {
      prepare: () =>
        Effect.succeed({
          decide: (path, origin) => ({
            approved: false,
            path,
            origin,
            reason: "no-trusted-root",
          }),
          resolveLink: () => () => "",
          discard: Effect.void,
          flush: Effect.succeed({
            copied: 0,
            skipped: 0,
            missing: 0,
            blocked: 0,
            refused: 0,
          }),
        }),
    },
  };
  const { service } = noteFeatureHandle(deps, stack, { query });
  const cleanup = stack.move();
  return {
    ...fixture,
    template,
    client,
    deps,
    query,
    /** The Note Feature service. */
    feature: service,
    /** The creation Profile `planCreations` selects for `item`. */
    select: (item: Item, sources?: CreationPlanOptions) =>
      service
        .planCreations([item.indexedKey], sources)
        .pipe(Effect.map((plans) => plans.get(item.indexedKey)!.selection)),
    /** Each selectable Profile's creation preview for `item`. */
    previews: (item: Item) =>
      service
        .planCreations([item.indexedKey])
        .pipe(Effect.map((plans) => plans.get(item.indexedKey)!.previews)),
    refreshLibraries: async () => {
      zoteroEvents.emit("changed");
      await vi.advanceTimersByTimeAsync(0);
    },
    setReadable: async (next: boolean) => {
      readable = next;
      if (next) {
        zoteroEvents.emit("changed");
      } else {
        zoteroEvents.emit(
          "degraded",
          new DbUnavailable({ message: "Unavailable" }),
        );
      }
      await vi.advanceTimersByTimeAsync(0);
    },
    async editMatch(id: ProfileId, match?: MatchTree) {
      vault.modifyFile(
        `templates/zotlit-profile.${id}.md`,
        profileDocument(id, match),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(await fixture.template.waitUntilSettled(5000)).toBe("settled");
    },
    async deleteProfile(id: ProfileId) {
      vault.deleteFile(`templates/zotlit-profile.${id}.md`);
      await vi.advanceTimersByTimeAsync(500);
    },
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

/** The harness `open` makes, disposed when the case's Scope closes. */
const acquire = <H extends AsyncDisposable>(open: () => Promise<H>) =>
  Effect.acquireDisposable(Effect.promise(() => open()));

describe("Profile document matches at creation preparation", () => {
  it.effect(
    "reads the Library, exact Tag names, and full Collection paths from relational rows",
    () =>
      Effect.gen(function* () {
        const empty = yield* acquire(() => harness());
        expect(yield* empty.select(personalBook)).toEqual({
          selector: "default",
          source: "bound",
          shouldAsk: false,
        });
        const f = yield* acquire(() =>
          harness({
            [books]:
              'library == "personal" && itemType == "book" && tags.containsAll("Read", "READ") && collections.contains("Project/Drafts") && collections.contains("Other")',
            [papers]:
              'library == "group:118" && tags.isEmpty() && collections.contains("Project")',
          }),
        );
        expect(yield* f.select(personalBook)).toMatchObject({
          selector: books,
          source: "match",
        });
        expect(yield* f.select(groupBook)).toMatchObject({
          selector: papers,
          source: "match",
        });
      }),
  );

  it.effect(
    "selects each Item independently, exposes overlap candidates, and lets manual and explicit inputs win",
    () =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({
            [books]:
              'library == "personal" && tags.contains("Read") && collections.within("Project")',
            [papers]: 'library == "group:118"',
            [manual]: undefined,
          }),
        );
        const plans = yield* f.feature.planCreations(
          [personalBook, groupBook, article].map(
            ({ indexedKey }) => indexedKey,
          ),
        );
        expect([...plans.values()].map(({ selection }) => selection)).toEqual([
          {
            selector: books,
            source: "match",
            shouldAsk: false,
            reason: m.profile_match_selected({ profile: "Books" }),
          },
          {
            selector: papers,
            source: "match",
            shouldAsk: false,
            reason: m.profile_match_selected({ profile: "Papers" }),
          },
          { selector: "default", source: "bound", shouldAsk: true },
        ]);
        const pathOf = (item: Item, selector: ProfileId) =>
          plans
            .get(item.indexedKey)
            ?.previews.find((preview) => preview.selector === selector)?.path;
        expect(pathOf(personalBook, books)).toBe("Reading/BOOK0001.md");
        expect(pathOf(groupBook, papers)).toBe("Papers/BOOK0002.md");
        yield* Effect.promise(() => f.editMatch(papers, 'itemType == "book"'));
        const overlap = yield* f.select(personalBook);
        expect(overlap).toMatchObject({
          source: "bound",
          shouldAsk: true,
          problem: { kind: "overlap" },
        });
        expect(
          overlap.problem?.kind === "overlap" &&
            overlap.problem.candidates.map(({ id }) => id),
        ).toEqual([books, papers]);
        expect(yield* f.select(personalBook, { headless: manual })).toEqual({
          selector: manual,
          source: "headless",
          shouldAsk: true,
        });
        expect(
          yield* f.select(personalBook, { headless: books, asked: "default" }),
        ).toEqual({ selector: "default", source: "asked", shouldAsk: true });
        yield* Effect.promise(() =>
          f.editMatch(manual, 'library == "group:999"'),
        );
        expect(
          yield* f.select(personalBook, { asked: manual, headless: papers }),
        ).toEqual({ selector: manual, source: "asked", shouldAsk: true });
        expect(
          yield* f.select(personalBook, { headless: manual }),
        ).toMatchObject({
          selector: manual,
          source: "headless",
        });
        expect((yield* f.select(personalBook)).problem?.kind).toBe("overlap");
      }),
  );

  // #1642: a batch reads its Items, facets, and Matches together, not per Item.
  describe("plans a batch of creations", () => {
    /** Twelve My Library books titled "Shared"; every third is tagged "Read". */
    const shared = Array.from({ length: 12 }, (_, index) =>
      item({
        itemID: 1000 + index,
        libraryID: 1,
        groupID: null,
        key: `SHRD${"23456789ABCD"[index]}222`,
        itemType: "book",
      }),
    );
    const tagged = new Set([1000, 1003, 1006, 1009]);
    const unknownKey = "GNE22222";
    const keys = [
      groupBook.indexedKey,
      ...shared.map(({ indexedKey }) => indexedKey),
      unknownKey,
    ];

    async function batchHarness() {
      // Four Items a slice, so the facets of the batch arrive in several.
      const f = await harness(
        {
          [books]: 'tags.contains("Read")',
          [papers]: 'library == "group:118"',
        },
        {},
        { sliceSize: 4 },
      );
      for (const { itemID, key } of shared) {
        f.client.$client.exec(
          `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values (${itemID}, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, '${key}');`,
        );
        seedTitle(f.client, itemID, "Shared");
        if (tagged.has(itemID))
          f.client.$client.exec(
            `insert into itemTags (itemID, tagID, type) values (${itemID}, 1, 0);`,
          );
      }
      return f;
    }

    it.effect("selects each Item's Profile from one Match query", () =>
      Effect.gen(function* () {
        const f = yield* acquire(() => batchHarness());
        const run = vi.spyOn(f.query, "run");

        const plans = yield* f.feature.planCreations(keys);

        expect(run).toHaveBeenCalledTimes(1);
        expect([...plans.keys()]).toEqual(keys);
        expect(plans.get(groupBook.indexedKey)?.selection).toMatchObject({
          selector: papers,
          source: "match",
        });
        for (const { itemID, indexedKey } of shared)
          expect(plans.get(indexedKey)?.selection).toEqual(
            tagged.has(itemID)
              ? {
                  selector: books,
                  source: "match",
                  shouldAsk: false,
                  reason: m.profile_match_selected({ profile: "Books" }),
                }
              : { selector: "default", source: "bound", shouldAsk: true },
          );
        // A key the database lacks has no Item to match or preview.
        expect(plans.get(unknownKey)).toEqual({
          item: undefined,
          selection: { selector: "default", source: "bound", shouldAsk: true },
          previews: [],
        });
        const headless = yield* f.feature.planCreations(keys, {
          headless: books,
        });
        expect(
          new Set([...headless.values()].map(({ selection }) => selection)),
        ).toEqual(
          new Set([{ selector: books, source: "headless", shouldAsk: true }]),
        );
      }),
    );

    it.effect(
      "reserves each path across slices and resolves each document once",
      () =>
        Effect.gen(function* () {
          const f = yield* acquire(() => batchHarness());
          const documents = vi.spyOn(f.template, "getLiteratureNoteTemplate");
          yield* f.feature.planCreations([shared[0]!.indexedKey]);
          const perPlan = documents.mock.calls.length;
          documents.mockClear();

          const plans = yield* f.feature.planCreations(keys);

          expect(documents).toHaveBeenCalledTimes(perPlan);
          const paths = shared.map(
            ({ indexedKey }) =>
              plans
                .get(indexedKey)
                ?.previews.find(({ selector }) => selector === books)?.path,
          );
          expect(paths[0]).toBe("Reading/Shared.md");
          expect(
            paths.every((path) => path?.startsWith("Reading/Shared")),
          ).toBe(true);
          expect(new Set(paths).size).toBe(shared.length);
        }),
    );

    it.effect("ends an interrupted plan before it reads", () =>
      Effect.gen(function* () {
        const f = yield* acquire(() => batchHarness());
        const run = vi.spyOn(f.query, "run");
        const plan = yield* f.feature
          .planCreations(keys)
          .pipe(Effect.forkChild);
        const exit = yield* Fiber.interrupt(plan).pipe(
          Effect.andThen(Fiber.await(plan)),
        );
        expect(Exit.hasInterrupts(exit)).toBe(true);
        expect(run).not.toHaveBeenCalled();
      }),
    );
  });

  it.effect(
    "distinguishes absent, catch-all, and evaluable empty-any registry states",
    () =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({
            [books]: undefined,
            [papers]: { and: [] },
            [manual]: { or: [] },
          }),
        );
        expect(
          f.profile.profiles.map(({ id, match }) => [
            id,
            match.state,
            match.summary,
          ]),
        ).toEqual([
          [books, "absent", m.profile_match_absent()],
          [manual, "evaluable", "false"],
          [papers, "all", m.profile_match_all()],
        ]);
        expect(yield* f.select(article)).toMatchObject({
          selector: papers,
          source: "match",
        });
        yield* Effect.promise(() => f.editMatch(papers, "true"));
        expect(
          f.profile.profiles.find(({ id }) => id === papers)?.match.state,
        ).toBe("all");
        yield* Effect.promise(() => f.editMatch(papers, undefined));
        expect(yield* f.select(article)).toEqual({
          selector: "default",
          source: "bound",
          shouldAsk: true,
        });
      }),
  );

  it.effect.each([
    ["a syntax mistake", "library =="],
    ["a blank condition", " "],
  ] as const)(
    "keeps the document with %s active, shows its diagnostic, and skips it for every Item",
    ([, match]) =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({
            [books]: { or: ["true", match] },
            [papers]: 'library == "group:118"',
          }),
        );
        const entry = f.profile.profiles.find(({ id }) => id === books)!;
        expect(entry.match.state).toBe("unevaluable");
        const problem =
          entry.match.state === "unevaluable" ? entry.match.problem : "";
        expect(problem).not.toBe("");
        expect(entry.match.summary).toBe(m.profile_match_problem({ problem }));
        expect(f.profile.diagnostics).toEqual([]);
        expect(yield* f.select(personalBook)).toEqual({
          selector: "default",
          source: "bound",
          shouldAsk: true,
        });
        expect(yield* f.select(groupBook)).toMatchObject({
          selector: papers,
          source: "match",
        });
        expect(yield* f.select(groupBook, { headless: books })).toMatchObject({
          selector: books,
          source: "headless",
        });
      }),
  );

  it.effect.each([
    'library == "group:2"',
    'itemType == "novel"',
    'shelfMark == "A1"',
  ])("reads %s as a Match that holds for no Item", (match) =>
    Effect.gen(function* () {
      const f = yield* acquire(() => harness({ [books]: match }));
      expect(f.profile.profiles[0]?.match.state).toBe("evaluable");
      for (const item of [personalBook, groupBook, article])
        expect(yield* f.select(item)).toMatchObject({
          selector: "default",
          source: "bound",
        });
    }),
  );

  it.effect("tests any Item field", () =>
    Effect.gen(function* () {
      const f = yield* acquire(() => harness({ [books]: 'key == "BKPA2222"' }));
      expect(yield* f.select(personalBook)).toMatchObject({
        selector: books,
        source: "match",
      });
      expect(yield* f.select(article)).toMatchObject({ source: "bound" });
    }),
  );

  it.effect("asks for the Profile when ZotLit Query cannot read the Item", () =>
    Effect.gen(function* () {
      const f = yield* acquire(() =>
        harness({
          [books]: "true",
          [papers]: 'itemType == "book"',
        }),
      );
      // With the query, Books and Papers both match the book.
      expect(yield* f.select(personalBook)).toMatchObject({
        shouldAsk: true,
        problem: { kind: "overlap" },
      });
      vi.spyOn(f.query, "run").mockReturnValue(
        Effect.succeed({ kind: "cancelled" }),
      );
      // Without it, the catch-all Books does not take the Item alone.
      expect(yield* f.select(personalBook)).toEqual({
        selector: "default",
        source: "bound",
        shouldAsk: true,
      });
    }),
  );

  it.effect(
    "excludes Default with match, failed manifests, and colliding documents from selection",
    () =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness(
            { [books]: "true" },
            {
              "templates/zotlit-profile.default.md": profileDocument(
                "default",
                "true",
              ),
              "templates/zotlit-profile.duplicate.md": profileDocument(
                books,
                "true",
              ),
              "templates/zotlit-profile.invalid.md": profileDocument(
                papers,
                "true",
                "unknown: true",
              ),
            },
          ),
        );
        expect(f.profile.profiles).toEqual([]);
        expect(f.profile.resolveProfile("default")).toBeUndefined();
        expect(f.profile.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: "templates/zotlit-profile.default.md",
              message: expect.stringContaining(
                "Default Profile carries no match",
              ),
            }),
            expect.objectContaining({
              path: "templates/zotlit-profile.duplicate.md",
              code: "duplicate-profile-id",
            }),
            expect.objectContaining({
              path: "templates/zotlit-profile.invalid.md",
              code: "invalid-profile-document",
            }),
          ]),
        );
        expect(yield* f.select(personalBook)).toMatchObject({
          source: "bound",
        });
      }),
  );

  it.effect(
    "uses Collection paths in both Libraries and separates descendant from direct filing",
    () =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({ [books]: 'collections.within("Project")' }),
        );
        for (const item of [personalBook, groupBook, article])
          expect(yield* f.select(item)).toMatchObject({
            selector: books,
            source: "match",
          });
        yield* Effect.promise(() =>
          f.editMatch(books, 'collections.contains("Project")'),
        );
        expect(yield* f.select(personalBook)).toMatchObject({
          source: "bound",
        });
        expect(yield* f.select(article)).toMatchObject({ selector: books });
        yield* Effect.promise(() =>
          f.editMatch(books, 'collections.contains("Other")'),
        );
        expect(yield* f.select(personalBook)).toMatchObject({
          selector: books,
        });
        expect(yield* f.select(groupBook)).toMatchObject({ source: "bound" });
      }),
  );

  it.effect(
    "uses renamed and trashed Collections as current facts; unknown paths stay evaluable nonmatches",
    () =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({ [books]: 'collections.within("Gone")' }),
        );
        expect(f.profile.profiles[0]?.match.state).toBe("evaluable");
        expect(yield* f.select(personalBook)).toMatchObject({
          source: "bound",
        });
        yield* Effect.promise(() =>
          f.editMatch(books, 'collections.contains("Project/Drafts")'),
        );
        f.client.$client.exec(
          "update collections set collectionName = 'Manuscripts' where collectionID = 101",
        );
        expect(yield* f.select(personalBook)).toMatchObject({
          source: "bound",
        });
        expect(
          listCollectionChoices(f.client, f.libraryScope.libraries).map(
            ({ path }) => path.join("/"),
          ),
        ).toContain("Project/Manuscripts");
        yield* Effect.promise(() =>
          f.editMatch(books, 'collections.within("Project")'),
        );
        f.client.$client.exec(
          "insert into deletedCollections (collectionID) values (100)",
        );
        expect(yield* f.select(personalBook)).toMatchObject({
          source: "bound",
        });
        expect(yield* f.select(groupBook)).toMatchObject({ selector: books });
      }),
  );

  it.effect.each([
    [personalBook, 'tags.contains("Read")'],
    [personalBook, 'tags.contains("READ")'],
  ] as const)(
    "creates with the Profile selected by exact manual or automatic Tag names",
    ([item, match]) =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({
            [books]: match,
            [papers]: 'tags.contains("read")',
          }),
        );
        const selection = yield* f.select(item);
        expect(selection).toMatchObject({ selector: books, source: "match" });
        const preview = (yield* f.previews(item)).find(
          ({ selector }) => selector === selection.selector,
        )!;
        expect(yield* preview.create()).toMatchObject({
          outcome: "created",
          file: { path: `Reading/${titles[item.itemID]}.md` },
        });
        expect(
          f.vault.contents.get(`Reading/${titles[item.itemID]}.md`),
        ).toContain(`${FIELD_LITERATURE_NOTE_PROFILE}: Books (${books})`);
      }),
  );

  it.effect(
    "expresses precedence through disjoint alternatives and exclusions",
    () =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({
            [papers]: {
              and: [
                'library == "personal"',
                {
                  or: [
                    'collections.within("Project")',
                    'tags.contains("auto-tag")',
                  ],
                },
                'itemType != "book"',
              ],
            },
            [books]: '!(tags.contains("Read") || itemType == "journalArticle")',
            [manual]:
              'tags.contains("READ") && !collections.contains("Project")',
          }),
        );
        const selections = yield* Effect.forEach(
          [article, groupBook, personalBook],
          (item) => f.select(item),
        );
        expect(selections.map(({ selector }) => selector)).toEqual([
          papers,
          books,
          manual,
        ]);
      }),
  );

  it.effect(
    "freezes the preview across match and Item edits, and keeps existing note membership",
    () =>
      Effect.gen(function* () {
        const f = yield* acquire(() =>
          harness({
            [books]: 'tags.contains("Read") && collections.contains("Other")',
            [papers]: 'itemType == "journalArticle"',
          }),
        );
        const selection = yield* f.select(personalBook);
        const preview = (yield* f.previews(personalBook)).find(
          ({ selector }) => selector === selection.selector,
        )!;
        expect(preview.path).toBe("Reading/BOOK0001.md");
        yield* Effect.promise(() => f.editMatch(books, 'itemType == "thesis"'));
        yield* Effect.promise(() => f.editMatch(papers, 'itemType == "book"'));
        f.client.$client.exec(
          "delete from itemTags where itemID = 1; delete from collectionItems where itemID = 1",
        );
        expect(selection).toMatchObject({
          selector: books,
          reason: m.profile_match_selected({ profile: "Books" }),
        });
        const created = yield* preview.create();
        expect(created).toMatchObject({
          outcome: "created",
          file: { path: "Reading/BOOK0001.md" },
        });
        expect(yield* f.select(personalBook)).toMatchObject({
          selector: papers,
        });
        expect(
          created.outcome === "created" && f.profile.profileOf(created.file),
        ).toMatchObject({ ok: true, profile: { selector: books } });
        expect(
          yield* f.feature.createNote(personalBook, { profile: papers }),
        ).toMatchObject({
          outcome: "refused",
          diagnostic: { code: "literature-note-exists" },
        });
        expect(f.vault.contents.get("Reading/BOOK0001.md")).toContain(
          `${FIELD_LITERATURE_NOTE_PROFILE}: Books (${books})`,
        );
        expect(f.vault.contents.has("Papers/BOOK0001.md")).toBe(false);
      }),
  );

  it.effect("stops a prepared write if its Profile document disappears", () =>
    Effect.gen(function* () {
      const f = yield* acquire(() => harness({ [books]: "true" }));
      const preview = (yield* f.previews(personalBook)).find(
        ({ selector }) => selector === books,
      )!;
      yield* Effect.promise(() => f.deleteProfile(books));
      expect(yield* preview.create()).toMatchObject({
        outcome: "refused",
        diagnostic: { code: "unknown-literature-note-profile" },
      });
      expect(f.vault.contents.has("Reading/BOOK0001.md")).toBe(false);
    }),
  );
});
