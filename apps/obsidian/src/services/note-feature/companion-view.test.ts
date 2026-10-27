// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ButtonComponent, TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import type { Item, ItemRef } from "@zotlit/db";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import type { ReadsAnswers } from "@/services/zotero-reads/__fixtures__";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { unimplementedProfileDialogServices } from "@/setting-tab/__fixtures__";
import { openLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";
import type { LiteratureNoteProfileChoice } from "@/views/quick-switch/profile-picker";

import { companionLinkNotice, followCompanionLink } from "./companion-view";
import type {
  PlannedCreation,
  PlannedCreationProfile,
} from "./creation-planning";
import { companionNoteNotice } from "./index";
import type {
  CompanionNoteTarget,
  CreationProfileSelection,
  InteractiveCreationPorts,
} from "./index";
import { NoteFeature } from "./service";

vi.mock("@/views/quick-switch/profile-picker", () => ({
  openLiteratureNoteProfile: vi.fn(),
}));

/** The picker answers `answer` once, as the user would. */
function pickerAnswersOnce(answer: LiteratureNoteProfileChoice | undefined) {
  vi.mocked(openLiteratureNoteProfile).mockImplementationOnce(
    (_app, _options, resolve) => {
      resolve(answer);
      return { close: () => {} };
    },
  );
}

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
  plan: PlannedCreation,
): ReadonlyMap<string, PlannedCreation> {
  return new Map(indexedKeys.map((key) => [key, plan]));
}

/** The services the flow reads through their tags, over one test's fakes. */
interface FlowServices {
  /** Records each `openLinkText`. */
  readonly workspace: MemoryWorkspace;
  /** The path of each note the Use Ledger was told not to count, in order. */
  readonly excluded: string[];
  readonly readItems?: ReadsAnswers["ItemsByIndexedKeys"];
  /** Shows the flow's notices. */
  readonly notifier: ReturnType<typeof testNotifier>;
  /** Answers the Note Feature's lookups and updates. */
  readonly feature: Partial<NoteFeature["Service"]>;
}

