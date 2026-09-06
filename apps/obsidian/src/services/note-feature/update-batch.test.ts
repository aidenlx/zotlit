import type { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getIndexedItemIDsByLibrary,
  getItemDisplayRefByID,
  getItemRefByID,
  getItemsByID,
  getLibraries,
  getLibraryByGroupID,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { Library } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";

import * as m from "@/lib/i18n/generated/messages";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { ProfileId, ProfileSelector } from "@/lib/profile-stamp";
import { chooseBatchProfile } from "@/services/batch-profile-choice";
import type {
  AvailableLibrary,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { selectorOf } from "@/services/library-scope/scope";
import { describeRule } from "@/services/profile-selection";
import type { ProfileSelectionRule } from "@/services/profile-selection";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import type {
  BatchModalOptions,
  BatchProfileChoice,
  FlatGroupDef,
} from "@/views/batch-modal";

import type {
  CreateNoteResult,
  CreationProfileSelection,
  PreparedCreationProfile,
} from "./operations";
import {
  batchCreateOutcome,
  BatchCreateRefusedError,
  runBatchUpdateAll,
  runBatchUpdate,
} from "./update-batch";
import type { BatchUpdateResult, BatchUpdateDeps } from "./update-batch";
import type { SingleUpdateDeps } from "./update-single";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getLibraries: vi.fn(),
    getLibraryByGroupID: vi.fn(),
    getItemDisplayRefByID: vi.fn(),
    getItemRefByID: vi.fn(),
    getItemsByID: vi.fn(),
    getZoteroIdentity: vi.fn(() => ({ username: null })),
    getCollectionIDByKey: vi.fn(),
    getIndexedItemIDsByLibrary: vi.fn(),
    getIndexedItemIDsByCollection: vi.fn(),
  };
});

vi.mock("@/services/batch-profile-choice", () => ({
  chooseBatchProfile: vi.fn(),
}));

/** Captured options of every batch modal the runner opened. */
const openedModals: BatchModalOptions[] = [];

// Stub the DOM-bound modal so the runner's scope resolution can be driven
// headlessly; classification runs inside the modal, which never opens here.
vi.mock("@/views/batch-modal", () => {
  class BatchModal {
    constructor(
      _app: unknown,
      readonly options: BatchModalOptions,
    ) {
      openedModals.push(options);
    }
    open(): void {}
  }
  class FlatManifest {
    constructor(readonly options: any) {}
    get counts() {
      return {
        actionable: this.options.tasks.length,
        notFound: this.options.notFound.length,
      };
    }
  }
  return { BatchModal, FlatManifest };
});

const COLLECTION = "ABCD2345";

const PERSONAL_LIBRARY: Library = {
  libraryID: USER_LIBRARY_ID,
  type: "user",
  groupID: null,
  name: null,
};

/** A group whose local id sorts before the personal library's own row order. */
const GROUP_LIBRARY: Library = {
  libraryID: 12,
  type: "group",
  groupID: 7,
  name: "Reading group",
};

function available(library: Library): AvailableLibrary {
  return {
    selector: selectorOf(library)!,
    libraryID: library.libraryID,
    name: library.name,
  };
}

function scopeOf(
  libraries: readonly Library[],
  unavailable: readonly LibrarySelector[] = [],
): ResolvedLibraryScope {
  return {
    mode: "selected",
    invalid: false,
    available: libraries.map(available),
    unavailable,
  };
}

let currentScope: ResolvedLibraryScope = scopeOf([PERSONAL_LIBRARY]);

function makeDeps(dbState: "loading" | "ready" = "ready"): BatchUpdateDeps {
  const client = createClient(":memory:");
  return {
    profile: profileReader(),
    app: {} as SingleUpdateDeps["app"],
    db: {
      state: dbState,
      client,
      acquireRead: async () => ({ client, [Symbol.dispose]() {} }),
    },
    settings: {
      current: defaults,
      loaded: Promise.resolve({ ...defaults }),
      update: vi.fn(),
    },
    libraryScope: { resolveWith: () => currentScope },
    noteFeature: {
      resolveCreationProfile: async () => ({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      }),
    },
    createProfile: vi.fn(),
    importProfile: vi.fn(),
    zoteroPref: { dataDir: null },
    noteIndex: {
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
    },
  } as unknown as BatchUpdateDeps;
}

