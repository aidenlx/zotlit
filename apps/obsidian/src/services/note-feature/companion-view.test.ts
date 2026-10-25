// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ButtonComponent, TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import type { Item, ItemRef } from "@zotlit/db";

import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { companionNoteNotice, openCompanionNote } from "./index";
import type {
  CompanionNoteDeps,
  CompanionNoteTarget,
  CreationProfileSelection,
  PreparedCreationProfile,
} from "./index";
import type { CreationPlan } from "./operations";

/** Every text notice the flow showed, in order. */
const notices = vi.hoisted(() => ({ shown: [] as string[] }));
vi.mock("@/lib/notice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notice")>();
  return {
    ...actual,
    BaseNotice: class extends actual.BaseNotice {
      constructor(message: string | DocumentFragment, duration?: number) {
        super(message, duration);
        notices.shown.push(
          typeof message === "string" ? message : (message.textContent ?? ""),
        );
      }
    },
  };
});

vi.mock("@/views/quick-switch/profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

const REF: ItemRef = {
  itemID: 1,
  libraryID: 1,
  key: "ABCD2345",
  groupID: null,
  indexedKey: "ABCD2345",
};
const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const PAPERS = "Rz9Wm4YfH6Kd" as ProfileId;

function creationPlans(
  indexedKeys: readonly string[],
  plan: CreationPlan,
): ReadonlyMap<string, CreationPlan> {
  return new Map(indexedKeys.map((key) => [key, plan]));
}

/** The services the flow reads through their tags, over one test's fakes. */
interface FlowServices {
  /** Records each `openLinkText`. */
  readonly workspace: MemoryWorkspace;
  /** The path of each note the Use Ledger was told not to count, in order. */
  readonly excluded: string[];
  readonly readItems?: ZoteroReadsApi["ItemsByIndexedKeys"];
}

function flowLayer({ workspace, excluded, readItems }: FlowServices) {
  return Layer.mergeAll(
    layerWorkspaceFrom(workspace),
    Layer.mock(UseLedger, {
      withoutNoteUse: (file, open) =>
        Effect.sync(() => excluded.push(file.path)).pipe(Effect.andThen(open)),
    }),
    Layer.mock(ZoteroReads, {
      reads: stubService<ZoteroReadsApi>(
        "ZoteroReadsApi",
        readItems ? { ItemsByIndexedKeys: readItems } : {},
      ),
    }),
    Layer.mock(ZoteroPref, {
      current: Effect.succeed(
        stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", { dataDir: "" }),
      ),
    }),
  );
}

/** One `openLinkText` of `path` in `newLeaf`, as the flow makes it. */
function openedAt(
  path: string,
  newLeaf: MemoryWorkspace["opened"][number]["newLeaf"],
) {
  return {
    linktext: path,
    sourcePath: "",
    newLeaf,
    openViewState: { active: true },
  };
}

function creationHarness(selection: CreationProfileSelection) {
  const file = noteAt("Papers/Study.md");
  const item = { ...REF, fields: { title: "A Study" } } as Item;
  const readItems = vi.fn(() =>
    Effect.succeed(new Map([[REF.indexedKey, item]])),
  );
  const create = vi.fn(async () => ({ outcome: "created" as const, file }));
  const previews: PreparedCreationProfile[] = [
    {
      selector: selection.selector,
      label: "Papers",
      folder: "Papers",
      citationStyle: null,
      document: undefined,
      path: file.path,
      create,
    },
  ];
  const planCreations = vi.fn(async (keys: readonly string[]) =>
    creationPlans(keys, { item, selection, previews }),
  );
  const deps: CompanionNoteDeps = {
    createProfile: vi.fn(),
    importProfile: vi.fn(),
    app: stubService<App>("App", {}),
    noteFeature: stubService<CompanionNoteDeps["noteFeature"]>("NoteFeature", {
      resolveCompanionNote: vi.fn(async (): Promise<CompanionNoteTarget> => ({
        outcome: "create",
      })),
      planCreations,
      createNote: create,
      updateNote: vi.fn(async () => ({
        bodyUpdated: true,
        duplicateRegionCount: 0,
      })),
    }),
  };
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const excluded: string[] = [];
  notices.shown.length = 0;
  return {
    deps,
    file,
    item,
    readItems,
    create,
    planCreations,
    workspace,
    excluded,
    layer: flowLayer({
      workspace,
      excluded,
      readItems: readItems as unknown as ZoteroReadsApi["ItemsByIndexedKeys"],
    }),
  };
}

it.effect.each(["open", "update"] as const)(
  "%s creates directly under the link's Profile and opens the path",
  (action) =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: PAPERS,
        source: "headless",
        shouldAsk: true,
      });
      vi.mocked(chooseLiteratureNoteProfile).mockClear();
      harness.planCreations.mockImplementation(async (keys) => {
        expect(harness.readItems).toHaveBeenCalledOnce();
        return creationPlans(keys, {
          item: harness.item,
          selection: { selector: PAPERS, source: "headless", shouldAsk: true },
          previews: [
            {
              selector: PAPERS,
              label: "Papers",
              folder: "Papers",
              citationStyle: null,
              document: undefined,
              path: harness.file.path,
              create: harness.create,
            },
          ],
        });
      });
      yield* openCompanionNote(harness.deps, REF, {
        action,
        profile: PAPERS,
      }).pipe(Effect.provide(harness.layer));
      expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
        [harness.item.indexedKey],
        {
          headless: PAPERS,
        },
      );
      expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(harness.create).toHaveBeenCalledOnce();
      expect(harness.workspace.opened).toEqual([
        openedAt("Papers/Study.md", false),
      ]);
      // Only an update keeps the navigation out of the Use Ledger.
      expect(harness.excluded).toEqual(
        action === "update" ? ["Papers/Study.md"] : [],
      );
    }),
);

