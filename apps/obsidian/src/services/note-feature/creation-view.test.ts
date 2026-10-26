import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import type { Item } from "@zotlit/db";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { ProfileOperationError } from "@/services/profile/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { unimplementedProfileDialogServices } from "@/setting-tab/__fixtures__";
import { openLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";
import type { ProfilePick } from "@/views/quick-switch/profile-picker";

import type { PlannedCreationProfile } from "./creation-planning";
import { createdNoteNotice, createNoteInteractively } from "./creation-view";
import type {
  InteractiveCreationOptions,
  InteractiveCreationPorts,
} from "./creation-view";
import { NotePathUnavailable } from "./note-path";
import type { CreationProfileSelection } from "./operations";
import { NoteFeature } from "./service";

vi.mock("@/views/quick-switch/profile-picker", () => ({
  openLiteratureNoteProfile: vi.fn(),
}));

type PickerOptions = Parameters<typeof openLiteratureNoteProfile>[1];

/** The picker answers what `answer` gives for its options, as the user would. */
function pickerAnswers(
  answer: (options: PickerOptions) => Promise<ProfilePick | undefined>,
) {
  vi.mocked(openLiteratureNoteProfile).mockImplementation(
    (_app, options, resolve) => {
      void answer(options).then(resolve);
      return { close: () => {} };
    },
  );
}

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
    tree: { and: [] },
  },
} satisfies LiteratureNoteProfile;
const ITEM = { indexedKey: "ABCD2345" } as Item;

function booksPreview(
  overrides: Partial<PlannedCreationProfile> = {},
): PlannedCreationProfile {
  const file = noteAt(overrides.path ?? "Books/Paper.md");
  return {
    selector: BOOKS,
    label: "Books",
    folder: "Books",
    citationStyle: null,
    document: "books.md",
    path: "Books/Paper.md",
    create: vi.fn(() => Effect.succeed({ outcome: "created" as const, file })),
    ...overrides,
  };
}

/**
 * The interactive creation's ports and services over one fixed selection and
 * its previews, with its notices recorded.
 */
function creation(
  selection: CreationProfileSelection,
  previews: readonly PlannedCreationProfile[],
  ports: Partial<InteractiveCreationPorts> = {},
) {
  const notifier = testNotifier();
  const feature = {
    planCreations: vi.fn<NoteFeature["Service"]["planCreations"]>((keys) =>
      Effect.succeed(
        new Map(keys.map((key) => [key, { item: ITEM, selection, previews }])),
      ),
    ),
    createNote: vi.fn<NoteFeature["Service"]["createNote"]>(),
  };
  const app = stubService<App>("App", {});
  return {
    app,
    feature,
    notifier,
    ports: {
      app,
      createProfile: vi.fn(),
      importProfile: vi.fn(),
      ...ports,
    } satisfies InteractiveCreationPorts,
    layer: Layer.mergeAll(
      unimplementedProfileDialogServices,
      Layer.mock(NoteFeature, feature),
      notifier.layer,
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: "",
          }),
        ),
      }),
    ),
  };
}

/**
 * Run the creation of `item` on `harness`'s services, built on the case's
 * Scope. Its notices keep showing after it returns, as they do in the
 * plugin, until the case ends.
 */
const run = Effect.fnUntraced(function* (
  harness: ReturnType<typeof creation>,
  options?: InteractiveCreationOptions,
) {
  const context = yield* Layer.build(harness.layer);
  const file = yield* createNoteInteractively(
    harness.ports,
    ITEM,
    options,
  ).pipe(Effect.provideContext(context));
  yield* Effect.yieldNow;
  return file;
});

/** The first message of each notice. */
function texts(harness: ReturnType<typeof creation>): unknown[] {
  return harness.notifier.notices.map(({ messages: [message] }) => message);
}