/** Drive the last opened modal's loading phase and return its manifest options. */
async function classifyLastModal(): Promise<{
  tasks: { id: number; kind: string }[];
  groups: FlatGroupDef[];
  intro: string;
}> {
  const opts = openedModals.at(-1);
  if (!opts) throw new Error("no modal was opened");
  const manifest = (await opts.onClassify({
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  })) as unknown as { options: any };
  return {
    tasks: manifest.options.tasks,
    groups: manifest.options.groups,
    intro: opts.text.confirmIntro({
      actionable: manifest.options.tasks.length,
      notFound: manifest.options.notFound.length,
    }),
  };
}

/** Every classified id resolves to a live item of `libraryID`. */
function itemsIn(byLibrary: ReadonlyMap<number, number>): void {
  vi.mocked(getItemDisplayRefByID).mockImplementation((_client, itemID) => {
    const libraryID = byLibrary.get(itemID);
    if (libraryID === undefined) return null;
    return {
      itemID,
      key: `ITEM${itemID}`,
      libraryID,
      groupID: libraryID === USER_LIBRARY_ID ? null : 7,
      indexedKey: `ITEM${itemID}`,
      title: `Item ${itemID}`,
    };
  });
}

beforeEach(() => {
  openedModals.length = 0;
  currentScope = scopeOf([PERSONAL_LIBRARY]);
  vi.mocked(getLibraries)
    .mockReset()
    .mockReturnValue([PERSONAL_LIBRARY, GROUP_LIBRARY]);
  vi.mocked(getLibraryByGroupID)
    .mockReset()
    .mockImplementation((_client, groupID) =>
      groupID === GROUP_LIBRARY.groupID ? GROUP_LIBRARY : null,
    );
  vi.mocked(getItemDisplayRefByID).mockReset().mockReturnValue(null);
  vi.mocked(getItemRefByID).mockReset().mockReturnValue(null);
  vi.mocked(getCollectionIDByKey).mockReset().mockReturnValue(100);
  vi.mocked(getIndexedItemIDsByLibrary).mockReset().mockReturnValue([]);
  vi.mocked(getIndexedItemIDsByCollection).mockReset().mockReturnValue([]);
});

