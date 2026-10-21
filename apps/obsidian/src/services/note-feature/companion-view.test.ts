// @vitest-environment happy-dom
import { Effect } from "effect";
import { ButtonComponent } from "obsidian";
import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import type { Item, ItemRef } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { companionNoteNotice, openCompanionNote } from "./index";
import type {
  CompanionNoteDeps,
  CompanionNoteTarget,
  CreationProfileSelection,
  PreparedCreationProfile,
} from "./index";
import type { CreationPlan } from "./operations";

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

function creationHarness(selection: CreationProfileSelection) {
  const file = { path: "Papers/Study.md" } as TFile;
  const item = { ...REF, fields: { title: "A Study" } } as Item;
  const readItems = vi.fn(() =>
    Effect.succeed(new Map([[REF.indexedKey, item]])),
  );
  const create = vi.fn(async () => ({ outcome: "created" as const, file }));
  const openLinkText = vi.fn(async () => {});
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
  const deps = {
    useLedger: {
      withoutNoteUse: (_file: TFile, open: () => Promise<void>) => open(),
    },
    app: { workspace: { openLinkText } },
    zoteroReads: {
      ready: Promise.resolve({ reads: { ItemsByIndexedKeys: readItems } }),
    },
    zoteroPref: { dataDir: null },
    noteFeature: {
      resolveCompanionNote: vi.fn(
        async (): Promise<CompanionNoteTarget> => ({ outcome: "create" }),
      ),
      planCreations,
      createNote: create,
      updateNote: vi.fn(async () => ({
        bodyUpdated: true,
        duplicateRegionCount: 0,
      })),
    },
  } as unknown as CompanionNoteDeps;
  return {
    deps,
    file,
    item,
    readItems,
    create,
    openLinkText,
    planCreations,
  };
}

it.each(["open", "update"] as const)(
  "%s creates directly under the link's Profile and opens the path",
  async (action) => {
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
    await openCompanionNote(harness.deps, REF, { action, profile: PAPERS });
    expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
      [harness.item.indexedKey],
      {
        headless: PAPERS,
      },
    );
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.openLinkText).toHaveBeenCalledExactlyOnceWith(
      "Papers/Study.md",
      "",
      false,
      { active: true },
    );
  },
);

it("creates directly when a match selects the Profile for an unqualified link", async () => {
  const harness = creationHarness({
    selector: PAPERS,
    source: "match",
    shouldAsk: true,
    reason: m.profile_match_selected({ profile: "Papers" }),
  });
  vi.mocked(chooseLiteratureNoteProfile).mockClear();
  await openCompanionNote(harness.deps, REF, { action: "open" });
  expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
    [harness.item.indexedKey],
    {
      headless: undefined,
    },
  );
  expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
  expect(harness.create).toHaveBeenCalledOnce();
  expect(harness.openLinkText).toHaveBeenCalledExactlyOnceWith(
    "Papers/Study.md",
    "",
    false,
    { active: true },
  );
});

it("asks when the selected Profile is unavailable", async () => {
  const harness = creationHarness({
    selector: "default",
    source: "bound",
    shouldAsk: true,
    problem: { kind: "unavailable-profile", selector: BOOKS },
  });
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
  await openCompanionNote(harness.deps, REF, { action: "open" });
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    harness.deps.app,
    expect.objectContaining({
      preselected: "default",
      problem: expect.stringContaining(BOOKS),
    }),
  );
  expect(harness.create).not.toHaveBeenCalled();
  expect(harness.openLinkText).not.toHaveBeenCalled();
});

it("leaves a cancelled picker without a note or navigation", async () => {
  const harness = creationHarness({
    selector: "default",
    source: "bound",
    shouldAsk: true,
  });
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue(undefined);
  await openCompanionNote(harness.deps, REF, { action: "open" });
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    harness.deps.app,
    expect.objectContaining({ preselected: "default", source: "bound" }),
  );
  expect(harness.create).not.toHaveBeenCalled();
  expect(harness.openLinkText).not.toHaveBeenCalled();
});

it("creates directly when only Default is available", async () => {
  const harness = creationHarness({
    selector: "default",
    source: "bound",
    shouldAsk: false,
  });
  vi.mocked(chooseLiteratureNoteProfile).mockClear();
  await openCompanionNote(harness.deps, REF, { action: "update" });
  expect(harness.create).toHaveBeenCalledExactlyOnceWith(harness.item, {
    profile: "default",
  });
  expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
  expect(harness.planCreations).toHaveBeenCalledOnce();
  expect(harness.openLinkText).toHaveBeenCalledOnce();
});

it("keeps metadata-only missing-note updates outside the create flow", async () => {
  const harness = creationHarness({
    selector: "default",
    source: "bound",
    shouldAsk: false,
  });
  await openCompanionNote(harness.deps, REF, {
    action: "update",
    scope: "metadata",
  });
  expect(harness.readItems).not.toHaveBeenCalled();
  expect(harness.planCreations).not.toHaveBeenCalled();
  expect(harness.create).not.toHaveBeenCalled();
  expect(harness.openLinkText).not.toHaveBeenCalled();
});

