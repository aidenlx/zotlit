import { Effect } from "effect";
import { Keymap, MarkdownView, Platform, TFile } from "obsidian";
import type { App, Instruction, Modifier, WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeItem } from "@zotlit/db/test-utils";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { openAttachments } from "@/lib/attachment-open";
import type { ProfileId } from "@/lib/profile-stamp";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import type { SearchHit } from "@/services/item-lookup/service";
import { defaults } from "@/services/settings/schema";
import { DEFAULT_LITERATURE_NOTE_PROFILE } from "@/services/settings/schema";

import { QuickSwitchModal } from "./modal";
import type { QuickSwitchDeps } from "./register";

// The picker's reader stays real, so the chord still exercises the reader the
// plugin builds; only the database lookup behind it is stubbed.
const literatureNoteAttachments =
  vi.fn<(indexedKey: string) => Promise<ObsidianOpenableAttachment[]>>();

vi.mock("@/lib/attachment-open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachment-open")>()),
  openAttachments: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function file(path: string): TFile {
  return Object.assign(new TFile(), { path });
}

function searchHit(indexedKey: string): SearchHit {
  return {
    item: makeItem(
      {
        itemType: "journalArticle",
        key: indexedKey,
        title: "Paper",
      },
      { key: indexedKey, indexedKey },
    ),
    matches: [],
    library: null,
    cited: false,
  };
}

function openable(indexedKey: string): ObsidianOpenableAttachment {
  return {
    indexedKey,
    label: `Attachment ${indexedKey}`,
    openPath: `${indexedKey}.pdf`,
    absolutePath: `/Zotero/storage/${indexedKey}/${indexedKey}.pdf`,
  };
}

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
  const deps = stubService<QuickSwitchDeps>("QuickSwitchDeps", {
    app: stubService<App>("App", {}),
    lookup: stubService<QuickSwitchDeps["lookup"]>("ItemLookup", {
      openSession: vi.fn(),
    }),
    noteFeature: stubService<QuickSwitchDeps["noteFeature"]>(
      "NoteFeatureHandle",
      {
        createNoteInteractively: vi.fn(),
      },
    ),
    noteIndex: stubService<QuickSwitchDeps["noteIndex"]>("NoteIndex", {
      getNotesByItemKey: vi.fn().mockReturnValue([]),
    }),
    settings: stubService<QuickSwitchDeps["settings"]>("PluginSettings", {
      current: Effect.succeed(defaults),
    }),
    bridge: stubService<QuickSwitchDeps["bridge"]>("EffectBridge", {
      runSync: Effect.runSync,
    }),
  });
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
    const open = vi.fn<QuickSwitchDeps["opener"]["open"]>(async () => ({
      kind: "reader",
    }));
    onPlatform(true);
    const getNotesByItemKey = vi.fn().mockReturnValue([]);
    const deps = stubService<QuickSwitchDeps>("QuickSwitchDeps", {
      app: stubService<App>("App", {}),
      lookup: stubService<QuickSwitchDeps["lookup"]>("ItemLookup", {
        openSession: vi.fn(),
      }),
      noteFeature: stubService<QuickSwitchDeps["noteFeature"]>(
        "NoteFeatureHandle",
        {
          createNoteInteractively: vi.fn(),
        },
      ),
      noteIndex: stubService<QuickSwitchDeps["noteIndex"]>("NoteIndex", {
        getNotesByItemKey,
        whenIndexed: vi.fn(),
      }),
      settings: stubService<QuickSwitchDeps["settings"]>("PluginSettings", {
        current: Effect.succeed(defaults),
      }),
      bridge: stubService<QuickSwitchDeps["bridge"]>("EffectBridge", {
        runSync: Effect.runSync,
      }),
      attachments: stubService<QuickSwitchDeps["attachments"]>(
        "LiteratureNoteAttachments",
        { literatureNoteAttachments },
      ),
      opener: stubService<QuickSwitchDeps["opener"]>("TargetOpener", { open }),
    });
    return { deps, modal: new QuickSwitchModal(deps), getNotesByItemKey, open };
  }

  it("resolves the Item's Attachments instead of its note on Shift+Enter", async () => {
    const { deps, modal, getNotesByItemKey } = pdfDeps();
    const attachments = [openable("ATCH1")];
    literatureNoteAttachments.mockResolvedValue(attachments);

    await modal.onChooseSuggestion(searchHit("PAPER234"), {
      shiftKey: true,
    } as KeyboardEvent);

    expect(literatureNoteAttachments).toHaveBeenCalledWith("PAPER234");
    expect(openAttachments).toHaveBeenCalledExactlyOnceWith(attachments, {
      reader: expect.anything(),
      app: deps.app,
    });
    expect(getNotesByItemKey).not.toHaveBeenCalled();
  });

  it("honors Mod+Shift+Enter's new-pane request, however many Attachments resolve", async () => {
    const { modal, open } = pdfDeps();
    const opened = openable("ATCH1");
    literatureNoteAttachments.mockResolvedValue([opened]);
    using _mod = vi.spyOn(Keymap, "isModEvent").mockReturnValue(true);

    await modal.onChooseSuggestion(searchHit("PAPER234"), {
      shiftKey: true,
      metaKey: true,
    } as KeyboardEvent);

    const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
    void reader.open(opened, false);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      { kind: "attachment", attachmentKey: "ATCH1" },
      true,
    );
  });
});