describe("batchCreateOutcome", () => {
  it("preserves a create refusal as a failed-row error with its diagnostic", () => {
    const refusal: Extract<CreateNoteResult, { outcome: "refused" }> = {
      outcome: "refused",
      diagnostic: {
        code: "duplicate-literature-notes",
        hint: "Resolve the duplicate Literature Notes, then run create again.",
        indexedKey: "ABCD1234",
        paths: ["Literature/Newer.md", "Archive/Older.md"],
      },
    };

    try {
      batchCreateOutcome(refusal);
      throw new Error("Expected the batch create to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(BatchCreateRefusedError);
      expect(error).toMatchObject({
        message:
          "Multiple literature notes use this Zotero key: Literature/Newer.md, Archive/Older.md; resolve the duplicates before you create another note.",
        diagnostic: refusal.diagnostic,
      });
    }
  });
});

it("classifies conflicting Companion Profiles as kept rows before any write or picker", async () => {
  const books = "Bk3Qn7XvT2Lp" as ProfileId;
  const deps = makeDeps();
  deps.profile = profileReader(
    { ...defaults, profiles: [{ id: books, label: "Books" }] },
    {
      getFileCache: (file) => ({
        frontmatter: file.path.startsWith("Books/")
          ? { "zotlit-profile": `Books (${books})` }
          : {},
      }),
    },
  );
  const create = vi.fn(async () => ({
    outcome: "created" as const,
    file: { path: "Books/New.md" } as TFile,
  }));
  const createDefault = vi.fn(async () => ({
    outcome: "created" as const,
    file: { path: "Literature/New.md" } as TFile,
  }));
  const writeNoteUpdate = vi.fn(async () => ({
    bodyUpdated: true,
    duplicateRegionCount: 0,
  }));
  deps.noteFeature.writeNoteUpdate = writeNoteUpdate;
  // A remembered Profile persisted by an earlier version stays inert.
  Object.assign(deps.settings, {
    current: { ...defaults, "note.last-used-profile": books },
  });
  using settingsUpdate = vi.spyOn(deps.settings, "update");
  deps.noteFeature.resolveCreationProfile = vi.fn(async () => ({
    selector: books,
    source: "headless" as const,
    shouldAsk: true,
  }));
  deps.noteFeature.prepareBatchCreationProfiles = vi.fn<
    typeof deps.noteFeature.prepareBatchCreationProfiles
  >(
    async () =>
      new Map([
        [
          1,
          [
            {
              selector: books,
              label: "Books",
              folder: "Books",
              citationStyle: null,
              document: undefined,
              path: "Books/New.md",
              create,
            },
            {
              selector: "default" as const,
              label: undefined,
              folder: "Literature",
              citationStyle: null,
              document: undefined,
              path: "Literature/New.md",
              create: createDefault,
            },
          ],
        ],
      ]),
  );
  deps.noteIndex.getNotesByItemKey = (key) =>
    key === "ITEM2"
      ? [{ path: "Books/Old.md" } as any]
      : key === "ITEM3"
        ? [{ path: "Literature/Other.md" } as any]
        : [];
  itemsIn(
    new Map([
      [1, USER_LIBRARY_ID],
      [2, USER_LIBRARY_ID],
      [3, USER_LIBRARY_ID],
    ]),
  );
  vi.mocked(getItemsByID).mockReturnValue([
    { itemID: 1, indexedKey: "ITEM1" } as any,
  ]);
  vi.mocked(chooseBatchProfile).mockClear();
  await runBatchUpdate(deps, [1, 2, 3], { profile: books });
  const modal = openedModals.at(-1)!;
  const manifest = (await modal.onClassify({
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  })) as any;
  expect(manifest.options.tasks).toMatchObject([
    { id: 1, profile: "Books", path: "Books/New.md" },
    { id: 2, profile: "Books" },
  ]);
  expect(manifest.options.kept).toEqual([
    {
      label: "Item 3",
      profile: m.settings_profile_default_name(),
      reason: m.batch_profile_kept_reason({
        label: m.settings_profile_default_name(),
        requested: "Books",
      }),
    },
  ]);
  expect(manifest.counts.actionable).toBe(2);
  expect(chooseBatchProfile).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(settingsUpdate).not.toHaveBeenCalled();
  // Every row carries the Companion's Profile, so the only control is the
  // explicit all-new override.
  const choices: BatchProfileChoice[] = manifest.options.groups.find(
    (group: FlatGroupDef) => group.profileChoices,
  )!.profileChoices!;
  expect(choices.map(({ scope }) => scope)).toEqual(["all-new"]);
  const choice = choices[0]!;
  expect(choice).toMatchObject({
    label: "Books",
    source: "headless",
    count: 1,
  });
  vi.mocked(chooseBatchProfile)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce("default");
  await choice.choose();
  expect(manifest.options.tasks[0].path).toBe("Books/New.md");
  await choice.choose();
  expect(manifest.options.tasks[0]).toMatchObject({
    profile: m.settings_profile_default_name(),
    path: "Literature/New.md",
  });
  expect(choice.source).toBe("asked");
  expect(settingsUpdate).not.toHaveBeenCalled();
  const result = await modal.onRun({
    onItemSettled: vi.fn(),
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({
    created: 1,
    updated: 1,
    failed: 0,
    skipped: 0,
  });
  expect(settingsUpdate).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(createDefault).toHaveBeenCalledOnce();
  expect(writeNoteUpdate).toHaveBeenCalledOnce();
  expect(writeNoteUpdate.mock.calls[0]).not.toHaveProperty("1.profile");
  expect(
    modal.text.runSummary(result, { cancelled: false, aborted: false }),
  ).toBe(
    m.batch_profile_summary({
      created: m.batch_profile_created({
        count: 1,
        label: m.settings_profile_default_name(),
      }),
      updated: m.batch_profile_updated({ count: 1, label: "Books" }),
      kept: 1,
      failed: 0,
      skipped: 0,
      notFound: 0,
    }),
  );
});

it.each([true, false])(
  "shows an unknown Literature Note stamp and preserves recovery (additional Profiles: %s)",
  async (additionalProfiles) => {
    const stamp = "Retired (Qw8Er5Ty2Ui9)";
    const file = { path: "Reading/Paper.md" } as TFile;
    const deps = makeDeps();
    deps.profile = profileReader(
      {
        ...defaults,
        profiles: additionalProfiles
          ? [{ id: "Bk3Qn7XvT2Lp" as ProfileId, label: "Books" }]
          : [],
      },
      {
        getFileCache: () => ({ frontmatter: { "zotlit-profile": stamp } }),
      },
    );
    deps.noteIndex.getNotesByItemKey = () => [file];
    itemsIn(new Map([[1, USER_LIBRARY_ID]]));
    vi.mocked(getItemsByID).mockReturnValue([
      { itemID: 1, indexedKey: "ITEM1" } as any,
    ]);
    deps.noteFeature.writeNoteUpdate = async () => ({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: unknownProfileDiagnostic(stamp, { path: file.path }),
    });
    await runBatchUpdate(deps, [1, 2]);
    const options = openedModals.at(-1)!;
    const manifest = (await options.onClassify({
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    })) as any;
    expect(manifest.options.tasks).toMatchObject([{ id: 1 }]);
    expect(manifest.options.tasks[0].profile).toBe(
      additionalProfiles ? stamp : undefined,
    );
    expect(
      manifest.options.groups.some(
        (group: FlatGroupDef) => group.profileChoices,
      ),
    ).toBe(false);
    const onItemSettled = vi.fn();
    expect(
      await options.onRun({
        onItemSettled,
        signal: new AbortController().signal,
      }),
    ).toMatchObject({ created: 0, updated: 0, failed: 1 });
    expect(onItemSettled).toHaveBeenCalledExactlyOnceWith({
      id: 1,
      status: "failed",
      failure: {
        label: "Item 1",
        message: m.notice_literature_note_profile_unknown({ stamp }),
        recovery: { action: "switch-profile", path: file.path },
      },
    });
  },
);

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const ARTICLES = "Ar7Kd2QpX9Mn" as ProfileId;
const RETIRED_STAMP = "Retired (Qw8Er5Ty2Ui9)";
const BOOKS_RULE: ProfileSelectionRule = {
  id: "rule-books",
  filter: 'itemType == "book"',
  profile: BOOKS,
};
const ARTICLES_RULE: ProfileSelectionRule = {
  id: "rule-articles",
  filter: 'itemType == "journalArticle"',
  profile: ARTICLES,
};
const BROKEN_RULE: ProfileSelectionRule = {
  id: "rule-broken",
  filter: "itemType ==",
  profile: BOOKS,
};
const BROKEN_PROBLEM = m.modal_profile_problem_broken_rule({
  rule: describeRule(BROKEN_RULE),
  problem: m.profile_rule_problem_syntax({ text: "itemType ==" }),
});
const FOLDERS: Record<ProfileSelector, string> = {
  default: "Literature",
  [BOOKS]: "Books",
  [ARTICLES]: "Articles",
};

/**
 * A mixed batch: rows 1 and 2 match different rules, 3 and 4 match none,
 * 5 hits a broken rule, 6 has a Books-stamped note, 7 an unstamped note, and
 * 8 a note with an unknown stamp. Every selection comes from the (stubbed)
 * shared boundary keyed by the Item it receives.
 */
function mixedBatch() {
  const deps = makeDeps();
  const cache = {
    getFileCache: (file: TFile) => ({
      frontmatter: file.path.startsWith("Books/")
        ? { "zotlit-profile": `Books (${BOOKS})` }
        : file.path.startsWith("Reading/")
          ? { "zotlit-profile": RETIRED_STAMP }
          : {},
    }),
  };
  const profiles = [
    { id: BOOKS, label: "Books" },
    { id: ARTICLES, label: "Articles" },
  ];
  deps.profile = profileReader({ ...defaults, profiles }, cache);
  const selections: Record<number, CreationProfileSelection> = {
    1: { selector: BOOKS, source: "rule", shouldAsk: true, rule: BOOKS_RULE },
    2: {
      selector: ARTICLES,
      source: "rule",
      shouldAsk: true,
      rule: ARTICLES_RULE,
    },
    3: { selector: "default", source: "bound", shouldAsk: true },
    4: { selector: "default", source: "bound", shouldAsk: true },
    5: {
      selector: "default",
      source: "bound",
      shouldAsk: true,
      problem: {
        kind: "broken-rule",
        rule: BROKEN_RULE,
        problem: { code: "syntax", from: 0, to: 11, text: "itemType ==" },
      },
    },
  };
  const resolveCreationProfile = vi.fn(
    async ({ item }: { item?: { itemID: number } }) =>
      selections[item!.itemID]!,
  );
  deps.noteFeature.resolveCreationProfile =
    resolveCreationProfile as typeof deps.noteFeature.resolveCreationProfile;
  const created: { itemID: number; selector: ProfileSelector }[] = [];
  const plansFor = (itemID: number): PreparedCreationProfile[] =>
    (["default", BOOKS, ARTICLES] as const).map((selector) => ({
      selector,
      label: profiles.find(({ id }) => id === selector)?.label,
      folder: FOLDERS[selector]!,
      citationStyle: null,
      document: undefined,
      path: `${FOLDERS[selector]}/Item ${itemID}.md`,
      create: async () => {
        created.push({ itemID, selector });
        return {
          outcome: "created" as const,
          file: { path: `${FOLDERS[selector]}/Item ${itemID}.md` } as TFile,
        };
      },
    }));
  deps.noteFeature.prepareBatchCreationProfiles = vi.fn(
    async (items: readonly { itemID: number }[]) =>
      new Map(items.map(({ itemID }) => [itemID, plansFor(itemID)])),
  ) as typeof deps.noteFeature.prepareBatchCreationProfiles;
  const updated: string[] = [];
  deps.noteFeature.writeNoteUpdate = async (file) => {
    updated.push(file.path);
    return file.path.startsWith("Reading/")
      ? {
          bodyUpdated: false,
          duplicateRegionCount: 0,
          diagnostic: unknownProfileDiagnostic(RETIRED_STAMP, {
            path: file.path,
          }),
        }
      : { bodyUpdated: true, duplicateRegionCount: 0 };
  };
  const notes: Record<string, string> = {
    ITEM6: "Books/Old.md",
    ITEM7: "Literature/Other.md",
    ITEM8: "Reading/Retired.md",
  };
  deps.noteIndex.getNotesByItemKey = (key) =>
    key in notes ? [{ path: notes[key] } as TFile] : [];
  itemsIn(new Map([1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, USER_LIBRARY_ID])));
  vi.mocked(getItemsByID).mockImplementation((_client, ids) =>
    ids.map((itemID) => ({ itemID, indexedKey: `ITEM${itemID}` }) as any),
  );
  vi.mocked(chooseBatchProfile).mockReset();
  return { deps, resolveCreationProfile, created, updated };
}

async function classifyMixedBatch(deps: BatchUpdateDeps) {
  await runBatchUpdate(deps, [1, 2, 3, 4, 5, 6, 7, 8]);
  const modal = openedModals.at(-1)!;
  const manifest = (await modal.onClassify({
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  })) as any;
  const choices: BatchProfileChoice[] = manifest.options.groups.find(
    (group: FlatGroupDef) => group.profileChoices,
  ).profileChoices;
  const choice = (scope: BatchProfileChoice["scope"]) =>
    choices.find((entry) => entry.scope === scope)!;
  const run = () =>
    modal.onRun({ onItemSettled, signal: new AbortController().signal });
  const onItemSettled = vi.fn();
  return {
    modal,
    tasks: manifest.options.tasks as Record<string, unknown>[],
    choices,
    choice,
    run,
    onItemSettled,
  };
}

const DEFAULT_LABEL = () => m.settings_profile_default_name();

describe("mixed batch", () => {
  it("prepares each new row from its own selection and keeps the fallback to unmatched rows", async () => {
    const { deps, resolveCreationProfile, created, updated } = mixedBatch();
    const { modal, tasks, choices, choice, run, onItemSettled } =
      await classifyMixedBatch(deps);

    expect(resolveCreationProfile).toHaveBeenCalledTimes(5);
    expect(
      resolveCreationProfile.mock.calls.map(([sources]) => sources),
    ).toEqual(
      [1, 2, 3, 4, 5].map((itemID) => ({
        headless: undefined,
        item: { itemID, indexedKey: `ITEM${itemID}` },
      })),
    );
    expect(tasks).toMatchObject([
      {
        id: 1,
        profile: "Books",
        path: "Books/Item 1.md",
        reason: m.modal_profile_source_rule({ rule: describeRule(BOOKS_RULE) }),
      },
      {
        id: 2,
        profile: "Articles",
        path: "Articles/Item 2.md",
        reason: m.modal_profile_source_rule({
          rule: describeRule(ARTICLES_RULE),
        }),
      },
      {
        id: 3,
        profile: DEFAULT_LABEL(),
        path: "Literature/Item 3.md",
        reason: m.batch_profile_reason_unmatched(),
      },
      { id: 4, profile: DEFAULT_LABEL(), path: "Literature/Item 4.md" },
      { id: 5, profile: undefined, path: undefined, reason: BROKEN_PROBLEM },
      { id: 6, profile: "Books" },
      { id: 7, profile: DEFAULT_LABEL() },
      { id: 8, profile: RETIRED_STAMP },
    ]);
    expect(choices.map(({ scope }) => scope)).toEqual([
      "unmatched",
      "affected",
      "all-new",
    ]);
    expect(choice("unmatched")).toMatchObject({
      count: 2,
      label: DEFAULT_LABEL(),
      source: "bound",
    });
    expect(choice("affected")).toMatchObject({ count: 1, label: undefined });
    expect(choice("all-new")).toMatchObject({ count: 5, label: undefined });

    // The fallback moves the two unmatched rows only.
    vi.mocked(chooseBatchProfile).mockResolvedValueOnce(BOOKS);
    await choice("unmatched").choose();
    expect(chooseBatchProfile).toHaveBeenLastCalledWith(
      deps,
      expect.objectContaining({
        indexedKey: "ITEM3",
        selection: { selector: "default", source: "bound", shouldAsk: true },
        problem: undefined,
      }),
    );
    expect(tasks.slice(0, 5)).toMatchObject([
      { id: 1, profile: "Books", path: "Books/Item 1.md" },
      { id: 2, profile: "Articles", path: "Articles/Item 2.md" },
      {
        id: 3,
        profile: "Books",
        path: "Books/Item 3.md",
        reason: m.batch_profile_source_chosen(),
      },
      { id: 4, profile: "Books", path: "Books/Item 4.md" },
      { id: 5, profile: undefined, path: undefined, reason: BROKEN_PROBLEM },
    ]);
    expect(choice("unmatched")).toMatchObject({
      label: "Books",
      source: "asked",
    });
    expect(choice("affected")).toMatchObject({ count: 1, label: undefined });

    // Cancelling the recovery leaves the affected row without a destination.
    vi.mocked(chooseBatchProfile).mockResolvedValueOnce(undefined);
    await choice("affected").choose();
    expect(chooseBatchProfile).toHaveBeenLastCalledWith(
      deps,
      expect.objectContaining({ indexedKey: "ITEM5", problem: BROKEN_PROBLEM }),
    );
    expect(tasks[4]).toMatchObject({ id: 5, profile: undefined });

    const result = await run();
    expect(result).toMatchObject({
      created: 4,
      updated: 2,
      failed: 2,
      skipped: 0,
    });
    expect(created).toEqual([
      { itemID: 1, selector: BOOKS },
      { itemID: 2, selector: ARTICLES },
      { itemID: 3, selector: BOOKS },
      { itemID: 4, selector: BOOKS },
    ]);
    expect(updated).toEqual([
      "Books/Old.md",
      "Literature/Other.md",
      "Reading/Retired.md",
    ]);
    expect(onItemSettled).toHaveBeenCalledWith({
      id: 5,
      status: "failed",
      failure: { label: "Item 5", message: BROKEN_PROBLEM },
    });
    expect(onItemSettled).toHaveBeenCalledWith({
      id: 8,
      status: "failed",
      failure: {
        label: "Item 8",
        message: m.notice_literature_note_profile_unknown({
          stamp: RETIRED_STAMP,
        }),
        recovery: { action: "switch-profile", path: "Reading/Retired.md" },
      },
    });
    const summary = modal.text.runSummary(result, {
      cancelled: false,
      aborted: false,
    });
    for (const part of [
      m.batch_profile_created({ count: 3, label: "Books" }),
      m.batch_profile_created({ count: 1, label: "Articles" }),
      m.batch_profile_updated({ count: 1, label: "Books" }),
      m.batch_profile_updated({ count: 1, label: DEFAULT_LABEL() }),
    ])
      expect(summary).toContain(part);
    expect(summary).toContain("2 failed");
  });

  it("overrides every new note with one explicit Profile and leaves existing notes to their stamps", async () => {
    const { deps, created, updated } = mixedBatch();
    const { modal, tasks, choice, run } = await classifyMixedBatch(deps);

    vi.mocked(chooseBatchProfile).mockResolvedValueOnce(ARTICLES);
    await choice("all-new").choose();
    expect(tasks).toMatchObject([
      { id: 1, profile: "Articles", path: "Articles/Item 1.md" },
      { id: 2, profile: "Articles", path: "Articles/Item 2.md" },
      { id: 3, profile: "Articles", path: "Articles/Item 3.md" },
      { id: 4, profile: "Articles", path: "Articles/Item 4.md" },
      {
        id: 5,
        profile: "Articles",
        path: "Articles/Item 5.md",
        reason: m.batch_profile_source_chosen(),
      },
      { id: 6, profile: "Books" },
      { id: 7, profile: DEFAULT_LABEL() },
      { id: 8, profile: RETIRED_STAMP },
    ]);
    expect(choice("all-new")).toMatchObject({
      label: "Articles",
      source: "asked",
      count: 5,
    });
    expect(choice("unmatched")).toMatchObject({ label: "Articles" });
    expect(choice("affected")).toMatchObject({ label: "Articles" });

    const result = await run();
    expect(result).toMatchObject({ created: 5, updated: 2, failed: 1 });
    expect(created.map(({ selector }) => selector)).toEqual(
      Array(5).fill(ARTICLES),
    );
    expect(updated).toHaveLength(3);
    const summary = modal.text.runSummary(result, {
      cancelled: false,
      aborted: false,
    });
    expect(summary).toContain(
      m.batch_profile_created({ count: 5, label: "Articles" }),
    );
    expect(summary).not.toContain(
      m.batch_profile_created({ count: 1, label: "Books" }),
    );
  });

  it("stops a creation whose Profile was removed after the preview and keeps the others frozen", async () => {
    const { deps, created, resolveCreationProfile } = mixedBatch();
    const { tasks, run, onItemSettled } = await classifyMixedBatch(deps);
    resolveCreationProfile.mockClear();

    // Articles disappears between preview and run; the rows keep the
    // destinations they showed, and no selection is computed again.
    deps.profile = profileReader({
      ...defaults,
      profiles: [{ id: BOOKS, label: "Books" }],
    });
    const result = await run();
    expect(result).toMatchObject({ created: 3, updated: 2, failed: 3 });
    expect(created).toEqual([
      { itemID: 1, selector: BOOKS },
      { itemID: 3, selector: "default" },
      { itemID: 4, selector: "default" },
    ]);
    expect(onItemSettled).toHaveBeenCalledWith({
      id: 2,
      status: "failed",
      failure: {
        label: "Item 2",
        message: m.notice_literature_note_profile_unknown({ stamp: ARTICLES }),
      },
    });
    expect(resolveCreationProfile).not.toHaveBeenCalled();
    expect(tasks[1]).toMatchObject({ id: 2, path: "Articles/Item 2.md" });
  });
});

describe("runBatchUpdateAll", () => {
  it("returns db-unavailable when the database is closed", async () => {
    await expect(runBatchUpdateAll(makeDeps("loading"))).resolves.toEqual({
      outcome: "db-unavailable",
    } satisfies BatchUpdateResult);
    expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
  });

  it("reports an empty library scope before querying any item", async () => {
    currentScope = scopeOf([], [{ type: "group", groupID: 7 }]);

    await expect(runBatchUpdateAll(makeDeps())).resolves.toEqual({
      outcome: "no-library-in-scope",
    });
    expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
    expect(openedModals).toHaveLength(0);
  });

  it("updates every item of every library in scope, in canonical order", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [1, 2] : [3]),
    );

    await expect(runBatchUpdateAll(makeDeps())).resolves.toEqual({
      outcome: "batch-modal",
    });
    expect(
      vi.mocked(getIndexedItemIDsByLibrary).mock.calls.map(([, id]) => id),
    ).toEqual([USER_LIBRARY_ID, GROUP_LIBRARY.libraryID]);
    expect(openedModals[0]?.total).toBe(3);
  });

  it("runs the available subset and states the unavailable library count", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY], [{ type: "group", groupID: 9 }]);
    vi.mocked(getIndexedItemIDsByLibrary).mockReturnValue([1, 2]);
    itemsIn(
      new Map([
        [1, USER_LIBRARY_ID],
        [2, USER_LIBRARY_ID],
      ]),
    );

    await runBatchUpdateAll(makeDeps());

    const { intro } = await classifyLastModal();
    expect(intro).toContain("1 selected library is unavailable.");
  });

  it("keeps action-only headings while one library contributes", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [1, 2] : []),
    );
    itemsIn(
      new Map([
        [1, USER_LIBRARY_ID],
        [2, USER_LIBRARY_ID],
      ]),
    );

    await runBatchUpdateAll(makeDeps());

    const { groups, intro } = await classifyLastModal();
    expect(groups.map((group) => group.header({ count: 2 }))).toEqual([
      "Update (2)",
      "Create (2)",
    ]);
    expect(intro).not.toContain("unavailable");
  });

  it("groups rows by library and action when several libraries contribute", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [1] : [3]),
    );
    itemsIn(
      new Map([
        [1, USER_LIBRARY_ID],
        [3, GROUP_LIBRARY.libraryID],
      ]),
    );

    await runBatchUpdateAll(makeDeps());

    const { tasks, groups } = await classifyLastModal();
    expect(tasks).toEqual([
      expect.objectContaining({ id: 1, kind: "1:create" }),
      expect.objectContaining({ id: 3, kind: "12:create" }),
    ]);
    expect(groups.map((group) => group.header({ count: 1 }))).toEqual([
      "My Library · Update (1)",
      "My Library · Create (1)",
      "Reading group · Update (1)",
      "Reading group · Create (1)",
    ]);
  });

  it("routes a one-item multi-library expansion to the single-item path", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [] : [3]),
    );

    await expect(runBatchUpdateAll(makeDeps())).resolves.toEqual({
      outcome: "not-found",
    });
    expect(openedModals).toHaveLength(0);
  });

  describe("exact target", () => {
    it("resolves the named group outside library scope", async () => {
      currentScope = scopeOf([PERSONAL_LIBRARY]);
      vi.mocked(getIndexedItemIDsByLibrary).mockReturnValue([1, 2]);

      await expect(
        runBatchUpdateAll(makeDeps(), { groupID: 7 }),
      ).resolves.toEqual({ outcome: "batch-modal" });
      expect(getIndexedItemIDsByLibrary).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        GROUP_LIBRARY.libraryID,
      );
    });

    it("resolves an absent library parameter to My Library", async () => {
      currentScope = scopeOf([GROUP_LIBRARY]);
      vi.mocked(getIndexedItemIDsByLibrary).mockReturnValue([1, 2]);

      await runBatchUpdateAll(makeDeps(), { groupID: 0 });

      expect(getIndexedItemIDsByLibrary).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        USER_LIBRARY_ID,
      );
    });

    it("reports an unavailable group instead of a settings mismatch", async () => {
      await expect(
        runBatchUpdateAll(makeDeps(), { groupID: 99 }),
      ).resolves.toEqual({ outcome: "unavailable-target" });
      expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
    });

    it("resolves a collection inside the named library only", async () => {
      vi.mocked(getIndexedItemIDsByCollection).mockReturnValue([4, 5]);

      await expect(
        runBatchUpdateAll(makeDeps(), {
          groupID: 7,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "batch-modal" });
      expect(getCollectionIDByKey).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { libraryID: GROUP_LIBRARY.libraryID, collectionKey: COLLECTION },
      );
      expect(getIndexedItemIDsByCollection).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { libraryID: GROUP_LIBRARY.libraryID, collectionKey: COLLECTION },
      );
    });

    it("reports an unknown collection key instead of an empty scope", async () => {
      vi.mocked(getCollectionIDByKey).mockReturnValue(undefined);

      await expect(
        runBatchUpdateAll(makeDeps(), {
          groupID: 0,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "collection-not-found" });
      expect(getIndexedItemIDsByCollection).not.toHaveBeenCalled();
    });

    it("reports an empty selection for a collection that holds no items", async () => {
      await expect(
        runBatchUpdateAll(makeDeps(), {
          groupID: 0,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "empty-selection" });
      expect(openedModals).toHaveLength(0);
    });
  });
});