it("refuses an unknown URL Profile without opening or starting creation", async () => {
  const harness = creationHarness({
    selector: "default",
    source: "bound",
    shouldAsk: false,
  });
  const target = {
    outcome: "refused" as const,
    diagnostic: unknownProfileDiagnostic(PAPERS),
  };
  vi.mocked(harness.deps.noteFeature.resolveCompanionNote).mockResolvedValue(
    target,
  );
  await openCompanionNote(harness.deps, REF, {
    action: "open",
    profile: PAPERS,
  });
  expect(harness.openLinkText).not.toHaveBeenCalled();
  expect(harness.readItems).not.toHaveBeenCalled();
  expect(companionNoteNotice(harness.deps.app, target)).toBe(
    m.notice_literature_note_profile_unknown({ stamp: PAPERS }),
  );
});

it("opens a matching existing note and updates under its stamp", async () => {
  const harness = creationHarness({
    selector: BOOKS,
    source: "headless",
    shouldAsk: true,
  });
  vi.mocked(harness.deps.noteFeature.resolveCompanionNote).mockResolvedValue({
    outcome: "existing",
    files: [harness.file],
  });
  await openCompanionNote(harness.deps, REF, {
    action: "update",
    profile: BOOKS,
    scope: "metadata",
  });
  expect(harness.openLinkText).toHaveBeenCalledOnce();
  expect(harness.deps.noteFeature.updateNote).toHaveBeenCalledExactlyOnceWith(
    harness.file,
    { indexedKey: "ABCD2345", scope: "metadata" },
  );
  expect(harness.create).not.toHaveBeenCalled();
});

it("opens an unknown existing stamp with recovery, while leaving its content unchanged", async () => {
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
  vi.mocked(harness.deps.noteFeature.resolveCompanionNote).mockResolvedValue(
    target,
  );
  await openCompanionNote(harness.deps, REF, {
    action: "update",
    profile: "default",
  });
  expect(harness.openLinkText).toHaveBeenCalledOnce();
  expect(harness.deps.noteFeature.updateNote).not.toHaveBeenCalled();
  expect(harness.create).not.toHaveBeenCalled();
  const notice = companionNoteNotice(
    harness.deps.app,
    target,
  ) as DocumentFragment;
  expect(notice.textContent).toContain(
    m.notice_literature_note_profile_unknown({ stamp: `Missing (${PAPERS})` }),
  );
  expect(buttonText).toHaveBeenLastCalledWith(m.profile_switch_recovery());
});

it.each(["tab", "split", "window"] as const)(
  "opens an existing note in a new %s when the link names one",
  async (paneType) => {
    const harness = creationHarness({
      selector: BOOKS,
      source: "headless",
      shouldAsk: false,
    });
    vi.mocked(harness.deps.noteFeature.resolveCompanionNote).mockResolvedValue({
      outcome: "existing",
      files: [harness.file],
    });
    await openCompanionNote(harness.deps, REF, { action: "open", paneType });
    expect(harness.openLinkText).toHaveBeenCalledExactlyOnceWith(
      "Papers/Study.md",
      "",
      paneType,
      { active: true },
    );
  },
);

it("opens a note it just created in the pane the link names", async () => {
  const harness = creationHarness({
    selector: "default",
    source: "bound",
    shouldAsk: false,
  });
  await openCompanionNote(harness.deps, REF, {
    action: "open",
    paneType: "window",
  });
  expect(harness.openLinkText).toHaveBeenCalledExactlyOnceWith(
    "Papers/Study.md",
    "",
    "window",
    { active: true },
  );
});

it("names Default in the kept-Profile notice for an unstamped note", () => {
  expect(
    companionNoteNotice({} as App, {
      outcome: "existing",
      files: [{ path: "Paper.md" } as TFile],
      keptProfile: { selector: "default", label: undefined },
    }),
  ).toBe(
    m.notice_literature_note_profile_kept({
      label: m.settings_profile_default_name(),
    }),
  );
});

it.each(["open", "update"] as const)(
  "%s opens a conflicting stamped note without updating it or asking",
  async (action) => {
    const file = { path: "Books/Paper.md" } as TFile;
    const target = {
      outcome: "existing" as const,
      files: [file] as [TFile],
      keptProfile: { selector: BOOKS, label: "Books" },
    };
    const openLinkText = vi.fn(async () => {});
    const updateNote = vi.fn();
    const createNote = vi.fn();
    const resolveCompanionNote = vi.fn(async () => target);
    const deps = {
      useLedger: {
        withoutNoteUse: (_file: TFile, open: () => Promise<void>) => open(),
      },
      app: { workspace: { openLinkText } } as unknown as App,
      noteFeature: { resolveCompanionNote, updateNote, createNote },
    } as unknown as CompanionNoteDeps;
    vi.mocked(chooseLiteratureNoteProfile).mockClear();

    await openCompanionNote(deps, REF, { action, profile: PAPERS });

    expect(openLinkText).toHaveBeenCalledExactlyOnceWith(
      "Books/Paper.md",
      "",
      false,
      { active: true },
    );
    expect(resolveCompanionNote).toHaveBeenCalledWith("ABCD2345", {
      profile: PAPERS,
    });
    expect(updateNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(companionNoteNotice(deps.app, target)).toBe(
      m.notice_literature_note_profile_kept({ label: "Books" }),
    );
  },
);