it.effect(
  "creates directly when a match selects the Profile for an unqualified link",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: PAPERS,
        source: "match",
        shouldAsk: true,
        reason: m.profile_match_selected({ profile: "Papers" }),
      });
      vi.mocked(chooseLiteratureNoteProfile).mockClear();
      yield* openCompanionNote(harness.deps, REF, { action: "open" }).pipe(
        Effect.provide(harness.layer),
      );
      expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
        [harness.item.indexedKey],
        {
          headless: undefined,
        },
      );
      expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(harness.create).toHaveBeenCalledOnce();
      expect(harness.workspace.opened).toEqual([
        openedAt("Papers/Study.md", false),
      ]);
    }),
);

it.effect("asks when the selected Profile is unavailable", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: true,
      problem: { kind: "unavailable-profile", selector: BOOKS },
    });
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
    yield* openCompanionNote(harness.deps, REF, { action: "open" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
      harness.deps.app,
      expect.objectContaining({
        preselected: "default",
        problem: expect.stringContaining(BOOKS),
      }),
    );
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.workspace.opened).toEqual([]);
  }),
);

it.effect("leaves a cancelled picker without a note or navigation", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: true,
    });
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue(undefined);
    yield* openCompanionNote(harness.deps, REF, { action: "open" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
      harness.deps.app,
      expect.objectContaining({ preselected: "default", source: "bound" }),
    );
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.workspace.opened).toEqual([]);
  }),
);

it.effect("creates directly when only Default is available", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: false,
    });
    vi.mocked(chooseLiteratureNoteProfile).mockClear();
    yield* openCompanionNote(harness.deps, REF, { action: "update" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(harness.create).toHaveBeenCalledExactlyOnceWith(harness.item, {
      profile: "default",
    });
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(harness.planCreations).toHaveBeenCalledOnce();
    expect(harness.workspace.opened).toHaveLength(1);
  }),
);

it.effect(
  "keeps metadata-only missing-note updates outside the create flow",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      });
      yield* openCompanionNote(harness.deps, REF, {
        action: "update",
        scope: "metadata",
      }).pipe(Effect.provide(harness.layer));
      expect(harness.readItems).not.toHaveBeenCalled();
      expect(harness.planCreations).not.toHaveBeenCalled();
      expect(harness.create).not.toHaveBeenCalled();
      expect(harness.workspace.opened).toEqual([]);
      expect(notices.shown).toEqual([m.notice_update_metadata_no_note()]);
    }),
);

it.effect(
  "refuses an unknown URL Profile without opening or starting creation",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      });
      const target = {
        outcome: "refused" as const,
        diagnostic: unknownProfileDiagnostic(PAPERS),
      };
      vi.mocked(
        harness.deps.noteFeature.resolveCompanionNote,
      ).mockResolvedValue(target);
      yield* openCompanionNote(harness.deps, REF, {
        action: "open",
        profile: PAPERS,
      }).pipe(Effect.provide(harness.layer));
      expect(notices.shown).toEqual([
        m.notice_literature_note_profile_unknown({ stamp: PAPERS }),
      ]);
      expect(harness.workspace.opened).toEqual([]);
      expect(harness.readItems).not.toHaveBeenCalled();
      expect(companionNoteNotice(harness.deps.app, target)).toBe(
        m.notice_literature_note_profile_unknown({ stamp: PAPERS }),
      );
    }),
);

