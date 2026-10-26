import { TFile } from "obsidian";
import type { App, Command, MetadataCache, Vault, Workspace } from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";

import { addNoteFeatureActions } from "./actions";

it("offers Profile switching only for the active Literature Note and opens its consent flow", () => {
  const file = new TFile();
  file.path = "Books/Reading.md";
  let active: TFile | null = file;
  let frontmatter: Record<string, string> = { "zotero-key": "ABCD2345" };
  const commands: Command[] = [];
  const on = vi.fn();
  const switchProfile = vi.fn(async () => {});
  type NoteDeps = Parameters<typeof addNoteFeatureActions>[1];
  const deps: NoteDeps = {
    app: stubService<App>("App", {
      workspace: stubService<Workspace>("Workspace", {
        getActiveFile: () => active,
        on,
      }),
      vault: stubService<Vault>("Vault", { getFileByPath: () => file }),
      metadataCache: stubService<MetadataCache>("MetadataCache", {
        getFileCache: () => ({ frontmatter }),
      }),
    }),
    noteFeature: stubService<NoteDeps["noteFeature"]>("NoteFeatureHandle", {
      on: () => () => {},
    }),
    noteActions: stubService<NoteDeps["noteActions"]>("NoteActions", {
      switchProfile,
    }),
    batchImport: stubService<NoteDeps["batchImport"]>("BatchImport", {}),
  };
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
  expect(switchProfile).not.toHaveBeenCalled();
  command.checkCallback?.(false);
  expect(switchProfile).toHaveBeenCalledWith(file);
  frontmatter = { "zotero-note-key": "NOTE0001" };
  expect(command.checkCallback?.(true)).toBe(false);
  frontmatter = { "zotero-note-key": "NTE23456" };
  const recover = on.mock.calls.find(
    ([event]) => event === "zotlit:switch-profile",
  )![1] as (payload: { path: string }) => void;
  recover({ path: file.path });
  expect(switchProfile).toHaveBeenNthCalledWith(2, file);
  active = null;
  expect(command.checkCallback?.(true)).toBe(false);
});
