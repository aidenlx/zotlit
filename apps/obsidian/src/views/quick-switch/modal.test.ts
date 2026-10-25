import { Effect } from "effect";
import { Keymap, MarkdownView, Platform } from "obsidian";
import type {
  App,
  Instruction,
  Modifier,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";

import { openAttachments } from "@/lib/attachment-open";
import type { ProfileId } from "@/lib/profile-stamp";
import { resolveLiteratureNoteAttachments } from "@/services/attachment-open/actions";
import type {
  CreationProfileSelection,
  PreparedCreationProfile,
} from "@/services/note-feature";
import type { CreationPlan } from "@/services/note-feature/operations";
import { defaults } from "@/services/settings/schema";
import { DEFAULT_LITERATURE_NOTE_PROFILE } from "@/services/settings/schema";

import { QuickSwitchModal } from "./modal";
import { chooseLiteratureNoteProfile } from "./profile-picker";
import type { QuickSwitchDeps } from "./register";

vi.mock("./profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

// The picker's reader stays real, so the chord still exercises the reader the
// plugin builds; only the database lookup behind it is stubbed.
vi.mock("@/services/attachment-open/actions", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/attachment-open/actions")
  >()),
  resolveLiteratureNoteAttachments: vi.fn(),
}));

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
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
    lookup: { openSession: vi.fn() },
    noteFeature: { createNote: vi.fn() },
    noteIndex: { getNotesByItemKey: vi.fn().mockReturnValue([]) },
    settings: { current: Effect.succeed({}) },
    bridge: { runSync: Effect.runSync },
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

/** Finds the handler registered for exactly this modifier set, not just one that includes it. */
function findExactHandler(
  modal: QuickSwitchModal,
  modifiers: Modifier[],
): ((evt: KeyboardEvent) => boolean | void) | undefined {
  const scope = modal.scope as unknown as {
    handlers: {
      modifiers: Modifier[] | null;
      key: string | null;
      func: (evt: KeyboardEvent) => boolean | void;
    }[];
  };
  return scope.handlers.find(
    (h) =>
      h.key === "Enter" &&
      h.modifiers?.length === modifiers.length &&
      modifiers.every((mod) => h.modifiers?.includes(mod)),
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

  it("registers a Shift+Enter handler for the PDF chord", () => {
    onPlatform(true);
    expect(findExactHandler(makeModal(), ["Shift"])).toBeDefined();
  });

  it("registers a Mod+Shift+Enter handler for the PDF-in-new-pane chord", () => {
    onPlatform(true);
    expect(findExactHandler(makeModal(), ["Mod", "Shift"])).toBeDefined();
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

  it("advertises the PDF chord with the macOS shift glyph", () => {
    expect(capture(true)).toContain("⇧↵");
  });

  it("advertises the PDF chord as Shift off macOS", () => {
    expect(capture(false)).toContain("Shift↵");
  });
});

describe("QuickSwitchModal PDF chord", () => {
  function pdfDeps(): {
    deps: QuickSwitchDeps;
    modal: QuickSwitchModal;
    getNotesByItemKey: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  } {
    const open = vi.fn(() => Promise.resolve({ kind: "reader" }));
    onPlatform(true);
    const getNotesByItemKey = vi.fn().mockReturnValue([]);
    const deps = {
      app: {},
      lookup: { openSession: vi.fn() },
      noteFeature: { createNote: vi.fn() },
      noteIndex: { getNotesByItemKey, whenIndexed: vi.fn() },
      settings: { current: Effect.succeed({}) },
      bridge: { runSync: Effect.runSync },
      reads: { acquireRead: vi.fn() },
      zoteroPref: { dataDir: null, baseAttachmentPath: null },
      opener: { open },
    } as unknown as QuickSwitchDeps;
    return { deps, modal: new QuickSwitchModal(deps), getNotesByItemKey, open };
  }

  it("resolves the Item's Attachments instead of its note on Shift+Enter", async () => {
    const { deps, modal, getNotesByItemKey } = pdfDeps();
    const openable = [{ indexedKey: "ATCH1" }];
    vi.mocked(resolveLiteratureNoteAttachments).mockResolvedValue(
      openable as never,
    );

    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      { shiftKey: true } as KeyboardEvent,
    );

    expect(resolveLiteratureNoteAttachments).toHaveBeenCalledWith(
      deps,
      "PAPER234",
    );
    expect(openAttachments).toHaveBeenCalledExactlyOnceWith(openable, {
      reader: expect.anything(),
      app: deps.app,
    });
    expect(getNotesByItemKey).not.toHaveBeenCalled();
  });

  it("honors Mod+Shift+Enter's new-pane request, however many Attachments resolve", async () => {
    const { modal, open } = pdfDeps();
    const opened = { indexedKey: "ATCH1" };
    vi.mocked(resolveLiteratureNoteAttachments).mockResolvedValue([
      opened,
    ] as never);
    using _mod = vi.spyOn(Keymap, "isModEvent").mockReturnValue(true);

    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      { shiftKey: true, metaKey: true } as KeyboardEvent,
    );

    const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
    void reader.open(opened as never, false);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      { kind: "attachment", attachmentKey: "ATCH1" },
      true,
    );
  });
});