describe("QuickSwitchModal Profile creation", () => {
  function creationDeps(existing?: TFile) {
    onPlatform(true);
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const createNoteInteractively = vi.fn<
      QuickSwitchDeps["noteFeature"]["createNoteInteractively"]
    >(async () => null);
    const openLinkText = vi.fn(async () => {});
    const app = stubService<App>("App", {
      metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
        getFileCache: () => ({
          frontmatter: { "zotlit-profile": `Books (${books})` },
        }),
      }),
      workspace: stubService<App["workspace"]>("Workspace", {
        openLinkText,
        getLeavesOfType: vi.fn((): WorkspaceLeaf[] => []),
        revealLeaf: vi.fn(async () => {}),
        setActiveLeaf: vi.fn(),
      }),
    });
    const deps = stubService<QuickSwitchDeps>("QuickSwitchDeps", {
      app,
      noteIndex: stubService<QuickSwitchDeps["noteIndex"]>("NoteIndex", {
        whenIndexed: async () => {},
        getNotesByItemKey: () => (existing ? [existing] : []),
      }),
      noteFeature: stubService<QuickSwitchDeps["noteFeature"]>(
        "NoteFeatureHandle",
        { createNoteInteractively },
      ),
      settings: stubService<QuickSwitchDeps["settings"]>("PluginSettings", {
        current: Effect.succeed({
          ...defaults,
          ...profileSettings([{ id: books, label: "Books" }]),
        }),
      }),
      bridge: stubService<QuickSwitchDeps["bridge"]>("EffectBridge", {
        runSync: Effect.runSync,
      }),
    });
    return {
      deps,
      createNoteInteractively,
      openLinkText,
      modal: makeQuickSwitchModal(deps),
    };
  }

  it("opens an existing stamped note without a picker or a Profile change", async () => {
    const { modal, deps, openLinkText } = creationDeps(
      file("Books/Existing.md"),
    );
    await modal.onChooseSuggestion(searchHit("PAPER234"), {} as KeyboardEvent);
    expect(openLinkText).toHaveBeenCalledWith("Books/Existing.md", "", false, {
      active: true,
    });
    expect(
      vi.mocked(deps.noteFeature.createNoteInteractively),
    ).not.toHaveBeenCalled();
  });

  async function chooseOpenNote(newPane: boolean) {
    const openFile = file("Books/Existing.md");
    const { modal, deps, openLinkText } = creationDeps(openFile);
    const view = Object.assign(
      new MarkdownView(
        stubService<WorkspaceLeaf>("WorkspaceLeaf", {
          updateHeader: vi.fn(),
        }),
      ),
      { file: openFile },
    );
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      updateHeader: vi.fn(),
    });
    Object.defineProperty(leaf, "view", { value: view });
    vi.mocked(deps.app.workspace.getLeavesOfType).mockReturnValue([leaf]);
    using _mod = vi.spyOn(Keymap, "isModEvent").mockReturnValue(newPane);

    await modal.onChooseSuggestion(searchHit("PAPER234"), {} as KeyboardEvent);
    return { file: openFile, leaf, deps, openLinkText };
  }

  it("reveals the resolved note's open leaf without the new-pane modifier", async () => {
    const { leaf, deps, openLinkText } = await chooseOpenNote(false);
    expect(deps.app.workspace.revealLeaf).toHaveBeenCalledExactlyOnceWith(leaf);
    expect(deps.app.workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, {
      focus: true,
    });
    expect(openLinkText).not.toHaveBeenCalled();
    expect(
      vi.mocked(deps.noteFeature.createNoteInteractively),
    ).not.toHaveBeenCalled();
  });

  it("opens the already-open resolved note in a new pane with the new-pane modifier", async () => {
    const { file, deps, openLinkText } = await chooseOpenNote(true);
    expect(openLinkText).toHaveBeenCalledWith(file.path, "", true, {
      active: true,
    });
    expect(deps.app.workspace.revealLeaf).not.toHaveBeenCalled();
    expect(
      vi.mocked(deps.noteFeature.createNoteInteractively),
    ).not.toHaveBeenCalled();
  });

  it("creates the note through the Profile selection and opens nothing when it creates none", async () => {
    const { modal, createNoteInteractively, openLinkText } = creationDeps();
    await modal.onChooseSuggestion(searchHit("PAPER234"), {} as KeyboardEvent);
    expect(createNoteInteractively).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ indexedKey: "PAPER234" }),
    );
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it("opens the created note and preserves a request for a new pane", async () => {
    const { modal, createNoteInteractively, openLinkText } = creationDeps();
    using _mod = vi.spyOn(Keymap, "isModEvent").mockReturnValue(true);
    createNoteInteractively.mockResolvedValue(file("Books/Paper.md"));
    await modal.onChooseSuggestion(searchHit("PAPER234"), {
      metaKey: true,
    } as KeyboardEvent);
    expect(createNoteInteractively).toHaveBeenCalledOnce();
    expect(openLinkText).toHaveBeenCalledWith("Books/Paper.md", "", true, {
      active: true,
    });
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
    const deps = stubService<QuickSwitchDeps>("QuickSwitchDeps", {
      app: stubService<App>("App", {}),
      lookup: stubService<QuickSwitchDeps["lookup"]>("ItemLookup", {
        openSession: vi.fn(),
      }),
      noteFeature: stubService<QuickSwitchDeps["noteFeature"]>(
        "NoteFeatureHandle",
        {
          createNoteInteractively: vi.fn(),
        },
      ),
      noteIndex: stubService<QuickSwitchDeps["noteIndex"]>("NoteIndex", {
        getNotesByItemKey,
        whenIndexed: vi.fn(),
      }),
      settings: stubService<QuickSwitchDeps["settings"]>("PluginSettings", {
        current: Effect.succeed(defaults),
      }),
      bridge: stubService<QuickSwitchDeps["bridge"]>("EffectBridge", {
        runSync: Effect.runSync,
      }),
      showInLibrary,
    });
    const modal = new QuickSwitchModal(deps);
    const select = vi
      .spyOn(modal, "selectActiveSuggestion")
      .mockImplementation(() => {});
    const evt = { altKey: true } as KeyboardEvent;
    expect(findExactHandler(modal, ["Alt"])?.(evt)).toBe(false);
    expect(select).toHaveBeenCalledWith(evt);

    await modal.onChooseSuggestion(searchHit("ABCD2345g7"), evt);
    expect(showInLibrary).toHaveBeenCalledExactlyOnceWith("ABCD2345g7");
    expect(getNotesByItemKey).not.toHaveBeenCalled();
    expect(literatureNoteAttachments).not.toHaveBeenCalled();
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
