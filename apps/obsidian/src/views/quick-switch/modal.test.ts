import { Platform } from "obsidian";
import type { App, Instruction, Modifier, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirm, confirmWithCheckbox } from "@/lib/confirm";
import type { ProfileId } from "@/lib/profile-stamp";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import { DEFAULT_LITERATURE_NOTE_PROFILE } from "@/services/settings/schema";

import {
  QuickSwitchModal,
  switchImportedNoteProfile as switchProfile,
} from "./modal";
import { chooseLiteratureNoteProfile } from "./profile-picker";
import type { QuickSwitchDeps } from "./register";

vi.mock("@/lib/confirm", () => ({
  confirm: vi.fn(),
  confirmWithCheckbox: vi.fn(),
}));
vi.mock("./profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function profileSettings(profiles: { id: ProfileId; label: string }[] = []): {
  "note.default-profile": typeof DEFAULT_LITERATURE_NOTE_PROFILE;
  profiles: typeof profiles;
} {
  return {
    "note.default-profile": DEFAULT_LITERATURE_NOTE_PROFILE,
    profiles: profiles,
  };
}

function onPlatform(isMacOS: boolean): void {
  vi.spyOn(Platform, "isMacOS", "get").mockReturnValue(isMacOS);
}

function makeModal(): QuickSwitchModal {
  const deps = {
    app: {} as App,
    lookup: { search: vi.fn().mockReturnValue([]) },
    noteFeature: { createNote: vi.fn() },
    noteIndex: { getNotesByItemKey: vi.fn().mockReturnValue([]) },
    settings: { current: {} },
  } as unknown as QuickSwitchDeps;
  return makeQuickSwitchModal(deps);
}

function findHandler(
  modal: QuickSwitchModal,
  modifier: Modifier,
): ((evt: KeyboardEvent) => boolean | void) | undefined {
  const scope = modal.scope as unknown as {
    handlers: {
      modifiers: Modifier[] | null;
      key: string | null;
      func: (evt: KeyboardEvent) => boolean | void;
    }[];
  };
  return scope.handlers.find(
    (h) => h.key === "Enter" && h.modifiers?.includes(modifier),
  )?.func;
}

/**
 * Same defect as discussion #644, in the quick switcher: the modal advertised
 * a Mod+Enter chord for "open in new pane", but Obsidian's suggestion popup
 * registers `Enter` with no modifiers and matches them exactly, so the
 * keypress reached no handler and the modal just sat there.
 */
describe("QuickSwitchModal keymap", () => {
  it("registers a Mod+Enter handler", () => {
    onPlatform(true);

    expect(findHandler(makeModal(), "Mod")).toBeDefined();
  });

  it("selects the highlighted suggestion when Mod+Enter fires", () => {
    onPlatform(true);
    const modal = makeModal();
    const select = vi
      .spyOn(modal, "selectActiveSuggestion")
      .mockImplementation(() => {});
    const evt = { metaKey: true } as KeyboardEvent;

    const result = findHandler(modal, "Mod")?.(evt);

    expect(select).toHaveBeenCalledWith(evt);
    // Returning false tells Obsidian the chord was consumed.
    expect(result).toBe(false);
  });
});

describe("QuickSwitchModal instructions", () => {
  function capture(isMacOS: boolean): string[] {
    onPlatform(isMacOS);
    let captured: Instruction[] = [];
    vi.spyOn(QuickSwitchModal.prototype, "setInstructions").mockImplementation(
      (instructions: Instruction[]) => {
        captured = instructions;
      },
    );
    makeModal();
    return captured.map((i) => i.command);
  }

  it("labels the new-pane chord with the macOS command glyph", () => {
    expect(capture(true)).toContain("⌘↵");
  });

  it("labels the new-pane chord as Ctrl off macOS", () => {
    // The reporter of #644 was on Linux, where a hardcoded ⌘ names a key the
    // keyboard does not have.
    expect(capture(false)).toContain("Ctrl↵");
  });
});

