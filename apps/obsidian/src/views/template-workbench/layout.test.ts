// The dedicated workbench window: "Open template workbench" and Customize show
// the one editor with both side panels in a window of its own (#1945).
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { WorkspaceLeaf } from "obsidian";
import { vi } from "vitest";

import type { WorkbenchPanels } from "@zotlit/workbench/ui";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { Workspace } from "@/lib/obsidian-workspace";
import { EXPLORER_VIEW_TYPE } from "@/views/template-data-explorer/view";

import { findWorkbenchLayout, openWorkbenchLayout } from "./layout";
import { TEMPLATE_WORKBENCH_VIEW_TYPE, TemplateWorkbenchView } from "./view";

type Container = ReturnType<WorkspaceLeaf["getContainer"]>;
const container = () =>
  stubService<Container>("WorkspaceContainer", { focus: vi.fn() });

/** A workspace of editors and explorers, as the Workspace tag sees it. */
function setup() {
  const rootSplit = container();
  const editors: WorkspaceLeaf[] = [];
  const explorers: WorkspaceLeaf[] = [];
  const registry = AtomRegistry.make();
  const leaf = (at: Container, view?: TemplateWorkbenchView) => {
    let held = at;
    const made: WorkspaceLeaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      group: null,
      getContainer: () => held,
      setGroupMember: vi.fn(),
      setViewState: vi.fn(async () => {}),
      ...(view ? { view } : {}),
    });
    Object.defineProperty(made, "moveTo", {
      value: (next: Container) => {
        held = next;
      },
    });
    return made;
  };
  /** An editor of `file` in `at`; the main window's split when left out. */
  const editor = (
    file: string | null,
    at: Container = rootSplit,
    defaultProfile = false,
  ) => {
    const view = Object.create(
      TemplateWorkbenchView.prototype,
    ) as TemplateWorkbenchView;
    // The Workbench model's panels, which a new editor shows neither of.
    const panels = Atom.make<WorkbenchPanels>({
      fields: { shown: false, width: 400 },
      preview: { shown: false, width: 400 },
    });
    const made = leaf(at, view);
    Object.defineProperties(view, {
      leaf: { value: made },
      file: { value: file === null ? null : { path: file } },
      isDefaultProfile: { value: defaultProfile },
      registry: { value: registry },
      workbench: { value: { panels } },
      onResize: { value: vi.fn() },
    });
    editors.push(made);
    return view;
  };
  const moveLeafToPopout = vi.fn((moved: WorkspaceLeaf) =>
    Effect.gen(function* () {
      // A move takes a turn, so a second open starts while it runs.
      yield* Effect.yieldNow;
      (moved as unknown as { moveTo(next: Container): void }).moveTo(
        container(),
      );
    }),
  );
  const createLeafBySplit = vi.fn((beside: WorkspaceLeaf) =>
    Effect.sync(() => {
      const made = leaf(beside.getContainer());
      explorers.push(made);
      return made;
    }),
  );
  const revealLeaf = vi.fn((_leaf: WorkspaceLeaf) => Effect.void);
  const setActiveLeaf = vi.fn((_leaf: WorkspaceLeaf) => Effect.void);
  const workspace = stubService<Workspace["Service"]>("Workspace", {
    rootSplit: Effect.succeed(rootSplit),
    leavesOfType: (type) =>
      Effect.sync(() =>
        type === TEMPLATE_WORKBENCH_VIEW_TYPE
          ? [...editors]
          : type === EXPLORER_VIEW_TYPE
            ? [...explorers]
            : [],
      ),
    moveLeafToPopout,
    createLeafBySplit,
    revealLeaf,
    setActiveLeaf,
  });
  const run = <A, E>(effect: Effect.Effect<A, E, Workspace>) =>
    Effect.provideService(effect, Workspace, workspace);
  const panels = (view: TemplateWorkbenchView) =>
    registry.get(view.workbench.panels);
  return {
    rootSplit,
    editor,
    run,
    panels,
    moveLeafToPopout,
    createLeafBySplit,
    revealLeaf,
    setActiveLeaf,
  };
}

describe("the dedicated workbench window", () => {
  it.effect(
    "moves an editor out of the main window once when two opens run at once, and shows both panels with no explorer beside it",
    () =>
      Effect.gen(function* () {
        const test = setup();
        const view = test.editor("templates/zotlit-profile.paper.md");
        yield* test.run(
          Effect.all([openWorkbenchLayout(view), openWorkbenchLayout(view)], {
            concurrency: "unbounded",
          }),
        );
        expect(test.moveLeafToPopout).toHaveBeenCalledOnce();
        // Fields is a panel of the editor's own leaf.
        expect(test.createLeafBySplit).not.toHaveBeenCalled();
        expect(view.leaf.getContainer()).not.toBe(test.rootSplit);
        expect(test.panels(view)).toMatchObject({
          fields: { shown: true },
          preview: { shown: true },
        });
        expect(test.setActiveLeaf).toHaveBeenLastCalledWith(view.leaf, {
          focus: true,
        });
      }),
  );

  it.effect(
    "reveals the Profile's open workbench window instead of moving a second editor",
    () =>
      Effect.gen(function* () {
        const test = setup();
        const path = "templates/zotlit-profile.paper.md";
        const opened = test.editor(path, container());
        const second = test.editor(path);
        yield* test.run(openWorkbenchLayout(second));
        expect(test.moveLeafToPopout).not.toHaveBeenCalled();
        expect(test.revealLeaf).toHaveBeenCalledWith(opened.leaf);
        expect(test.panels(opened)).toMatchObject({
          fields: { shown: true },
          preview: { shown: true },
        });
        expect(test.panels(second)).toMatchObject({
          preview: { shown: false },
        });
      }),
  );

  it.effect(
    "finds the editor of a Profile in a window of its own, not one in the main window",
    () =>
      Effect.gen(function* () {
        const test = setup();
        const path = "templates/zotlit-profile.paper.md";
        test.editor(path);
        expect(
          yield* test.run(
            findWorkbenchLayout({ file: path, defaultProfile: false }),
          ),
        ).toBeNull();
        const popout = test.editor(path, container());
        const draft = test.editor(null, container(), true);
        expect(
          yield* test.run(
            findWorkbenchLayout({ file: path, defaultProfile: false }),
          ),
        ).toBe(popout);
        expect(
          yield* test.run(
            findWorkbenchLayout({
              file: "templates/zotlit-profile.books.md",
              defaultProfile: false,
            }),
          ),
        ).toBeNull();
        expect(
          yield* test.run(
            findWorkbenchLayout({ file: null, defaultProfile: true }),
          ),
        ).toBe(draft);
      }),
  );
});