it.effect(
  "creates a note from the New profile dialog's prepared callback without re-resolving its path",
  () =>
    Effect.gen(function* () {
      const file = noteAt("Reading/Paper-7cx.md");
      let writes = 0;
      const create = Effect.sync(() => {
        writes += 1;
        return { outcome: "created" as const, file };
      });
      const createProfile = vi.fn(() =>
        Effect.succeed({
          profile: { ...BOOK_PROFILE, label: "Reading" },
          preview: { path: file.path, properties: {}, body: "Body", create },
        }),
      );
      const harness = creation(
        { selector: "default", source: "bound", shouldAsk: true },
        [],
        { createProfile },
      );
      pickerAnswers(async () => ({ action: "new" }));
      expect(yield* run(harness)).toBe(file);
      expect(createProfile).toHaveBeenCalledWith({
        indexedKey: "ABCD2345",
        useForNote: true,
      });
      expect(writes).toBe(1);
      expect(harness.feature.planCreations).toHaveBeenCalledOnce();
      expect(harness.feature.createNote).not.toHaveBeenCalled();
      expect(texts(harness)).toEqual([
        m.notice_created_note_under_profile({
          profile: "Reading",
          path: file.path,
        }),
      ]);
    }),
);

it.effect(
  "stops the New profile dialog's note write when the creation is interrupted",
  () =>
    Effect.gen(function* () {
      const file = noteAt("Reading/Paper-7cx.md");
      // The write waits once it starts; an interrupt that reaches it stops it.
      const entered = yield* Deferred.make<void>();
      let stopped = false;
      const create = Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            stopped = true;
          }),
        ),
        Effect.as({ outcome: "created" as const, file }),
      );
      const createProfile = vi.fn(() =>
        Effect.succeed({
          profile: { ...BOOK_PROFILE, label: "Reading" },
          preview: { path: file.path, properties: {}, body: "Body", create },
        }),
      );
      const harness = creation(
        { selector: "default", source: "bound", shouldAsk: true },
        [],
        { createProfile },
      );
      pickerAnswers(async () => ({ action: "new" }));
      const fiber = yield* run(harness).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      expect(stopped).toBe(true);
    }),
);

it.effect(
  "opens overlap with every candidate identity, a visible reason, and frozen previews",
  () =>
    Effect.gen(function* () {
      const preview = booksPreview();
      const papers = {
        ...BOOK_PROFILE,
        id: "Rz9Wm4YfH6Kd" as ProfileId,
        label: "Papers",
      };
      const harness = creation(
        {
          selector: "default",
          source: "bound",
          shouldAsk: true,
          problem: { kind: "overlap", candidates: [BOOK_PROFILE, papers] },
        },
        [preview],
      );
      pickerAnswers(async () => ({ id: BOOKS, label: "Books" }));
      expect(yield* run(harness)).toMatchObject({ path: "Books/Paper.md" });
      expect(harness.feature.planCreations).toHaveBeenCalledExactlyOnceWith(
        [ITEM.indexedKey],
        {},
      );
      expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
        harness.app,
        expect.objectContaining({
          candidates: [BOOKS, papers.id],
          problem: m.modal_profile_problem_overlap({
            profiles: "Books, Papers",
          }),
          previews: [preview],
        }),
        expect.any(Function),
      );
      expect(preview.create).toHaveBeenCalledOnce();
      expect(harness.feature.createNote).not.toHaveBeenCalled();
    }),
);

it.effect.each([false, true])(
  "creates a unique match directly and reports its reason and path (direct=%s)",
  (direct) =>
    Effect.gen(function* () {
      vi.mocked(openLiteratureNoteProfile).mockClear();
      const preview = booksPreview();
      const harness = creation(
        {
          selector: BOOKS,
          source: "match",
          shouldAsk: false,
          reason: MATCH_REASON,
        },
        [booksPreview({ selector: "default", label: undefined }), preview],
      );
      expect(yield* run(harness, { direct })).toMatchObject({
        path: "Books/Paper.md",
      });
      expect(harness.feature.planCreations).toHaveBeenCalledExactlyOnceWith(
        [ITEM.indexedKey],
        {},
      );
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(preview.create).toHaveBeenCalledOnce();
      expect(harness.feature.createNote).not.toHaveBeenCalled();
      expect(texts(harness)).toEqual([
        m.notice_created_note_from_match({
          reason: MATCH_REASON,
          path: "Books/Paper.md",
        }),
      ]);
    }),
);

