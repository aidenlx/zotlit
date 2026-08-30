import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";

import type { ProfileId } from "@/lib/profile-stamp";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { createNoteInteractively } from "./index";
import type { InteractiveCreationDeps } from "./index";

vi.mock("@/views/quick-switch/profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

it("creates a note from the New profile dialog's prepared callback without re-resolving its path", async () => {
  const file = { path: "Reading/Paper-7cx.md" } as TFile;
  const create = vi.fn(async () => ({ outcome: "created" as const, file }));
  const createProfile = vi.fn(async () => ({
    profile: {
      id: "Bk3Qn7XvT2Lp" as ProfileId,
      label: "Reading",
      document: "reading.md",
      path: "templates/reading.md",
      bindings: {},
    },
    preview: { path: file.path, properties: {}, body: "Body", create },
  }));
  const deps = {
    app: {} as App,
    createProfile,
    zoteroPref: { dataDir: null },
    noteFeature: {
      resolveCreationProfile: async () => ({
        selector: "default",
        source: "bound",
        shouldAsk: true,
      }),
      prepareCreationProfiles: vi.fn(async () => []),
      createNote: vi.fn(),
    },
  } as unknown as InteractiveCreationDeps;
  vi.mocked(chooseLiteratureNoteProfile).mockImplementation(
    async (_app, options) =>
      "onNew" in options ? options.onNew?.() : undefined,
  );
  const item = { indexedKey: "ABCD2345" } as Item;
  await expect(createNoteInteractively(deps, item)).resolves.toBe(file);
  expect(createProfile).toHaveBeenCalledWith({
    indexedKey: "ABCD2345",
    useForNote: true,
  });
  expect(create).toHaveBeenCalledOnce();
  expect(deps.noteFeature.prepareCreationProfiles).toHaveBeenCalledOnce();
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
});

it("imports from the contextual picker without creating a note", async () => {
  const importProfile = vi.fn(async () => undefined);
  const deps = {
    app: {} as App,
    importProfile,
    zoteroPref: { dataDir: null },
    noteFeature: {
      resolveCreationProfile: async () => ({
        selector: "default",
        source: "bound",
        shouldAsk: true,
      }),
      prepareCreationProfiles: async () => [],
      createNote: vi.fn(),
    },
  } as unknown as InteractiveCreationDeps;
  vi.mocked(chooseLiteratureNoteProfile).mockImplementation(
    async (_app, options) => {
      if ("onImport" in options) await options.onImport?.();
      return undefined;
    },
  );
  await expect(
    createNoteInteractively(deps, { indexedKey: "ABCD2345" } as Item),
  ).resolves.toBeNull();
  expect(importProfile).toHaveBeenCalledWith({ indexedKey: "ABCD2345" });
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
});
