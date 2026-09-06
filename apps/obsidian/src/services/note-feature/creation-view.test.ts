import type { App, TFile } from "obsidian";
import { expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import * as toast from "@/lib/toast";
import type { LiteratureNoteProfile } from "@/services/profile/service";
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
const MATCH_REASON = m.profile_match_selected({ profile: "Books" });
const BOOK_PROFILE = {
  id: BOOKS,
  label: "Books",
  document: "books.md",
  path: "templates/books.md",
  bindings: {},
  match: {
    state: "all",
    summary: m.profile_match_all(),
    tree: "true",
    condition: { kind: "group", match: "all", conditions: [] },
  },
} satisfies LiteratureNoteProfile;

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

it("opens overlap with every candidate identity, a visible reason, and frozen previews", async () => {
  const preview = booksPreview();
  const papers = {
    ...BOOK_PROFILE,
    id: "Rz9Wm4YfH6Kd" as ProfileId,
    label: "Papers",
  };
  const selection: CreationProfileSelection = {
    selector: "default",
    source: "bound",
    shouldAsk: true,
    problem: { kind: "overlap", candidates: [BOOK_PROFILE, papers] },
  };
  const deps = directDeps(selection, [preview]);
  const item = { indexedKey: "ABCD2345" } as Item;
  vi.mocked(chooseLiteratureNoteProfile).mockResolvedValueOnce({
    id: BOOKS,
    label: "Books",
  });
  expect(await createNoteInteractively(deps, item)).toMatchObject({
    path: "Books/Paper.md",
  });
  expect(
    deps.noteFeature.resolveCreationProfile,
  ).toHaveBeenCalledExactlyOnceWith({ item });
  expect(chooseLiteratureNoteProfile).toHaveBeenLastCalledWith(
    deps.app,
    expect.objectContaining({
      candidates: [BOOKS, papers.id],
      problem: m.modal_profile_problem_overlap({ profiles: "Books, Papers" }),
      previews: [preview],
    }),
  );
  expect(preview.create).toHaveBeenCalledOnce();
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
});

it.each([false, true])(
  "creates a unique match directly and reports its reason and path (direct=%s)",
  async (direct) => {
    using shown = successNotice();
    vi.mocked(chooseLiteratureNoteProfile).mockClear();
    const preview = booksPreview();
    const deps = directDeps(
      {
        selector: BOOKS,
        source: "match",
        shouldAsk: false,
        reason: MATCH_REASON,
      },
      [booksPreview({ selector: "default", label: undefined }), preview],
    );
    const item = { indexedKey: "ABCD2345" } as Item;
    await expect(
      createNoteInteractively(deps, item, { direct }),
    ).resolves.toMatchObject({ path: "Books/Paper.md" });
    expect(
      deps.noteFeature.resolveCreationProfile,
    ).toHaveBeenCalledExactlyOnceWith({ item });
    expect(chooseLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(preview.create).toHaveBeenCalledOnce();
    expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
    expect(shown.notices).toEqual([
      m.notice_created_note_from_match({
        reason: MATCH_REASON,
        path: "Books/Paper.md",
      }),
    ]);
  },
);

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
        kind: "overlap",
        candidates: [BOOK_PROFILE],
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
      problem: expect.stringContaining("Books"),
    }),
  );
  expect(deps.noteFeature.createNote).not.toHaveBeenCalled();
});

it.each([
  {
    name: "match",
    selection: {
      selector: BOOKS,
      source: "match",
      shouldAsk: true,
      reason: MATCH_REASON,
    } satisfies CreationProfileSelection,
    problem: m.modal_profile_problem_unavailable_profile({ selector: BOOKS }),
  },
  {
    name: "link",
    selection: {
      selector: BOOKS,
      source: "headless",
      shouldAsk: true,
    } satisfies CreationProfileSelection,
    problem: m.modal_profile_problem_unavailable_profile({ selector: BOOKS }),
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
