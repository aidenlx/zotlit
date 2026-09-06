// Creation preparation and registry behavior over Profile documents and relational Item rows.
import type { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { Item, NoteTemplateContext } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { createNanoEvents } from "@zotlit/shared/nanoevents";
import type { MatchTree } from "@zotlit/templates/facade";
import type { ItemFields } from "@zotlit/zotero-types";

import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { DatabaseError } from "@/services/database/service";
import type {
  DatabaseEvents,
  DatabaseService,
} from "@/services/database/service";
import {
  listCollectionChoices,
  resolveMembershipFacts,
  matchItem,
} from "@/services/profile-selection";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

import type { SyncRenderDeps } from "./context";
import { createNoteFeature } from "./operations";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    // Rendering context is independent of match facts; all relational matching reads are real.
    fetchNoteContext: vi.fn(
      (_client: unknown, item: Item): NoteTemplateContext =>
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

beforeEach(() => vi.useFakeTimers());
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
 * Items: the book BOOK0001 (1) is filed in Drafts and Other, tagged "Read"
 * (manual) and "READ" (automatic); the group book BOOK0002 (2) is filed in
 * the group's Project; the article ARTC0001 (3) is filed directly in My
 * Library's Project, tagged "auto-tag" (automatic).
 */
function seed(client: NodeDatabaseClient): void {
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
    insert into groups (groupID, libraryID, name) values (118, 2, 'Lab Archive');
    insert into itemTypes (itemTypeID, typeName) values (1, 'book'), (2, 'journalArticle');
    insert into items (itemID, itemTypeID, libraryID, key)
      values (1, 1, 1, 'BOOK0001'), (2, 1, 2, 'BOOK0002'), (3, 2, 1, 'ARTC0001');
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
  `);
}

const personalBook = item({
  itemID: 1,
  libraryID: 1,
  groupID: null,
  key: "BOOK0001",
  itemType: "book",
});
const groupBook = item({
  itemID: 2,
  libraryID: 2,
  groupID: 118,
  key: "BOOK0002",
  itemType: "book",
});
const article = item({
  itemID: 3,
  libraryID: 1,
  groupID: null,
  key: "ARTC0001",
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
    indexedKey: input.key,
    dateAdded: {} as Temporal.Instant,
    dateModified: {} as Temporal.Instant,
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    fields: {
      itemType: input.itemType,
      title: input.key,
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
  filename: "{{ zt.title }}",
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
) {
  await using stack = new AsyncDisposableStack();
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  seed(client);
  const events = createNanoEvents<DatabaseEvents>();
  let readable = true;
  const db = {
    ready: Promise.resolve(),
    get state() {
      return readable ? ("ready" as const) : ("degraded" as const);
    },
    client,
    acquireRead: async () => ({ client, [Symbol.dispose]() {} }),
    on: events.on.bind(events),
  };
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
      db as DatabaseService,
    ),
  );
  const { app, vault, profile, template, settings } = fixture;
  const notesByKey = new Map<string, TFile[]>();
  app.metadataCache.getFileCache = (file) => {
    const text = vault.contents.get(file.path) ?? "";
    return text.startsWith("---\n")
      ? { frontmatter: parseYaml(text.split("---\n")[1]!) }
      : null;
  };
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
  app.fileManager.processFrontMatter = async (file, update) => {
    const data = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    update(data);
    const source = vault.contents.get(file.path)!;
    vault.modifyFile(
      file.path,
      `---\n${stringifyYaml(data)}---\n${source.slice(source.indexOf("---\n", 4) + 4)}`,
    );
  };
  const deps: SyncRenderDeps = {
    app,
    db,
    profile,
    template,
    settings,
    noteIndex: {
      ready: Promise.resolve(),
      whenIndexed: async () => {},
      getNotesByItemKey: (key) => notesByKey.get(key) ?? [],
      getImportedNoteByNoteKey: () => [],
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    attachmentImport: {
      prepare: async () => ({
        decide: (path, origin) => ({
          approved: false,
          path,
          origin,
          reason: "no-trusted-root",
        }),
        resolveLink: () => () => "",
        flush: async () => ({
          copied: 0,
          skipped: 0,
          missing: 0,
          blocked: 0,
          refused: 0,
        }),
      }),
    },
    noteImport: {
      prepare: async () => ({
        resolveChildNote: () => ({
          key: "",
          indexedKey: "",
          title: null,
          noteLink: () => "",
        }),
        flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
      }),
    },
  };
  const cleanup = stack.move();
  return {
    ...fixture,
    client,
    deps,
    feature: createNoteFeature(deps),
    refreshLibraries: () => events.emit("changed"),
    setReadable: (next: boolean) => {
      readable = next;
      if (next) events.emit("changed");
      else events.emit("degraded", new DatabaseError("Unavailable"));
    },
    async editMatch(id: ProfileId, match?: MatchTree) {
      vault.modifyFile(
        `templates/zotlit-profile.${id}.md`,
        profileDocument(id, match),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(await template.waitUntilSettled(5000)).toBe("settled");
    },
    [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
  };
}

describe("Profile document matches at creation preparation", () => {
  it("resolves Library selectors, exact Tag names, and full Collection paths from relational rows", async () => {
    await using f = await harness();
    expect(
      matchItem(personalBook, resolveMembershipFacts(f.client, personalBook)),
    ).toEqual({
      library: { type: "personal" },
      itemType: "book",
      tags: expect.arrayContaining(["Read", "READ"]),
      collections: [["Project", "Drafts"], ["Other"]],
    });
    expect(
      matchItem(groupBook, resolveMembershipFacts(f.client, groupBook)),
    ).toEqual({
      library: { type: "group", groupID: 118 },
      itemType: "book",
      tags: [],
      collections: [["Project"]],
    });
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toEqual({ selector: "default", source: "bound", shouldAsk: false });
  });

  it("selects each Item independently, exposes overlap candidates, and lets manual and explicit inputs win", async () => {
    await using f = await harness({
      [books]:
        'library == "personal" && tags.contains("Read") && collections.within("Project")',
      [papers]: 'library == "group:118"',
      [manual]: undefined,
    });
    const selections = await Promise.all(
      [personalBook, groupBook, article].map((item) =>
        f.feature.resolveCreationProfile({ item }),
      ),
    );
    expect(selections).toEqual([
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
    const plans = await f.feature.prepareBatchCreationProfiles([
      personalBook,
      groupBook,
      article,
    ]);
    expect(plans.get(1)?.find(({ selector }) => selector === books)?.path).toBe(
      "Reading/BOOK0001.md",
    );
    expect(
      plans.get(2)?.find(({ selector }) => selector === papers)?.path,
    ).toBe("Papers/BOOK0002.md");
    await f.editMatch(papers, 'itemType == "book"');
    const overlap = await f.feature.resolveCreationProfile({
      item: personalBook,
    });
    expect(overlap).toMatchObject({
      source: "bound",
      shouldAsk: true,
      problem: { kind: "overlap" },
    });
    expect(
      overlap.problem?.kind === "overlap" &&
        overlap.problem.candidates.map(({ id }) => id),
    ).toEqual([books, papers]);
    expect(
      await f.feature.resolveCreationProfile({
        item: personalBook,
        headless: manual,
      }),
    ).toEqual({ selector: manual, source: "headless", shouldAsk: true });
    expect(
      await f.feature.resolveCreationProfile({
        item: personalBook,
        headless: books,
        asked: "default",
      }),
    ).toEqual({ selector: "default", source: "asked", shouldAsk: true });
    await f.editMatch(manual, 'library == "group:999"');
    expect(
      await f.feature.resolveCreationProfile({
        item: personalBook,
        asked: manual,
        headless: papers,
      }),
    ).toEqual({ selector: manual, source: "asked", shouldAsk: true });
    expect(
      await f.feature.resolveCreationProfile({
        item: personalBook,
        headless: manual,
      }),
    ).toMatchObject({ selector: manual, source: "headless" });
    expect(
      (await f.feature.resolveCreationProfile({ item: personalBook })).problem
        ?.kind,
    ).toBe("overlap");
  });

  it("distinguishes absent, catch-all, evaluable empty-any, and unevaluable registry states", async () => {
    await using f = await harness({
      [books]: undefined,
      [papers]: { and: [] },
      [manual]: { or: [] },
    });
    expect(
      f.profile.profiles.map(({ id, match }) => [
        id,
        match.state,
        match.summary,
      ]),
    ).toEqual([
      [books, "absent", m.profile_match_absent()],
      [manual, "evaluable", m.profile_match_none()],
      [papers, "all", m.profile_match_all()],
    ]);
    expect(
      await f.feature.resolveCreationProfile({ item: article }),
    ).toMatchObject({ selector: papers, source: "match" });
    await f.editMatch(papers, "true");
    expect(
      f.profile.profiles.find(({ id }) => id === papers)?.match.state,
    ).toBe("all");
    await f.editMatch(papers, undefined);
    expect(await f.feature.resolveCreationProfile({ item: article })).toEqual({
      selector: "default",
      source: "bound",
      shouldAsk: true,
    });
  });

  it.each([
    [
      'library == "group:2"',
      "unknown-library",
      () => m.profile_rule_problem_unknown_library({ text: '"group:2"' }),
    ],
    [
      'library != "group:999"',
      "unknown-library",
      () => m.profile_rule_problem_unknown_library({ text: '"group:999"' }),
    ],
    [
      'itemType == "novel"',
      "unknown-item-type",
      () => m.profile_rule_problem_unknown_item_type({ text: '"novel"' }),
    ],
    ["library ==", "syntax", () => m.profile_rule_problem_syntax({ text: "" })],
    [
      'title == "BOOK0001"',
      "unsupported",
      () => m.profile_rule_problem_unsupported({ text: 'title == "BOOK0001"' }),
    ],
    [" ", "empty", () => m.profile_rule_problem_empty()],
  ] as const)(
    "keeps the document with %s active, shows its diagnostic, and skips it for every Item",
    async (match, code, problem) => {
      await using f = await harness({
        [books]: { or: ["true", match] },
        [papers]: 'library == "group:118"',
      });
      const entry = f.profile.profiles.find(({ id }) => id === books)!;
      expect(entry.match).toMatchObject({
        state: "unevaluable",
        problem: { code },
      });
      expect(entry.match.summary).toBe(
        m.profile_match_problem({ problem: problem() }),
      );
      expect(f.profile.diagnostics).toEqual([]);
      expect(
        await f.feature.resolveCreationProfile({ item: personalBook }),
      ).toEqual({ selector: "default", source: "bound", shouldAsk: true });
      expect(
        await f.feature.resolveCreationProfile({ item: groupBook }),
      ).toMatchObject({ selector: papers, source: "match" });
      expect(
        await f.feature.resolveCreationProfile({
          item: groupBook,
          headless: books,
        }),
      ).toMatchObject({ selector: books, source: "headless" });
    },
  );

  it("excludes Default with match, failed manifests, and colliding documents from selection", async () => {
    await using f = await harness(
      { [books]: "true" },
      {
        "templates/zotlit-profile.default.md": profileDocument(
          "default",
          "true",
        ),
        "templates/zotlit-profile.duplicate.md": profileDocument(books, "true"),
        "templates/zotlit-profile.invalid.md": profileDocument(
          papers,
          "true",
          "unknown: true",
        ),
      },
    );
    expect(f.profile.profiles).toEqual([]);
    expect(f.profile.resolveProfile("default")).toBeUndefined();
    expect(f.profile.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "templates/zotlit-profile.default.md",
          message: expect.stringContaining("Default Profile carries no match"),
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
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ source: "bound" });
  });

  it("recompiles when an unselected Library appears, is renamed, disappears, or becomes unavailable", async () => {
    await using f = await harness({ [books]: 'library == "group:999"' });
    f.settings.update({
      "zotero.library-scope": {
        mode: "selected",
        libraries: [{ type: "personal" }],
      },
    });
    const selected = f.libraryScope.current;
    expect(f.profile.profiles[0]?.match).toMatchObject({
      state: "unevaluable",
      problem: { code: "unknown-library" },
    });
    f.client.$client.exec(
      "insert into libraries (libraryID, type) values (9, 'group'); insert into groups (groupID, libraryID, name) values (999, 9, 'Remote team')",
    );
    f.refreshLibraries();
    expect(f.libraryScope.current).toBe(selected);
    expect(f.profile.profiles[0]?.match).toMatchObject({
      state: "evaluable",
      summary: m.settings_profile_rule_library_is({ library: "Remote team" }),
    });
    f.client.$client.exec(
      "update groups set name = 'Research team' where groupID = 999",
    );
    f.refreshLibraries();
    expect(f.libraryScope.current).toBe(selected);
    expect(f.profile.profiles[0]?.match.summary).toContain("Research team");
    f.setReadable(false);
    expect(f.profile.profiles[0]?.match.state).toBe("unevaluable");
    f.setReadable(true);
    expect(f.profile.profiles[0]?.match.state).toBe("evaluable");
    f.client.$client.exec(
      "delete from groups where groupID = 999; delete from libraries where libraryID = 9",
    );
    f.refreshLibraries();
    expect(f.profile.profiles[0]?.match.state).toBe("unevaluable");
  });

  it("uses Collection paths in both Libraries and separates descendant from direct filing", async () => {
    await using f = await harness({ [books]: 'collections.within("Project")' });
    for (const item of [personalBook, groupBook, article])
      expect(await f.feature.resolveCreationProfile({ item })).toMatchObject({
        selector: books,
        source: "match",
      });
    await f.editMatch(books, 'collections.contains("Project")');
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ source: "bound" });
    expect(
      await f.feature.resolveCreationProfile({ item: article }),
    ).toMatchObject({ selector: books });
    await f.editMatch(books, 'collections.contains("Other")');
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: books });
    expect(
      await f.feature.resolveCreationProfile({ item: groupBook }),
    ).toMatchObject({ source: "bound" });
  });

  it("uses renamed and trashed Collections as current facts; unknown paths stay evaluable nonmatches", async () => {
    await using f = await harness({ [books]: 'collections.within("Gone")' });
    expect(f.profile.profiles[0]?.match.state).toBe("evaluable");
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ source: "bound" });
    await f.editMatch(books, 'collections.contains("Project/Drafts")');
    f.client.$client.exec(
      "update collections set collectionName = 'Manuscripts' where collectionID = 101",
    );
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ source: "bound" });
    expect(
      listCollectionChoices(f.client, f.libraryScope.libraries).map(
        ({ path }) => path.join("/"),
      ),
    ).toContain("Project/Manuscripts");
    await f.editMatch(books, 'collections.within("Project")');
    f.client.$client.exec(
      "insert into deletedCollections (collectionID) values (100)",
    );
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ source: "bound" });
    expect(
      await f.feature.resolveCreationProfile({ item: groupBook }),
    ).toMatchObject({ selector: books });
  });

  it.each([
    [personalBook, 'tags.contains("Read")'],
    [personalBook, 'tags.contains("READ")'],
    [article, 'tags.contains("auto-tag")'],
  ] as const)(
    "creates with the Profile selected by exact manual or automatic Tag names",
    async (item, match) => {
      await using f = await harness({
        [books]: match,
        [papers]: 'tags.contains("read")',
      });
      const selection = await f.feature.resolveCreationProfile({ item });
      expect(selection).toMatchObject({ selector: books, source: "match" });
      const preview = (await f.feature.prepareCreationProfiles(item)).find(
        ({ selector }) => selector === selection.selector,
      )!;
      expect(await preview.create()).toMatchObject({
        outcome: "created",
        file: { path: `Reading/${item.key}.md` },
      });
      expect(f.vault.contents.get(`Reading/${item.key}.md`)).toContain(
        `${FIELD_LITERATURE_NOTE_PROFILE}: Books (${books})`,
      );
    },
  );

  it("expresses precedence through disjoint alternatives and exclusions", async () => {
    await using f = await harness({
      [papers]: {
        and: [
          'library == "personal"',
          {
            or: ['collections.within("Project")', 'tags.contains("auto-tag")'],
          },
          'itemType != "book"',
        ],
      },
      [books]: '!(tags.contains("Read") || itemType == "journalArticle")',
      [manual]: 'tags.contains("READ") && !collections.contains("Project")',
    });
    const selections = await Promise.all(
      [article, groupBook, personalBook].map((item) =>
        f.feature.resolveCreationProfile({ item }),
      ),
    );
    expect(selections.map(({ selector }) => selector)).toEqual([
      papers,
      books,
      manual,
    ]);
  });

  it("freezes the preview across match and Item edits, and keeps existing note membership", async () => {
    await using f = await harness({
      [books]: 'tags.contains("Read") && collections.contains("Other")',
      [papers]: 'itemType == "journalArticle"',
    });
    const selection = await f.feature.resolveCreationProfile({
      item: personalBook,
    });
    const preview = (
      await f.feature.prepareCreationProfiles(personalBook)
    ).find(({ selector }) => selector === selection.selector)!;
    expect(preview.path).toBe("Reading/BOOK0001.md");
    await f.editMatch(books, 'itemType == "thesis"');
    await f.editMatch(papers, 'itemType == "book"');
    f.client.$client.exec(
      "delete from itemTags where itemID = 1; delete from collectionItems where itemID = 1",
    );
    expect(selection).toMatchObject({
      selector: books,
      reason: m.profile_match_selected({ profile: "Books" }),
    });
    const created = await preview.create();
    expect(created).toMatchObject({
      outcome: "created",
      file: { path: "Reading/BOOK0001.md" },
    });
    expect(
      await f.feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: papers });
    expect(
      created.outcome === "created" && f.profile.profileOf(created.file),
    ).toMatchObject({ ok: true, profile: { selector: books } });
    expect(
      await f.feature.createNote(personalBook, { profile: papers }),
    ).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "literature-note-exists" },
    });
    expect(f.vault.contents.get("Reading/BOOK0001.md")).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Books (${books})`,
    );
    expect(f.vault.contents.has("Papers/BOOK0001.md")).toBe(false);
  });

  it("stops a prepared write if its Profile document disappears", async () => {
    await using f = await harness({ [books]: "true" });
    const preview = (
      await f.feature.prepareCreationProfiles(personalBook)
    ).find(({ selector }) => selector === books)!;
    f.vault.deleteFile(`templates/zotlit-profile.${books}.md`);
    await vi.advanceTimersByTimeAsync(500);
    expect(await preview.create()).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "unknown-literature-note-profile" },
    });
    expect(f.vault.contents.has("Reading/BOOK0001.md")).toBe(false);
  });
});
