import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import * as toast from "@/lib/toast";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { createNoteInteractively } from "./index";
import type {
  CreationProfileSelection,
  InteractiveCreationDeps,
  PreparedCreationProfile,
} from "./index";

vi.mock("@/views/quick-switch/profile-picker", () => ({
  chooseLiteratureNoteProfile: vi.fn(),
}));

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const BOOK_RULE = {
  id: "book",
  scope: { mode: "all" as const },
  expression: 'itemType == "book"',
  profile: BOOKS,
};
const BOOK_RULE_SUMMARY = m.settings_profile_rule_summary({
  conditions: m.settings_profile_rule_item_type_is({ type: "Book" }),
  libraries: m.settings_library_scope_all(),
});

function booksPreview(
  overrides: Partial<PreparedCreationProfile> = {},
): PreparedCreationProfile {
  return {
    selector: BOOKS,
    label: "Books",
    folder: "Books",
    citationStyle: null,
    document: "books.md",
    path: "Books/Paper.md",
    create: vi.fn(async () => ({
      outcome: "created" as const,
      file: { path: "Books/Paper.md" } as TFile,
    })),
    ...overrides,
  };
}

/** Deps whose selection and previews are fixed; the picker stays mocked. */
function directDeps(
  selection: CreationProfileSelection,
  previews: PreparedCreationProfile[],
) {
  return {
    app: {} as App,
    zoteroPref: { dataDir: null },
    noteFeature: {
      resolveCreationProfile: vi.fn(async () => selection),
      prepareCreationProfiles: vi.fn(async () => previews),
      createNote: vi.fn(),
    },
  } as unknown as InteractiveCreationDeps;
}

/** The success notice the create toast shows, captured by spying on it. */
function successNotice() {
  const notices: unknown[] = [];
  const spy = vi.spyOn(toast, "promise").mockImplementation((async (
    promise,
    options,
  ) => {
    const result = await promise;
    if (typeof options.success === "function")
      notices.push(options.success(result));
    return result;
  }) as typeof toast.promise);
  return { notices, [Symbol.dispose]: () => spy.mockRestore() };
}

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

it("creates directly under a rule-selected Profile and reports the Profile and path", async () => {
  using shown = successNotice();
  vi.mocked(chooseLiteratureNoteProfile).mockClear();
  const preview = booksPreview();
  const deps = directDeps(
    { selector: BOOKS, source: "rule", shouldAsk: true, rule: BOOK_RULE },
    [booksPreview({ selector: "default", label: undefined }), preview],
  );
  const item = { indexedKey: "ABCD2345" } as Item;
  await expect(
    createNoteInteractively(deps, item, { direct: true }),
  ).resolves.toMatchObject({ path: "Books/Paper.md" });
  expect(
    deps.noteFeature.resolveCreationProfile,
  ).toHaveBeenCalledExactlyOnceWith({ item });
  expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
  expect(preview.create).toHaveBeenCalledOnce();
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
  expect(shown.notices).toEqual([
    m.notice_created_note_under_profile({
      profile: "Books",
      path: "Books/Paper.md",
    }),
  ]);
});

it("creates directly under an explicit Profile, naming Default when it is the one chosen", async () => {
  using shown = successNotice();
  vi.mocked(chooseLiteratureNoteProfile).mockClear();
  const preview = booksPreview({
    selector: "default",
    label: undefined,
    path: "Literature/Paper.md",
    create: vi.fn(async () => ({
      outcome: "created" as const,
      file: { path: "Literature/Paper.md" } as TFile,
    })),
  });
  const deps = directDeps(
    { selector: "default", source: "headless", shouldAsk: true },
    [preview, booksPreview()],
  );
  await expect(
    createNoteInteractively(deps, { indexedKey: "ABCD2345" } as Item, {
      headless: "default",
      direct: true,
    }),
  ).resolves.toMatchObject({ path: "Literature/Paper.md" });
  expect(deps.noteFeature.resolveCreationProfile).toHaveBeenCalledWith({
    headless: "default",
    item: { indexedKey: "ABCD2345" },
  });
  expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
  expect(preview.create).toHaveBeenCalledOnce();
  expect(shown.notices).toEqual([
    m.notice_created_note_under_profile({
      profile: m.settings_profile_default_name(),
      path: "Literature/Paper.md",
    }),
  ]);
});

it("asks with Default preselected when no source resolves, and writes nothing on cancel", async () => {
  const preview = booksPreview();
  const deps = directDeps(
    { selector: "default", source: "bound", shouldAsk: true },
    [booksPreview({ selector: "default", label: undefined }), preview],
  );
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
  await expect(
    createNoteInteractively(deps, { indexedKey: "ABCD2345" } as Item, {
      direct: true,
    }),
  ).resolves.toBeNull();
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    deps.app,
    expect.objectContaining({
      preselected: "default",
      source: "bound",
      reason: undefined,
      problem: undefined,
    }),
  );
  expect(preview.create).not.toHaveBeenCalled();
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
});

it("keeps explicit recovery on the direct path when automatic selection stopped", async () => {
  const deps = directDeps(
    {
      selector: "default",
      source: "bound",
      shouldAsk: true,
      problem: {
        kind: "broken-rule",
        rule: BOOK_RULE,
        problem: { code: "syntax", from: 0, to: 1, text: "?" },
      },
    },
    [booksPreview({ selector: "default", label: undefined }), booksPreview()],
  );
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
  await expect(
    createNoteInteractively(deps, { indexedKey: "ABCD2345" } as Item, {
      direct: true,
    }),
  ).resolves.toBeNull();
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    deps.app,
    expect.objectContaining({
      preselected: "default",
      problem: expect.stringContaining(BOOK_RULE_SUMMARY),
    }),
  );
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
});

it.each([
  {
    name: "rule",
    selection: {
      selector: BOOKS,
      source: "rule",
      shouldAsk: true,
      rule: BOOK_RULE,
    } satisfies CreationProfileSelection,
    problem: m.modal_profile_problem_unavailable_target({
      rule: BOOK_RULE_SUMMARY,
    }),
  },
  {
    name: "link",
    selection: {
      selector: BOOKS,
      source: "headless",
      shouldAsk: true,
    } satisfies CreationProfileSelection,
    problem: m.modal_profile_problem_invalid_selector({ selector: BOOKS }),
  },
])(
  "asks for another choice when the $name-selected Profile is unavailable at preparation",
  async ({ selection, problem }) => {
    const unavailable = booksPreview({
      path: undefined,
      unavailable: "Template missing",
    });
    const deps = directDeps(selection, [
      booksPreview({ selector: "default", label: undefined }),
      unavailable,
    ]);
    vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce(undefined);
    await expect(
      createNoteInteractively(deps, { indexedKey: "ABCD2345" } as Item, {
        direct: true,
      }),
    ).resolves.toBeNull();
    expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
      deps.app,
      expect.objectContaining({
        preselected: BOOKS,
        source: selection.source,
        problem,
        previews: [expect.anything(), unavailable],
      }),
    );
    expect(unavailable.create).not.toHaveBeenCalled();
    expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
  },
);

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
