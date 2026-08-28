import type { Command, Plugin, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";

import * as modal from "./modal";
import { registerQuickSwitch } from "./register";
import type { QuickSwitchDeps } from "./register";

describe("Imported Note Profile command", () => {
  it("is offered only for the active Imported Note", () => {
    const imported = { path: "Imported/Note.md" } as TFile;
    let active: TFile | null = imported;
    const commands: Command[] = [];
    const deps = {
      app: {
        workspace: { getActiveFile: () => active },
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotero-note-key": "ABCD2345" },
          }),
        },
      },
    } as unknown as QuickSwitchDeps;

    registerQuickSwitch(
      {
        addCommand: (command: Command) => {
          commands.push(command);
          return command;
        },
      } as Pick<Plugin, "addCommand">,
      deps,
    );

    const command = commands.find(
      ({ name }) => name === m.command_switch_imported_note_profile_name(),
    )!;
    expect(command.checkCallback?.(true)).toBe(true);
    active = null;
    expect(command.checkCallback?.(true)).toBe(false);
  });

  it("opens the consented switch flow from the command", () => {
    const imported = { path: "Imported/Note.md" } as TFile;
    const run = vi
      .spyOn(modal, "switchImportedNoteProfile")
      .mockResolvedValue(undefined);
    let command: Command | undefined;
    const deps = {
      app: {
        workspace: { getActiveFile: () => imported },
        metadataCache: {
          getFileCache: () => ({
            frontmatter: { "zotero-note-key": "ABCD2345" },
          }),
        },
      },
    } as unknown as QuickSwitchDeps;
    registerQuickSwitch(
      {
        addCommand: (added: Command) => {
          command = added;
          return added;
        },
      } as Pick<Plugin, "addCommand">,
      deps,
    );

    command?.checkCallback?.(false);

    expect(run).toHaveBeenCalledWith(deps, imported);
  });
});
