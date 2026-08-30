import { Keymap, Platform } from "obsidian";
import type { App, Instruction, Modifier, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirm } from "@/lib/confirm";
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

describe("QuickSwitchModal Profile creation", () => {
  function creationDeps(existing?: TFile) {
    onPlatform(true);
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const create = vi.fn(async () => ({
      outcome: "created" as const,
      file: { path: "Books/Paper.md" } as TFile,
    }));
    const openLinkText = vi.fn(async () => {});
    const preview = {
      selector: books,
      label: "Books",
      folder: "Books",
      citationStyle: null,
      document: "books.md",
      path: "Books/Paper.md",
      create,
    };
    const deps = {
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotlit-profile": `Books (${books})` },
          }),
        },
        workspace: { openLinkText },
      },
      noteIndex: {
        whenIndexed: async () => {},
        getNotesByItemKey: () => (existing ? [existing] : []),
      },
      noteFeature: {
        createNote: vi.fn(async () => ({
          outcome: "created" as const,
          file: { path: "Literature/Paper.md" } as TFile,
        })),
        resolveCreationProfile: vi.fn(async () => ({
          selector: books,
          source: "last-used" as const,
          shouldAsk: true,
        })),
        prepareCreationProfiles: vi.fn(async () => [preview]),
      },
      zoteroPref: { dataDir: null },
      settings: {
        current: {
          ...defaults,
          ...profileSettings([{ id: books, label: "Books" }]),
          "note.last-used-profile": books,
        },
      },
    };
    return {
      deps,
      books,
      preview,
      create,
      openLinkText,
      modal: makeQuickSwitchModal(deps as unknown as QuickSwitchDeps),
    };
  }

  it("opens an existing stamped note without a picker or a Profile change", async () => {
    const { modal, deps, openLinkText } = creationDeps({
      path: "Books/Existing.md",
    } as TFile);
    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      {} as KeyboardEvent,
    );
    expect(openLinkText).toHaveBeenCalledWith("Books/Existing.md", "", false, {
      active: true,
    });
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(deps.noteFeature.resolveCreationProfile).not.toHaveBeenCalled();
    expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("passes prepared rows and last-used selection to the picker and cancels silently", async () => {
    const { modal, deps, books, preview, create, openLinkText } =
      creationDeps();
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue(undefined);
    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      {} as KeyboardEvent,
    );
    expect(chooseLiteratureNoteProfile).toHaveBeenCalledWith(deps.app, {
      preselected: books,
      source: "last-used",
      previews: [preview],
      styles: [],
    });
    expect(create).not.toHaveBeenCalled();
    expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it("creates the selected preview and preserves a request for a new pane", async () => {
    const { modal, books, create, openLinkText } = creationDeps();
    using _mod = vi.spyOn(Keymap, "isModEvent").mockReturnValue(true);
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: books,
      label: "Books",
    });
    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      { metaKey: true } as KeyboardEvent,
    );
    expect(create).toHaveBeenCalledOnce();
    expect(openLinkText).toHaveBeenCalledWith("Books/Paper.md", "", true, {
      active: true,
    });
  });

  it("creates directly without loading picker previews when only Default is available", async () => {
    const { modal, deps, openLinkText } = creationDeps();
    deps.noteFeature.resolveCreationProfile.mockResolvedValue({
      selector: "default",
      source: "bound",
      shouldAsk: false,
    } as never);
    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      {} as KeyboardEvent,
    );
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(deps.noteFeature.prepareCreationProfiles).not.toHaveBeenCalled();
    expect(deps.noteFeature.createNote).toHaveBeenCalledWith(
      expect.any(Object),
      { profile: "default" },
    );
    expect(openLinkText).toHaveBeenCalledWith(
      "Literature/Paper.md",
      "",
      false,
      { active: true },
    );
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
