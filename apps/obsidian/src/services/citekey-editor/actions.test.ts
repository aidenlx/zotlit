import { EditorState } from "@codemirror/state";
import { createMockPlugin } from "@mock/obsidian";
import type { Editor } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { NavigationPane } from "@/services/citekey-navigation";

import { addCitekeyEditorActions } from "./actions";

/** Every command id, in registration order. */
const ALL_COMMAND_IDS = [
  "open-citekey",
  "open-citekey-new-tab",
  "open-citekey-right",
  "open-citekey-window",
];

/** An editor whose cursor sits at `head` of `doc`. */
function editorAt(doc: string, head: number): Editor {
  return {
    cm: { state: EditorState.create({ doc, selection: { anchor: head } }) },
  } as never;
}

function setup(enabled: boolean): {
  plugin: ReturnType<typeof createMockPlugin>;
  opened: [citekey: string, pane: NavigationPane][];
  /** Run one command's check callback; `checking` asks palette visibility. */
  run: (id: string, editor: Editor, checking: boolean) => boolean;
} {
  const opened: [string, NavigationPane][] = [];
  const plugin = createMockPlugin();
  addCitekeyEditorActions(plugin, {
    citekeyEditor: {
      navigationEnabled: enabled,
      openCitekey: vi.fn((citekey: string, pane: NavigationPane) => {
        opened.push([citekey, pane]);
        return Promise.resolve();
      }),
    },
  });
  return {
    plugin,
    opened,
    run: (id, editor, checking) =>
      plugin.commands
        .get(id)
        ?.editorCheckCallback?.(checking, editor, null as never) === true,
  };
}

describe("addCitekeyEditorActions", () => {
  it("registers one command per pane", () => {
    const { plugin } = setup(true);
    expect([...plugin.commands.keys()]).toEqual(ALL_COMMAND_IDS);
  });

  it("ships no default hotkey", () => {
    const { plugin } = setup(true);
    for (const command of plugin.commands.values()) {
      expect(command.hotkeys).toBeUndefined();
    }
  });

  it("opens the citekey under the cursor in the command's own pane", () => {
    const { opened, run } = setup(true);
    const editor = editorAt("See @doe2024 here.", 8);

    expect(run("open-citekey", editor, true)).toBe(true);
    expect(opened).toEqual([]);

    for (const id of ALL_COMMAND_IDS) {
      expect(run(id, editor, false)).toBe(true);
    }
    expect(opened).toEqual([
      ["doe2024", false],
      ["doe2024", "tab"],
      ["doe2024", "split"],
      ["doe2024", "window"],
    ]);
  });

  it("leaves the palette while the cursor is off a citekey", () => {
    const { opened, run } = setup(true);
    expect(run("open-citekey", editorAt("plain text", 3), true)).toBe(false);
    expect(opened).toEqual([]);
  });

  it("leaves the palette while the treatment is off", () => {
    const { plugin, opened, run } = setup(false);
    const editor = editorAt("See @doe2024 here.", 8);
    for (const id of plugin.commands.keys()) {
      expect(run(id, editor, true)).toBe(false);
    }
    expect(opened).toEqual([]);
  });
});
