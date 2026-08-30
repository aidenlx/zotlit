// @vitest-environment happy-dom
import { ButtonComponent } from "obsidian";
import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import { getItemsByID } from "@zotlit/db";
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
} from "./index";

vi.mock("@zotlit/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@zotlit/db")>()),
  getItemsByID: vi.fn(),
}));

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

function creationHarness(selection: CreationProfileSelection) {
  const file = { path: "Papers/Study.md" } as TFile;
  const item = { ...REF, fields: { title: "A Study" } } as Item;
  vi.mocked(getItemsByID).mockReturnValue([item]);
  const released = vi.fn();
  const acquireRead = vi.fn(async () => ({
    client: {},
    [Symbol.dispose]: released,
  }));
  const create = vi.fn(async () => ({ outcome: "created" as const, file }));
  const openLinkText = vi.fn(async () => {});
  const resolveCreationProfile = vi.fn(async () => selection);
  const prepareCreationProfiles = vi.fn(async () => [
    {
      selector: selection.selector,
      label: "Papers",
      folder: "Papers",
      citationStyle: null,
      path: file.path,
      create,
    },
  ]);
  const deps = {
    app: { workspace: { openLinkText } },
    db: { acquireRead },
    zoteroPref: { dataDir: null },
    noteFeature: {
      resolveCompanionNote: vi.fn(
        async (): Promise<CompanionNoteTarget> => ({ outcome: "create" }),
      ),
      resolveCreationProfile,
      prepareCreationProfiles,
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
    acquireRead,
    released,
    create,
    openLinkText,
    resolveCreationProfile,
    prepareCreationProfiles,
  };
}

it.each(["open", "update"] as const)(
  "%s asks with the link preselected, releases the DB before the picker, and opens the confirmed path",
  async (action) => {
    const harness = creationHarness({
      selector: PAPERS,
      source: "headless",
      shouldAsk: true,
    });
    vi.mocked(chooseLiteratureNoteProfile).mockImplementation(
      async (_app, options) => {
        expect(harness.released).toHaveBeenCalledOnce();
        expect(options).toMatchObject({
          preselected: PAPERS,
          source: "headless",
          previews: [{ path: "Papers/Study.md" }],
        });
        return { id: PAPERS, label: "Papers" };
      },
    );
    await openCompanionNote(harness.deps, REF, { action, profile: PAPERS });
    expect(harness.resolveCreationProfile).toHaveBeenCalledExactlyOnceWith({
      headless: PAPERS,
    });
    expect(harness.create).toHaveBeenCalledOnce();
    expect(harness.openLinkText).toHaveBeenCalledExactlyOnceWith(
      "Papers/Study.md",
      "",
      false,
      { active: true },
    );
  },
);

it("leaves a cancelled picker without a note or navigation", async () => {
  const harness = creationHarness({
    selector: BOOKS,
    source: "last-used",
    shouldAsk: true,
  });
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue(undefined);
  await openCompanionNote(harness.deps, REF, { action: "open" });
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    harness.deps.app,
    expect.objectContaining({ preselected: BOOKS, source: "last-used" }),
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
  expect(harness.prepareCreationProfiles).not.toHaveBeenCalled();
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
  expect(harness.acquireRead).not.toHaveBeenCalled();
  expect(harness.resolveCreationProfile).not.toHaveBeenCalled();
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
  expect(harness.acquireRead).not.toHaveBeenCalled();
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