function flowLayer({
  workspace,
  excluded,
  readItems,
  notifier,
  feature,
}: FlowServices) {
  return Layer.mergeAll(
    unimplementedProfileDialogServices,
    Layer.mock(NoteFeature, feature),
    layerWorkspaceFrom(workspace),
    notifier.layer,
    Layer.mock(UseLedger, {
      withoutNoteUse: (file, open) =>
        Effect.sync(() => excluded.push(file.path)).pipe(Effect.andThen(open)),
    }),
    Layer.mock(ZoteroReads, {
      reads: readsAnswering(readItems ? { ItemsByIndexedKeys: readItems } : {}),
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
  const create = vi.fn(() =>
    Effect.succeed({ outcome: "created" as const, file }),
  );
  const previews: PlannedCreationProfile[] = [
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
  const planCreations = vi.fn<NoteFeature["Service"]["planCreations"]>((keys) =>
    Effect.succeed(creationPlans(keys, { item, selection, previews })),
  );
  const deps: InteractiveCreationPorts = {
    createProfile: vi.fn(),
    importProfile: vi.fn(),
    app: stubService<App>("App", {}),
  };
  const feature = {
    planCreations,
    createNote: create,
    resolveCompanionNote: vi.fn<NoteFeature["Service"]["resolveCompanionNote"]>(
      () => Effect.succeed({ outcome: "create" }),
    ),
    updateNote: vi.fn<NoteFeature["Service"]["updateNote"]>(() =>
      Effect.succeed({ bodyUpdated: true, duplicateRegionCount: 0 }),
    ),
  };
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const excluded: string[] = [];
  return {
    deps,
    feature,
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
      readItems,
      notifier: testNotifier(),
      feature,
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
      vi.mocked(openLiteratureNoteProfile).mockClear();
      harness.planCreations.mockImplementation((keys) => {
        expect(harness.readItems).toHaveBeenCalledOnce();
        return Effect.succeed(
          creationPlans(keys, {
            item: harness.item,
            selection: {
              selector: PAPERS,
              source: "headless",
              shouldAsk: true,
            },
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
          }),
        );
      });
      yield* followCompanionLink(harness.deps, REF, {
        action,
        profile: PAPERS,
      }).pipe(Effect.provide(harness.layer));
      expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
        [harness.item.indexedKey],
        {
          headless: PAPERS,
        },
      );
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
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
      vi.mocked(openLiteratureNoteProfile).mockClear();
      yield* followCompanionLink(harness.deps, REF, { action: "open" }).pipe(
        Effect.provide(harness.layer),
      );
      expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
        [harness.item.indexedKey],
        {
          headless: undefined,
        },
      );
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
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
    pickerAnswersOnce(undefined);
    yield* followCompanionLink(harness.deps, REF, { action: "open" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
      harness.deps.app,
      expect.objectContaining({
        preselected: "default",
        problem: expect.stringContaining(BOOKS),
      }),
      expect.any(Function),
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
    pickerAnswersOnce(undefined);
    yield* followCompanionLink(harness.deps, REF, { action: "open" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
      harness.deps.app,
      expect.objectContaining({ preselected: "default", source: "bound" }),
      expect.any(Function),
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
    vi.mocked(openLiteratureNoteProfile).mockClear();
    yield* followCompanionLink(harness.deps, REF, { action: "update" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(harness.create).toHaveBeenCalledExactlyOnceWith(harness.item, {
      profile: "default",
    });
    expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
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
      expect(
        yield* followCompanionLink(harness.deps, REF, {
          action: "update",
          scope: "metadata",
        }).pipe(Effect.provide(harness.layer)),
      ).toEqual({ outcome: "metadata-no-note" });
      expect(harness.readItems).not.toHaveBeenCalled();
      expect(harness.planCreations).not.toHaveBeenCalled();
      expect(harness.create).not.toHaveBeenCalled();
      expect(harness.workspace.opened).toEqual([]);
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
      harness.feature.resolveCompanionNote.mockReturnValue(
        Effect.succeed(target),
      );
      expect(
        yield* followCompanionLink(harness.deps, REF, {
          action: "open",
          profile: PAPERS,
        }).pipe(Effect.provide(harness.layer)),
      ).toEqual({ outcome: "refused", target });
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
    harness.feature.resolveCompanionNote.mockReturnValue(
      Effect.succeed({ outcome: "existing", files: [harness.file] }),
    );
    yield* followCompanionLink(harness.deps, REF, {
      action: "update",
      profile: BOOKS,
      scope: "metadata",
    }).pipe(Effect.provide(harness.layer));
    expect(harness.workspace.opened).toHaveLength(1);
    expect(harness.excluded).toEqual([harness.file.path]);
    expect(harness.feature.updateNote).toHaveBeenCalledExactlyOnceWith(
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
      harness.feature.resolveCompanionNote.mockReturnValue(
        Effect.succeed(target),
      );
      expect(
        yield* followCompanionLink(harness.deps, REF, {
          action: "update",
          profile: "default",
        }).pipe(Effect.provide(harness.layer)),
      ).toEqual({ outcome: "opened-as-is", target });
      expect(harness.workspace.opened).toHaveLength(1);
      expect(harness.feature.updateNote).not.toHaveBeenCalled();
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
      harness.feature.resolveCompanionNote.mockReturnValue(
        Effect.succeed({ outcome: "existing", files: [harness.file] }),
      );
      yield* followCompanionLink(harness.deps, REF, {
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
    yield* followCompanionLink(harness.deps, REF, {
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
      const updateNote = vi.fn<NoteFeature["Service"]["updateNote"]>();
      const createNote = vi.fn<NoteFeature["Service"]["createNote"]>();
      const resolveCompanionNote = vi.fn<
        NoteFeature["Service"]["resolveCompanionNote"]
      >(() => Effect.succeed(target));
      const deps: InteractiveCreationPorts = {
        createProfile: vi.fn(),
        importProfile: vi.fn(),
        app: stubService<App>("App", {}),
      };
      const workspace = new MemoryWorkspace({ layoutReady: true });
      vi.mocked(openLiteratureNoteProfile).mockClear();

      const outcome = yield* followCompanionLink(deps, REF, {
        action,
        profile: PAPERS,
      }).pipe(
        Effect.provide(
          flowLayer({
            workspace,
            excluded: [],
            notifier: testNotifier(),
            feature: { resolveCompanionNote, updateNote, createNote },
          }),
        ),
      );

      expect(outcome).toEqual({ outcome: "opened-as-is", target });
      expect(workspace.opened).toEqual([openedAt("Books/Paper.md", false)]);
      expect(resolveCompanionNote).toHaveBeenCalledWith("ABCD2345", {
        profile: PAPERS,
      });
      expect(updateNote).not.toHaveBeenCalled();
      expect(createNote).not.toHaveBeenCalled();
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(companionNoteNotice(deps.app, target)).toBe(
        m.notice_literature_note_profile_kept({ label: "Books" }),
      );
    }),
);

it("tells the user of a refused link, a note kept as is, and a metadata update with no note", () => {
  const app = stubService<App>("App", {});
  const refused = {
    outcome: "refused" as const,
    diagnostic: unknownProfileDiagnostic(PAPERS),
  };
  const kept = {
    outcome: "existing" as const,
    files: [noteAt("Books/Paper.md")] as [TFile],
    keptProfile: { selector: BOOKS, label: "Books" },
  };
  expect(
    companionLinkNotice(app, { outcome: "refused", target: refused }),
  ).toBe(m.notice_literature_note_profile_unknown({ stamp: PAPERS }));
  expect(
    companionLinkNotice(app, { outcome: "opened-as-is", target: kept }),
  ).toBe(m.notice_literature_note_profile_kept({ label: "Books" }));
  expect(companionLinkNotice(app, { outcome: "metadata-no-note" })).toBe(
    m.notice_update_metadata_no_note(),
  );
  expect(
    companionLinkNotice(app, { outcome: "opened", file: noteAt("Paper.md") }),
  ).toBeUndefined();
});

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}
