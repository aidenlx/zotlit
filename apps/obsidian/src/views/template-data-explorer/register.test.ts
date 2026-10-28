import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import type { App, WorkspaceLeaf } from "obsidian";
import { describe, expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { Workspace } from "@/lib/obsidian-workspace";
import { openProfileExplorer } from "@/views/note-preview/layout";
import { activeTemplateWorkbench } from "@/views/note-preview/register";
import type { TemplateWorkbenchView } from "@/views/template-workbench/view";

import { openTemplateDataExplorer } from "./register";

vi.mock("@/views/note-preview/register", () => ({
  activeTemplateWorkbench: vi.fn(),
}));
vi.mock("@/views/note-preview/layout", async (original) => ({
  ...(await original<typeof import("@/views/note-preview/layout")>()),
  openProfileExplorer: vi.fn(() => Effect.void),
}));
vi.mock("@/views/template-workbench/view", () => ({
  TEMPLATE_WORKBENCH_VIEW_TYPE: "zotlit-template-workbench",
  TemplateWorkbenchView: class {},
}));
vi.mock("@/views/note-preview/view", () => ({
  NOTE_PREVIEW_VIEW_TYPE: "zotlit-note-preview",
  NotePreviewView: class {},
}));
vi.mock("./view", () => ({
  EXPLORER_VIEW_TYPE: "zotlit-template-data-explorer",
  TemplateDataExplorerView: class {},
}));

const app = stubService<App>("App", {});

/** The Workspace tag over `members`, each one a plain Obsidian call. */
function workspace(members: {
  leaves?: () => WorkspaceLeaf[];
  getLeaf?: (pane: unknown) => WorkspaceLeaf;
  getRightLeaf?: (split: boolean) => WorkspaceLeaf | null;
  revealLeaf?: (leaf: WorkspaceLeaf) => void;
}) {
  return Effect.provideService(
    Workspace,
    stubService<Workspace["Service"]>("Workspace", {
      leavesOfType: () => Effect.sync(() => members.leaves?.() ?? []),
      ...(members.getLeaf && {
        getLeaf: (pane) => Effect.sync(() => members.getLeaf!(pane)),
      }),
      ...(members.getRightLeaf && {
        getRightLeaf: (split) =>
          Effect.sync(() => members.getRightLeaf!(split)),
      }),
      ...(members.revealLeaf && {
        revealLeaf: (leaf) => Effect.sync(() => members.revealLeaf!(leaf)),
      }),
    }),
  );
}

describe("Explorer entry point", () => {
  it.effect(
    "reopens fields beside the active workbench editor instead of selecting another window",
    () =>
      Effect.gen(function* () {
        const editor = {
          leaf: { group: "native-group" },
        } as TemplateWorkbenchView;
        vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
        const leaves = vi.fn(() => []);
        const getRightLeaf = vi.fn(() => null);
        yield* openTemplateDataExplorer(app).pipe(
          workspace({ leaves, getRightLeaf }),
        );
        expect(openProfileExplorer).toHaveBeenCalledWith(editor);
        expect(leaves).not.toHaveBeenCalled();
        expect(getRightLeaf).not.toHaveBeenCalled();
      }),
  );
});

it.effect(
  "opens an explicit Item in an unlinked unpinned Explorer and preserves other groups",
  () =>
    Effect.gen(function* () {
      const editor = {} as TemplateWorkbenchView;
      vi.mocked(activeTemplateWorkbench).mockReturnValue(editor);
      const grouped = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: "other-workbench",
        pinned: false,
        setViewState: vi.fn(),
      });
      const pinned = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: null,
        pinned: true,
        setViewState: vi.fn(),
      });
      const standalone = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: null,
        pinned: false,
        setViewState: vi.fn(async () => {}),
      });
      const revealLeaf = vi.fn();
      const getRightLeaf = vi.fn(() => null);
      yield* openTemplateDataExplorer(app, { itemIndexedKey: "PAPER002" }).pipe(
        workspace({
          leaves: () => [grouped, pinned, standalone],
          getRightLeaf,
          revealLeaf,
        }),
      );
      expect(standalone.setViewState).toHaveBeenCalledWith({
        type: "zotlit-template-data-explorer",
        active: true,
        state: { itemIndexedKey: "PAPER002", zotlitLaunch: true },
      });
      expect(grouped.setViewState).not.toHaveBeenCalled();
      expect(pinned.setViewState).not.toHaveBeenCalled();
      expect(getRightLeaf).not.toHaveBeenCalled();
      expect(revealLeaf).toHaveBeenCalledWith(standalone);
    }),
);