it.effect(
  "creates directly under an explicit Profile, naming Default when it is the one chosen",
  () =>
    Effect.gen(function* () {
      vi.mocked(openLiteratureNoteProfile).mockClear();
      const preview = booksPreview({
        selector: "default",
        label: undefined,
        path: "Literature/Paper.md",
      });
      const harness = creation(
        { selector: "default", source: "headless", shouldAsk: true },
        [preview, booksPreview()],
      );
      expect(
        yield* run(harness, { headless: "default", direct: true }),
      ).toMatchObject({ path: "Literature/Paper.md" });
      expect(harness.feature.planCreations).toHaveBeenCalledWith(["ABCD2345"], {
        headless: "default",
      });
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(preview.create).toHaveBeenCalledOnce();
      expect(texts(harness)).toEqual([
        m.notice_created_note_under_profile({
          profile: m.settings_profile_default_name(),
          path: "Literature/Paper.md",
        }),
      ]);
    }),
);

it.effect("creates under the bound Profile with no question", () =>
  Effect.gen(function* () {
    vi.mocked(openLiteratureNoteProfile).mockClear();
    const file = noteAt("Literature/Paper.md");
    const harness = creation(
      { selector: "default", source: "bound", shouldAsk: false },
      [booksPreview()],
    );
    harness.feature.createNote.mockReturnValue(
      Effect.succeed({ outcome: "created", file }),
    );
    expect(yield* run(harness)).toBe(file);
    expect(harness.feature.createNote).toHaveBeenCalledExactlyOnceWith(ITEM, {
      profile: "default",
    });
    expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(texts(harness)).toEqual([m.notice_created_note()]);
  }),
);

it.effect("answers null after the create notice reports a failed create", () =>
  Effect.gen(function* () {
    const harness = creation(
      { selector: "default", source: "bound", shouldAsk: false },
      [],
    );
    harness.feature.createNote.mockReturnValue(
      Effect.fail(
        new NotePathUnavailable({
          message: "The filename template rendered nothing",
          cause: new Error("The filename template rendered nothing"),
        }),
      ),
    );
    expect(yield* run(harness)).toBeNull();
    expect(texts(harness)).toEqual([m.notice_create_note_failed()]);
  }),
);

it.effect(
  "asks with Default preselected when no source resolves, and writes nothing on cancel",
  () =>
    Effect.gen(function* () {
      const preview = booksPreview();
      const harness = creation(
        { selector: "default", source: "bound", shouldAsk: true },
        [booksPreview({ selector: "default", label: undefined }), preview],
      );
      pickerAnswers(async () => undefined);
      expect(yield* run(harness, { direct: true })).toBeNull();
      expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
        harness.app,
        expect.objectContaining({
          preselected: "default",
          source: "bound",
          reason: undefined,
          problem: undefined,
        }),
        expect.any(Function),
      );
      expect(preview.create).not.toHaveBeenCalled();
      expect(harness.feature.createNote).not.toHaveBeenCalled();
    }),
);

it.effect(
  "keeps explicit recovery on the direct path when automatic selection stopped",
  () =>
    Effect.gen(function* () {
      const harness = creation(
        {
          selector: "default",
          source: "bound",
          shouldAsk: true,
          problem: { kind: "overlap", candidates: [BOOK_PROFILE] },
        },
        [
          booksPreview({ selector: "default", label: undefined }),
          booksPreview(),
        ],
      );
      pickerAnswers(async () => undefined);
      expect(yield* run(harness, { direct: true })).toBeNull();
      expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
        harness.app,
        expect.objectContaining({
          preselected: "default",
          problem: expect.stringContaining("Books"),
        }),
        expect.any(Function),
      );
      expect(harness.feature.createNote).not.toHaveBeenCalled();
    }),
);