describe("QuickSwitchModal Profile conflicts", () => {
  it("names both the current and requested Profiles in the decision", async () => {
    const currentId = "Bk3Qn7XvT2Lp" as ProfileId;
    const requestedId = "Rz9Wm4YfH6Kd" as ProfileId;
    const file = { path: "Literature/Existing.md" } as TFile;
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: requestedId,
      label: "Papers",
    });
    vi.mocked(confirm).mockResolvedValue(false);
    const openLinkText = vi.fn(async () => {});
    const modal = makeQuickSwitchModal({
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotlit-profile": currentId },
          }),
        },
        workspace: { openLinkText },
      },
      lookup: { search: vi.fn().mockReturnValue([]) },
      noteFeature: {
        createNote: vi.fn(),
        getImportedNotesForItem: vi.fn().mockResolvedValue([]),
        switchImportedNoteProfile: vi.fn(),
        switchNoteProfile: vi.fn(),
      },
      noteIndex: { getNotesByItemKey: () => [file] },
      settings: {
        loaded: Promise.resolve(
          profileSettings([
            { id: currentId, label: "Books" },
            { id: requestedId, label: "Papers" },
          ]),
        ),
      },
    } as unknown as QuickSwitchDeps);

    await modal.onChooseSuggestion(
      { item: { indexedKey: "ABC12345" } } as never,
      {} as KeyboardEvent,
    );

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Books"),
        action: "Switch to “Papers”",
        cancel: "Keep “Books”",
      }),
      expect.anything(),
    );
    expect(openLinkText).toHaveBeenCalledWith(
      file.path,
      "",
      expect.any(Boolean),
      { active: true },
    );
  });

  it("names the current Profile from a full-form stamp", async () => {
    const currentId = "Bk3Qn7XvT2Lp" as ProfileId;
    const requestedId = "Rz9Wm4YfH6Kd" as ProfileId;
    const file = { path: "Literature/Existing.md" } as TFile;
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: requestedId,
      label: "Papers",
    });
    vi.mocked(confirm).mockResolvedValue(false);
    const modal = makeQuickSwitchModal({
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotlit-profile": "Books (Bk3Qn7XvT2Lp)" },
          }),
        },
        workspace: { openLinkText: vi.fn() },
      },
      lookup: { search: vi.fn().mockReturnValue([]) },
      noteFeature: {
        createNote: vi.fn(),
        getImportedNotesForItem: vi.fn().mockResolvedValue([]),
        switchImportedNoteProfile: vi.fn(),
        switchNoteProfile: vi.fn(),
      },
      noteIndex: { getNotesByItemKey: () => [file] },
      settings: {
        loaded: Promise.resolve(
          profileSettings([
            { id: currentId, label: "Books" },
            { id: requestedId, label: "Papers" },
          ]),
        ),
      },
    } as unknown as QuickSwitchDeps);

    await modal.onChooseSuggestion(
      { item: { indexedKey: "ABC12345" } } as never,
      {} as KeyboardEvent,
    );

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ cancel: "Keep “Books”" }),
      expect.anything(),
    );
  });

  it("keeps the note when a full-form stamp already names the chosen Profile", async () => {
    const currentId = "Bk3Qn7XvT2Lp" as ProfileId;
    const file = { path: "Literature/Existing.md" } as TFile;
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: currentId,
      label: "Books",
    });
    const switchNoteProfile = vi.fn();
    const modal = makeQuickSwitchModal({
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotlit-profile": "Books (Bk3Qn7XvT2Lp)" },
          }),
        },
        workspace: { openLinkText: vi.fn() },
      },
      lookup: { search: vi.fn().mockReturnValue([]) },
      noteFeature: {
        createNote: vi.fn(),
        getImportedNotesForItem: vi.fn().mockResolvedValue([]),
        switchImportedNoteProfile: vi.fn(),
        switchNoteProfile,
      },
      noteIndex: { getNotesByItemKey: () => [file] },
      settings: {
        loaded: Promise.resolve(
          profileSettings([{ id: currentId, label: "Books" }]),
        ),
      },
    } as unknown as QuickSwitchDeps);

    await modal.onChooseSuggestion(
      { item: { indexedKey: "ABC12345" } } as never,
      {} as KeyboardEvent,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(switchNoteProfile).not.toHaveBeenCalled();
  });

  it("passes the counted family only when the option is checked", async () => {
    const currentId = "Bk3Qn7XvT2Lp" as ProfileId;
    const requestedId = "Rz9Wm4YfH6Kd" as ProfileId;
    const file = { path: "Literature/Existing.md" } as TFile;
    const imported = [
      { path: "Imported/First.md" },
      { path: "Imported/Second.md" },
    ] as TFile[];
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: requestedId,
      label: "Papers",
    });
    vi.mocked(confirmWithCheckbox)
      .mockResolvedValueOnce({ confirmed: true, checked: true })
      .mockResolvedValueOnce({ confirmed: true, checked: false });
    const switchNoteProfile = vi.fn().mockResolvedValue({
      bodyUpdated: true,
      duplicateRegionCount: 0,
    });
    const modal = makeQuickSwitchModal({
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotlit-profile": currentId },
          }),
        },
        workspace: { openLinkText: vi.fn() },
      },
      lookup: { search: vi.fn().mockReturnValue([]) },
      noteFeature: {
        createNote: vi.fn(),
        getImportedNotesForItem: vi.fn().mockResolvedValue(imported),
        switchImportedNoteProfile: vi.fn(),
        switchNoteProfile,
      },
      noteIndex: { getNotesByItemKey: () => [file] },
      settings: {
        loaded: Promise.resolve(
          profileSettings([
            { id: currentId, label: "Books" },
            { id: requestedId, label: "Papers" },
          ]),
        ),
      },
    } as unknown as QuickSwitchDeps);

    await modal.onChooseSuggestion(
      { item: { indexedKey: "ABC12345" } } as never,
      {} as KeyboardEvent,
    );

    expect(confirmWithCheckbox).toHaveBeenCalledWith(
      expect.objectContaining({
        checkbox: "Also switch this item's 2 imported notes",
      }),
      expect.anything(),
    );
    expect(switchNoteProfile).toHaveBeenCalledWith(file, {
      indexedKey: "ABC12345",
      profile: requestedId,
      importedNotes: imported,
    });

    switchNoteProfile.mockClear();
    await modal.onChooseSuggestion(
      { item: { indexedKey: "ABC12345" } } as never,
      {} as KeyboardEvent,
    );

    expect(switchNoteProfile).toHaveBeenCalledWith(file, {
      indexedKey: "ABC12345",
      profile: requestedId,
      importedNotes: undefined,
    });
  });
});

