import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import type { App, WorkspaceLeaf } from "obsidian";
import { describe, expect, vi } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { Workspace } from "@/lib/obsidian-workspace";

import { openTemplateDataExplorer } from "./register";

vi.mock("@/views/template-workbench/view", () => ({
  TEMPLATE_WORKBENCH_VIEW_TYPE: "zotlit-template-workbench",
  TemplateWorkbenchView: class {},
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
    "opens the standalone Explorer in the sidebar, never an editor's panel",
    () =>
      Effect.gen(function* () {
        const setViewState = vi.fn(async () => {});
        const created = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
          setViewState,
        });
        const getRightLeaf = vi.fn(() => created);
        const revealLeaf = vi.fn();
        yield* openTemplateDataExplorer(app).pipe(
          workspace({ leaves: () => [], getRightLeaf, revealLeaf }),
        );
        expect(getRightLeaf).toHaveBeenCalledWith(true);
        expect(setViewState).toHaveBeenCalledWith({
          type: "zotlit-template-data-explorer",
          active: true,
          state: undefined,
        });
        expect(revealLeaf).toHaveBeenCalledWith(created);
      }),
  );
});

it.effect(
  "opens an explicit Item in an unlinked unpinned Explorer and preserves other groups",
  () =>
    Effect.gen(function* () {
      const groupedSetViewState = vi.fn();
      const pinnedSetViewState = vi.fn();
      const standaloneSetViewState = vi.fn(async () => {});
      const grouped = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: "other-workbench",
        pinned: false,
        setViewState: groupedSetViewState,
      });
      const pinned = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: null,
        pinned: true,
        setViewState: pinnedSetViewState,
      });
      const standalone = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: null,
        pinned: false,
        setViewState: standaloneSetViewState,
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
      expect(standaloneSetViewState).toHaveBeenCalledWith({
        type: "zotlit-template-data-explorer",
        active: true,
        state: { itemIndexedKey: "PAPER002" },
      });
      expect(groupedSetViewState).not.toHaveBeenCalled();
      expect(pinnedSetViewState).not.toHaveBeenCalled();
      expect(getRightLeaf).not.toHaveBeenCalled();
      expect(revealLeaf).toHaveBeenCalledWith(standalone);
    }),
);

it.effect(
  "creates an explicit Explorer instead of replacing a pinned or grouped pane",
  () =>
    Effect.gen(function* () {
      const existingSetViewState = vi.fn();
      const createdSetViewState = vi.fn(async () => {});
      const existing = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: "saved-group",
        pinned: true,
        setViewState: existingSetViewState,
      });
      const created = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        setViewState: createdSetViewState,
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
      expect(existingSetViewState).not.toHaveBeenCalled();
      expect(createdSetViewState).toHaveBeenCalledWith(
        expect.objectContaining({
          state: { itemIndexedKey: "PAPER002" },
        }),
      );
    }),
);

it.effect("opens one Explorer when two opens run at once", () =>
  Effect.gen(function* () {
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
      const sidebarSetViewState = vi.fn();
      const createdSetViewState = vi.fn(async () => {});
      const sidebar = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        group: null,
        pinned: false,
        setViewState: sidebarSetViewState,
      });
      const created = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        setViewState: createdSetViewState,
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
      expect(sidebarSetViewState).not.toHaveBeenCalled();
      expect(createdSetViewState).toHaveBeenCalledWith({
        type: "zotlit-template-data-explorer",
        active: true,
        state: { itemIndexedKey: "PAPER002" },
      });
      expect(revealLeaf).toHaveBeenCalledWith(created);
    }),
);