it.effect("opens a matching existing note and updates under its stamp", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: BOOKS,
      source: "headless",
      shouldAsk: true,
    });
    vi.mocked(harness.deps.noteFeature.resolveCompanionNote).mockResolvedValue({
      outcome: "existing",
      files: [harness.file],
    });
    yield* openCompanionNote(harness.deps, REF, {
      action: "update",
      profile: BOOKS,
      scope: "metadata",
    }).pipe(Effect.provide(harness.layer));
    expect(harness.workspace.opened).toHaveLength(1);
    expect(harness.excluded).toEqual([harness.file.path]);
    expect(harness.deps.noteFeature.updateNote).toHaveBeenCalledExactlyOnceWith(
      harness.file,
      { indexedKey: "ABCD2345", scope: "metadata" },
    );
    expect(harness.create).not.toHaveBeenCalled();
  }),
);

it.effect(
  "opens an unknown existing stamp with recovery, while leaving its content unchanged",
  () =>
    Effect.gen(function* () {
      using buttonText = vi.spyOn(ButtonComponent.prototype, "setButtonText");
      const harness = creationHarness({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      });
      const target: CompanionNoteTarget = {
        outcome: "existing",
        files: [harness.file],
        diagnostic: unknownProfileDiagnostic(`Missing (${PAPERS})`, {
          path: harness.file.path,
        }),
      };
      vi.mocked(
        harness.deps.noteFeature.resolveCompanionNote,
      ).mockResolvedValue(target);
      yield* openCompanionNote(harness.deps, REF, {
        action: "update",
        profile: "default",
      }).pipe(Effect.provide(harness.layer));
      expect(harness.workspace.opened).toHaveLength(1);
      expect(harness.deps.noteFeature.updateNote).not.toHaveBeenCalled();
      expect(harness.create).not.toHaveBeenCalled();
      const notice = companionNoteNotice(
        harness.deps.app,
        target,
      ) as DocumentFragment;
      expect(notice.textContent).toContain(
        m.notice_literature_note_profile_unknown({
          stamp: `Missing (${PAPERS})`,
        }),
      );
      expect(buttonText).toHaveBeenLastCalledWith(m.profile_switch_recovery());
    }),
);

it.effect.each(["tab"] as const)(
  "opens an existing note in a new %s when the link names one",
  (paneType) =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: BOOKS,
        source: "headless",
        shouldAsk: false,
      });
      vi.mocked(
        harness.deps.noteFeature.resolveCompanionNote,
      ).mockResolvedValue({
        outcome: "existing",
        files: [harness.file],
      });
      yield* openCompanionNote(harness.deps, REF, {
        action: "open",
        paneType,
      }).pipe(Effect.provide(harness.layer));
      expect(harness.workspace.opened).toEqual([
        openedAt("Papers/Study.md", paneType),
      ]);
    }),
);

it.effect("opens a note it just created in the pane the link names", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: false,
    });
    yield* openCompanionNote(harness.deps, REF, {
      action: "open",
      paneType: "window",
    }).pipe(Effect.provide(harness.layer));
    expect(harness.workspace.opened).toEqual([
      openedAt("Papers/Study.md", "window"),
    ]);
  }),
);

it("names Default in the kept-Profile notice for an unstamped note", () => {
  expect(
    companionNoteNotice(stubService<App>("App", {}), {
      outcome: "existing",
      files: [noteAt("Paper.md")],
      keptProfile: { selector: "default", label: undefined },
    }),
  ).toBe(
    m.notice_literature_note_profile_kept({
      label: m.settings_profile_default_name(),
    }),
  );
});

it.effect.each(["open", "update"] as const)(
  "%s opens a conflicting stamped note without updating it or asking",
  (action) =>
    Effect.gen(function* () {
      const file = noteAt("Books/Paper.md");
      const target = {
        outcome: "existing" as const,
        files: [file] as [TFile],
        keptProfile: { selector: BOOKS, label: "Books" },
      };
      const updateNote = vi.fn();
      const createNote = vi.fn();
      const resolveCompanionNote = vi.fn(async () => target);
      const deps: CompanionNoteDeps = {
        createProfile: vi.fn(),
        importProfile: vi.fn(),
        app: stubService<App>("App", {}),
        noteFeature: stubService<CompanionNoteDeps["noteFeature"]>(
          "NoteFeature",
          {
            resolveCompanionNote,
            updateNote,
            createNote,
          },
        ),
      };
      const workspace = new MemoryWorkspace({ layoutReady: true });
      vi.mocked(chooseLiteratureNoteProfile).mockClear();
      notices.shown.length = 0;

      yield* openCompanionNote(deps, REF, { action, profile: PAPERS }).pipe(
        Effect.provide(flowLayer({ workspace, excluded: [] })),
      );

      expect(workspace.opened).toEqual([openedAt("Books/Paper.md", false)]);
      expect(resolveCompanionNote).toHaveBeenCalledWith("ABCD2345", {
        profile: PAPERS,
      });
      expect(updateNote).not.toHaveBeenCalled();
      expect(createNote).not.toHaveBeenCalled();
      expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(notices.shown).toEqual([
        m.notice_literature_note_profile_kept({ label: "Books" }),
      ]);
    }),
);

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}
