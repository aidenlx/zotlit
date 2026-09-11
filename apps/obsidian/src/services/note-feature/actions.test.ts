// @vitest-environment happy-dom
import { TFile } from "obsidian";
import type { Command } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { MissingTemplateError } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";

import {
  addNoteFeatureActions,
  overwriteNoteToast,
  reimportNoteToast,
} from "./actions";
import { switchNoteProfileInteractively } from "./switch-view";

vi.mock("./switch-view", () => ({ switchNoteProfileInteractively: vi.fn() }));

// Every Literature Note write that hits a missing partial names it and offers
// the route back to the Workbench; create and single update already did.
it.each([
  ["overwrite", () => overwriteNoteToast({ app: appStub() }).error],
  [
    "reimport",
    () => reimportNoteToast({ app: appStub(), path: "Books/Reading.md" }).error,
  ],
] as const)("names the missing partial when %s fails on one", (_name, make) => {
  const notice = make()("msg", new MissingTemplateError("venue-line"));

  expect(notice).toBeInstanceOf(DocumentFragment);
  expect((notice as DocumentFragment).textContent).toContain(
    m.notice_note_missing_partial({ name: "venue-line" }),
  );
});

function appStub(): App {
  return { workspace: { trigger: vi.fn() } } as unknown as App;
}

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