describe("QuickSwitchModal Profile creation", () => {
  function creationPlans(
    indexedKeys: readonly string[],
    selection: CreationProfileSelection,
    previews: readonly PreparedCreationProfile[],
  ): ReadonlyMap<string, CreationPlan> {
    return new Map(
      indexedKeys.map((indexedKey) => [
        indexedKey,
        { item: { indexedKey } as Item, selection, previews },
      ]),
    );
  }
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
        workspace: {
          openLinkText,
          getLeavesOfType: vi.fn((): WorkspaceLeaf[] => []),
          revealLeaf: vi.fn(async () => {}),
          setActiveLeaf: vi.fn(),
        },
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
        planCreations: vi.fn(async (keys: readonly string[]) =>
          creationPlans(
            keys,
            {
              selector: books,
              source: "headless" as const,
              shouldAsk: true,
            },
            [preview],
          ),
        ),
      },
      zoteroPref: { dataDir: null },
      settings: {
        current: Effect.succeed({
          ...defaults,
          ...profileSettings([{ id: books, label: "Books" }]),
        }),
      },
      bridge: { runSync: Effect.runSync },
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
    expect(deps.noteFeature.planCreations).not.toHaveBeenCalled();
    expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
  });

  async function chooseOpenNote(newPane: boolean) {
    const file = { path: "Books/Existing.md" } as TFile;
    const { modal, deps, openLinkText } = creationDeps(file);
    const leaf = {
      view: Object.assign(new MarkdownView({} as WorkspaceLeaf), { file }),
    } as unknown as WorkspaceLeaf;
    deps.app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    using _mod = vi.spyOn(Keymap, "isModEvent").mockReturnValue(newPane);

    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      {} as KeyboardEvent,
    );
    return { file, leaf, deps, openLinkText };
  }

  it("reveals the resolved note's open leaf without the new-pane modifier", async () => {
    const { leaf, deps, openLinkText } = await chooseOpenNote(false);
    expect(deps.app.workspace.revealLeaf).toHaveBeenCalledExactlyOnceWith(leaf);
    expect(deps.app.workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, {
      focus: true,
    });
    expect(openLinkText).not.toHaveBeenCalled();
    expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
  });

  it("opens the already-open resolved note in a new pane with the new-pane modifier", async () => {
    const { file, deps, openLinkText } = await chooseOpenNote(true);
    expect(openLinkText).toHaveBeenCalledWith(file.path, "", true, {
      active: true,
    });
    expect(deps.app.workspace.revealLeaf).not.toHaveBeenCalled();
    expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
  });

  it("passes prepared rows and the resolved selection to the picker and cancels silently", async () => {
    const { modal, deps, books, preview, create, openLinkText } =
      creationDeps();
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue(undefined);
    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      {} as KeyboardEvent,
    );
    expect(chooseLiteratureNoteProfile).toHaveBeenCalledWith(deps.app, {
      preselected: books,
      onNew: expect.any(Function),
      onImport: expect.any(Function),
      source: "headless",
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

  it("creates directly without opening the picker when only Default is available", async () => {
    const { modal, deps, preview, openLinkText } = creationDeps();
    deps.noteFeature.planCreations.mockImplementation(async (keys) =>
      creationPlans(
        keys,
        {
          selector: "default",
          source: "bound",
          shouldAsk: false,
        },
        [preview],
      ),
    );
    await modal.onChooseSuggestion(
      { item: { indexedKey: "PAPER234" } } as never,
      {} as KeyboardEvent,
    );
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(deps.noteFeature.planCreations).toHaveBeenCalledExactlyOnceWith(
      ["PAPER234"],
      {},
    );
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

function makeQuickSwitchModal(deps: QuickSwitchDeps): QuickSwitchModal {
  return new QuickSwitchModal(deps);
}

describe("QuickSwitchModal Show in Library chord", () => {
  it("opens the Library View on the Item at Alt+Enter, and nothing else", async () => {
    onPlatform(true);
    const showInLibrary = vi.fn(() => Promise.resolve());
    const getNotesByItemKey = vi.fn().mockReturnValue([]);
    const modal = new QuickSwitchModal({
      app: {},
      lookup: { openSession: vi.fn() },
      noteFeature: { createNote: vi.fn() },
      noteIndex: { getNotesByItemKey, whenIndexed: vi.fn() },
      settings: { current: Effect.succeed({}) },
      bridge: { runSync: Effect.runSync },
      showInLibrary,
    } as unknown as QuickSwitchDeps);
    const select = vi
      .spyOn(modal, "selectActiveSuggestion")
      .mockImplementation(() => {});
    const evt = { altKey: true } as KeyboardEvent;
    expect(findExactHandler(modal, ["Alt"])?.(evt)).toBe(false);
    expect(select).toHaveBeenCalledWith(evt);

    await modal.onChooseSuggestion(
      { item: { indexedKey: "ABCD2345g7" } } as never,
      evt,
    );
    expect(showInLibrary).toHaveBeenCalledExactlyOnceWith("ABCD2345g7");
    expect(getNotesByItemKey).not.toHaveBeenCalled();
    expect(resolveLiteratureNoteAttachments).not.toHaveBeenCalled();
  });

  it("advertises the chord with the option glyph on macOS and Alt elsewhere", () => {
    const commands = (isMacOS: boolean) => {
      onPlatform(isMacOS);
      let captured: Instruction[] = [];
      vi.spyOn(
        QuickSwitchModal.prototype,
        "setInstructions",
      ).mockImplementation((instructions: Instruction[]) => {
        captured = instructions;
      });
      makeModal();
      return captured.map((i) => `${i.command} ${i.purpose}`);
    };
    expect(commands(true)).toContain("⌥↵ to show in library");
    expect(commands(false)).toContain("Alt↵ to show in library");
  });
});