it.effect(
  "creates an explicit Explorer instead of replacing a pinned or grouped pane",
  () =>
    Effect.gen(function* () {
      vi.mocked(activeTemplateWorkbench).mockReturnValue(null);
      const existing = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: "saved-group",
        pinned: true,
        setViewState: vi.fn(),
      });
      const created = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        setViewState: vi.fn(async () => {}),
      });
      const getRightLeaf = vi.fn(() => created);
      yield* openTemplateDataExplorer(app, { itemIndexedKey: "PAPER002" }).pipe(
        workspace({
          leaves: () => [existing],
          getRightLeaf,
          revealLeaf: vi.fn(),
        }),
      );
      expect(getRightLeaf).toHaveBeenCalledWith(true);
      expect(existing.setViewState).not.toHaveBeenCalled();
      expect(created.setViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          state: { itemIndexedKey: "PAPER002", zotlitLaunch: true },
        }),
      );
    }),
);

it.effect("opens one Explorer when two opens run at once", () =>
  Effect.gen(function* () {
    vi.mocked(activeTemplateWorkbench).mockReturnValue(null);
    const leaves: WorkspaceLeaf[] = [];
    // The new pane takes its view only once Obsidian has loaded it.
    const loaded = Promise.withResolvers<void>();
    const getRightLeaf = vi.fn(() => {
      const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: null,
        pinned: false,
        setViewState: vi.fn(async () => {
          await loaded.promise;
          leaves.push(leaf);
        }),
      });
      return leaf;
    });
    const opens = yield* Effect.forkChild(
      Effect.all(
        [openTemplateDataExplorer(app), openTemplateDataExplorer(app)],
        { concurrency: "unbounded" },
      ).pipe(
        workspace({ leaves: () => leaves, getRightLeaf, revealLeaf: vi.fn() }),
      ),
    );
    yield* Effect.promise(() =>
      vi.waitFor(() => expect(getRightLeaf).toHaveBeenCalled()),
    );
    loaded.resolve();
    yield* Fiber.join(opens);
    expect(getRightLeaf).toHaveBeenCalledOnce();
    expect(leaves).toHaveLength(1);
  }),
);

it.effect.each(["tab"] as const)(
  "puts the Explorer in a new %s the link names, leaving the sidebar one alone",
  (paneType) =>
    Effect.gen(function* () {
      vi.mocked(activeTemplateWorkbench).mockReturnValue(null);
      const sidebar = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: null,
        pinned: false,
        setViewState: vi.fn(),
      });
      const created = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        setViewState: vi.fn(async () => {}),
      });
      const getLeaf = vi.fn(() => created);
      const getRightLeaf = vi.fn(() => null);
      const revealLeaf = vi.fn();
      yield* openTemplateDataExplorer(
        app,
        { itemIndexedKey: "PAPER002" },
        { paneType },
      ).pipe(
        workspace({
          leaves: () => [sidebar],
          getLeaf,
          getRightLeaf,
          revealLeaf,
        }),
      );
      expect(getLeaf).toHaveBeenCalledExactlyOnceWith(paneType);
      expect(getRightLeaf).not.toHaveBeenCalled();
      expect(sidebar.setViewState).not.toHaveBeenCalled();
      expect(created.setViewState).toHaveBeenCalledWith({
        type: "zotlit-template-data-explorer",
        active: true,
        state: { itemIndexedKey: "PAPER002", zotlitLaunch: true },
      });
      expect(revealLeaf).toHaveBeenCalledWith(created);
    }),
);