describe("Imported Note Profile switching", () => {
  it("states that the switch applies on the next re-import", async () => {
    const currentId = "Bk3Qn7XvT2Lp" as ProfileId;
    const requestedId = "Rz9Wm4YfH6Kd" as ProfileId;
    const file = { path: "Imported/Existing.md" } as TFile;
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: requestedId,
      label: "Papers",
    });
    vi.mocked(confirm).mockResolvedValue(true);
    const switchProfile = vi.fn().mockResolvedValue({
      bodyUpdated: false,
      duplicateRegionCount: 0,
    });
    const deps = {
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotlit-profile": currentId },
          }),
        },
      },
      noteFeature: { switchImportedNoteProfile: switchProfile },
      settings: {
        loaded: Promise.resolve(
          profileSettings([
            { id: currentId, label: "Books" },
            { id: requestedId, label: "Papers" },
          ]),
        ),
      },
    } as unknown as QuickSwitchDeps;

    await switchImportedNoteProfile(deps, file);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/next time.*update.*from Zotero/i),
      }),
      expect.anything(),
    );
    expect(switchProfile).toHaveBeenCalledWith(file, {
      profile: requestedId,
    });
  });

  it("leaves the Imported Note unchanged when consent is declined", async () => {
    const file = { path: "Imported/Existing.md" } as TFile;
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: "Rz9Wm4YfH6Kd" as ProfileId,
      label: "Papers",
    });
    vi.mocked(confirm).mockResolvedValue(false);
    const switchProfile = vi.fn();

    await switchImportedNoteProfile(
      {
        app: {
          metadataCache: {
            getFileCache: () => ({ frontmatter: {} }),
          },
        },
        noteFeature: { switchImportedNoteProfile: switchProfile },
        settings: {
          loaded: Promise.resolve(
            profileSettings([
              { id: "Rz9Wm4YfH6Kd" as ProfileId, label: "Papers" },
            ]),
          ),
        },
      } as unknown as QuickSwitchDeps,
      file,
    );

    expect(switchProfile).not.toHaveBeenCalled();
  });
});

function readerFor(deps: QuickSwitchDeps) {
  let settings = { ...defaults, ...deps.settings.current };
  const reader = profileReader(() => settings, deps.app.metadataCache);
  return Object.assign(reader, {
    ready:
      deps.settings.loaded?.then((value) => {
        settings = { ...defaults, ...value };
      }) ?? Promise.resolve(),
  });
}
function makeQuickSwitchModal(deps: QuickSwitchDeps): QuickSwitchModal {
  return new QuickSwitchModal({ ...deps, profile: readerFor(deps) });
}
function switchImportedNoteProfile(
  ...[deps, file]: Parameters<typeof switchProfile>
) {
  return switchProfile({ ...deps, profile: readerFor(deps) }, file);
}
