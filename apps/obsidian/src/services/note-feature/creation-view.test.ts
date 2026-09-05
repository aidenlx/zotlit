import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
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

it("resolves the selection from the Item and hands the picker its rule reason, problem, and previews", async () => {
  const books = "Bk3Qn7XvT2Lp" as ProfileId;
  const rule = {
    id: "book",
    scope: { mode: "all" as const },
    expression: 'itemType == "book"',
    profile: books,
  };
  const preview = {
    selector: books,
    label: "Books",
    folder: "Books",
    citationStyle: null,
    document: "books.md",
    path: "Books/Paper.md",
    create: vi.fn(async () => ({
      outcome: "created" as const,
      file: { path: "Books/Paper.md" } as TFile,
    })),
  };
  const resolveCreationProfile = vi.fn(async () => ({
    selector: books,
    source: "rule" as const,
    shouldAsk: true,
    rule,
  }));
  const deps = {
    app: {} as App,
    zoteroPref: { dataDir: null },
    noteFeature: {
      resolveCreationProfile,
      prepareCreationProfiles: vi.fn(async () => [preview]),
      createNote: vi.fn(),
    },
  } as unknown as InteractiveCreationDeps;
  const item = { indexedKey: "ABCD2345" } as Item;
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValue({
    id: books,
    label: "Books",
  });
  await expect(createNoteInteractively(deps, item)).resolves.toMatchObject({
    path: "Books/Paper.md",
  });
  expect(resolveCreationProfile).toHaveBeenCalledExactlyOnceWith({ item });
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    deps.app,
    expect.objectContaining({
      preselected: books,
      source: "rule",
      reason: m.settings_profile_rule_summary({
        conditions: m.settings_profile_rule_item_type_is({ type: "Book" }),
        libraries: m.settings_library_scope_all(),
      }),
      problem: undefined,
      previews: [preview],
    }),
  );
  expect(preview.create).toHaveBeenCalledOnce();
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();

  resolveCreationProfile.mockResolvedValueOnce({
    selector: "default",
    source: "bound",
    shouldAsk: true,
    problem: { kind: "unavailable-target", rule, selector: books },
  } as never);
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
  await expect(createNoteInteractively(deps, item)).resolves.toBeNull();
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    deps.app,
    expect.objectContaining({
      preselected: "default",
      problem: m.modal_profile_problem_unavailable_target({
        rule: m.settings_profile_rule_summary({
          conditions: m.settings_profile_rule_item_type_is({ type: "Book" }),
          libraries: m.settings_library_scope_all(),
        }),
      }),
    }),
  );
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
