import { TFile } from "obsidian";
import type { Command } from "obsidian";
import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import { addNoteFeatureActions } from "./actions";
import { switchNoteProfileInteractively } from "./switch-view";

vi.mock("./switch-view", () => ({ switchNoteProfileInteractively: vi.fn() }));

it("offers Profile switching only for the active Literature Note and opens its consent flow", () => {
  const file = new TFile();
  file.path = "Books/Reading.md";
  let active: TFile | null = file;
  let frontmatter: Record<string, string> = { "zotero-key": "ABCD2345" };
  const commands: Command[] = [];
  const on = vi.fn();
  const deps = {
    app: {
      workspace: { getActiveFile: () => active, on },
      vault: { getFileByPath: () => file },
      metadataCache: { getFileCache: () => ({ frontmatter }) },
    },
    noteFeature: { on: () => () => {} },
  } as unknown as Parameters<typeof addNoteFeatureActions>[1];
  addNoteFeatureActions(
    {
      app: deps.app,
      addCommand: (command) => {
        commands.push(command);
        return command;
      },
      registerEvent: () => {},
      register: () => {},
    },
    deps,
  );
  const command = commands.find(
    ({ id }) => id === "switch-literature-note-profile",
  )!;
  expect(command.name).toBe(m.command_switch_literature_note_profile_name());
  expect(command.checkCallback?.(true)).toBe(true);
  expect(switchNoteProfileInteractively).not.toHaveBeenCalled();
  command.checkCallback?.(false);
  expect(switchNoteProfileInteractively).toHaveBeenCalledWith(deps, file);
  frontmatter = { "zotero-note-key": "NOTE0001" };
  expect(command.checkCallback?.(true)).toBe(false);
  frontmatter = { "zotero-note-key": "NTE23456" };
  const recover = on.mock.calls.find(
    ([event]) => event === "zotlit:switch-profile",
  )![1] as (payload: { path: string }) => void;
  recover({ path: file.path });
  expect(switchNoteProfileInteractively).toHaveBeenNthCalledWith(2, deps, file);
  active = null;
  expect(command.checkCallback?.(true)).toBe(false);
});
