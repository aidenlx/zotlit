import { Platform } from "obsidian";
import type { App, Instruction, Modifier, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirm } from "@/lib/confirm";

import { QuickSwitchModal } from "./modal";
import { chooseLiteratureNoteProfile } from "./profile-picker";
import type { QuickSwitchDeps } from "./register";

vi.mock("@/lib/confirm", () => ({ confirm: vi.fn() }));
vi.mock("./profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

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
  return new QuickSwitchModal(deps);
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
    const currentId = "36c4f8b4-4f65-4cab-8c51-c921ea616cc8";
    const requestedId = "93f0df01-9de9-47e6-aa12-1ff770c1ab86";
    const file = { path: "Literature/Existing.md" } as TFile;
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
      id: requestedId,
      label: "Papers",
    });
    vi.mocked(confirm).mockResolvedValue(false);
    const openLinkText = vi.fn(async () => {});
    const modal = new QuickSwitchModal({
      app: {
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotlit-profile": currentId },
          }),
        },
        workspace: { openLinkText },
      },
      lookup: { search: vi.fn().mockReturnValue([]) },
      noteFeature: { createNote: vi.fn(), switchNoteProfile: vi.fn() },
      noteIndex: { getNotesByItemKey: () => [file] },
      settings: {
        current: {
          "note.profiles": [
            { id: currentId, label: "Books" },
            { id: requestedId, label: "Papers" },
          ],
        },
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
});