it.effect(
  "asks for another choice when the match-selected Profile is unavailable at preparation",
  () =>
    Effect.gen(function* () {
      const unavailable = booksPreview({
        path: undefined,
        unavailable: "Template missing",
      });
      const harness = creation(
        {
          selector: BOOKS,
          source: "match",
          shouldAsk: true,
          reason: MATCH_REASON,
        },
        [booksPreview({ selector: "default", label: undefined }), unavailable],
      );
      pickerAnswers(async () => undefined);
      expect(yield* run(harness, { direct: true })).toBeNull();
      expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
        harness.app,
        expect.objectContaining({
          preselected: BOOKS,
          source: "match",
          problem: m.modal_profile_problem_unavailable_profile({
            selector: BOOKS,
          }),
          previews: [expect.anything(), unavailable],
        }),
        expect.any(Function),
      );
      expect(unavailable.create).not.toHaveBeenCalled();
      expect(harness.feature.createNote).not.toHaveBeenCalled();
    }),
);

it.effect("imports from the contextual picker without creating a note", () =>
  Effect.gen(function* () {
    const importProfile = vi.fn(() => Effect.undefined);
    const harness = creation(
      { selector: "default", source: "bound", shouldAsk: true },
      [],
      { importProfile },
    );
    pickerAnswers(async () => ({ action: "import" }));
    expect(yield* run(harness)).toBeNull();
    expect(importProfile).toHaveBeenCalledWith({ indexedKey: "ABCD2345" });
    expect(harness.feature.createNote).not.toHaveBeenCalled();
  }),
);

it.effect("closes the picker when the creation is interrupted", () =>
  Effect.gen(function* () {
    const close = vi.fn();
    vi.mocked(openLiteratureNoteProfile).mockImplementation(() => ({
      close,
    }));
    const harness = creation(
      { selector: "default", source: "bound", shouldAsk: true },
      [booksPreview()],
    );
    const fiber = yield* run(harness).pipe(
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;
    expect(openLiteratureNoteProfile).toHaveBeenCalled();
    yield* Fiber.interrupt(fiber);
    expect(close).toHaveBeenCalledOnce();
  }),
);

it.effect.each(["new", "import"] as const)(
  "closes the %s Profile dialog the picker opened when the creation is interrupted",
  (action) =>
    Effect.gen(function* () {
      const opened = yield* Deferred.make<void>();
      const close = vi.fn();
      // The dialog stays open until something closes it.
      const dialog = awaitModal<undefined>(() => {
        Deferred.doneUnsafe(opened, Effect.void);
        return { close };
      });
      const harness = creation(
        { selector: "default", source: "bound", shouldAsk: true },
        [],
        { createProfile: () => dialog, importProfile: () => dialog },
      );
      pickerAnswers(async () => ({ action }));
      const fiber = yield* run(harness).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(opened);
      yield* Fiber.interrupt(fiber);
      expect(close).toHaveBeenCalledOnce();
      expect(texts(harness)).toEqual([]);
    }),
);

it.effect(
  "tells the user when the New profile dialog fails, and creates no note",
  () =>
    Effect.gen(function* () {
      const harness = creation(
        { selector: "default", source: "bound", shouldAsk: true },
        [],
        {
          createProfile: () =>
            Effect.fail(
              new ProfileOperationError({
                message: "broken",
                cause: undefined,
              }),
            ),
        },
      );
      pickerAnswers(async () => ({ action: "new" }));
      expect(yield* run(harness)).toBeNull();
      expect(texts(harness)).toEqual([m.notice_profile_action_failed()]);
      expect(harness.feature.createNote).not.toHaveBeenCalled();
    }),
);

it.each([
  [
    "a Profile chosen or made in the picker",
    { label: "Reading" },
    "Literature note created under Reading: literatures/engelbart1962.md.",
  ],
])("names the new note created through %s", (_, created, notice) => {
  const file = noteAt("literatures/engelbart1962.md");
  expect(createdNoteNotice(file, created)).toBe(notice);
});

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}
