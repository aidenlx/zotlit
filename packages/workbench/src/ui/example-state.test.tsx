import type { RenderDiagnostic } from "#/render/index";
import { useAtomValue } from "@effect/atom-react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useWorkbenchController, useWorkbenchModel } from "./editor";
import { chooseItem, setPreview } from "./model";
import { NameFolderPane } from "./name-folder";
import { PropertiesPane } from "./properties-tab";
import {
  mount,
  pressRun,
  renderWithMessages as render,
  reportFailure,
  schedulerState,
  setItemData,
} from "./test-host";
import { m } from "./test-messages";

import { SAMPLE_ITEMS } from "#/render/index";

afterEach(cleanup);

function Configuration({
  onChooseItem,
  onRetry,
  onShowProblem,
  selected = null,
}: {
  onChooseItem?: () => void;
  onRetry?: () => void;
  onShowProblem?: (id: string) => void;
  selected?: number | null;
}) {
  const controller = useWorkbenchController();
  const { result } = useAtomValue(useWorkbenchModel().scheduler.state);
  return (
    <>
      <NameFolderPane
        controller={controller}
        manifest={controller.document!.manifest}
        filename={result?.filename ?? null}
        notePath={result?.notePath ?? null}
        onChooseItem={onChooseItem}
        onRetry={onRetry}
        onShowProblem={onShowProblem}
      />
      <PropertiesPane
        controller={controller}
        entries={controller.managedEntries!}
        properties={result?.properties ?? []}
        fold={result?.fold ?? []}
        diagnostics={[]}
        selected={selected}
        onSelect={() => {}}
        onChooseItem={onChooseItem}
        onRetry={onRetry}
      />
    </>
  );
}

it("shows configuration before an Item is selected and distinguishes pending and failed examples", () => {
  using mounted = mount(<Configuration />);
  render(mounted.ui);
  expect(screen.getByText(m.workbench_name_choose_item())).toBeTruthy();
  expect(screen.getByText(m.workbench_properties_choose_item())).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: m.workbench_name_filename_label() })
      .textContent,
  ).not.toBe("");
  const titleRow = screen.getByRole("button", { name: "title zt.title" });
  expect(within(titleRow).getByText("zt.title")).toBeTruthy();
  act(() =>
    mounted.registry.update(
      mounted.model.view,
      chooseItem({ id: "1:ABCDEFGH", title: "A paper" }),
    ),
  );
  expect(screen.getAllByText(m.workbench_loading_item())).toHaveLength(2);
  act(() => reportFailure(mounted, { code: "render-error" }));
  expect(screen.getAllByText(m.workbench_example_failed())).toHaveLength(2);
});

it("keeps Name and Properties examples when only Annotation fails", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  render(mounted.ui);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "Research",
      notePath: "Research",
      properties: [
        {
          key: "title",
          position: 1,
          value: "Published research",
          missing: false,
        },
      ],
      diagnostics: [{ code: "render-error", part: "annotation" }],
    }),
  );
  expect(screen.getByText("literatures/Research.md")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "title Published research" }),
  ).toBeTruthy();
  expect(screen.queryByText(m.workbench_example_failed())).toBeNull();
});

it("says a held result is the last preview, as the Preview does, since Run cannot help", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  render(mounted.ui);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "Research",
      notePath: "Research",
    }),
  );
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]!, hold: true });
    pressRun(mounted);
  });
  expect(schedulerState(mounted)).toMatchObject({
    staleReason: "hold",
    busy: false,
  });
  expect(mounted.host.renders).toHaveLength(1);
  expect(screen.queryByText(m.workbench_loading_item())).toBeNull();
  expect(screen.getAllByText(m.workbench_preview_stale())).toHaveLength(2);
  expect(screen.queryByText(m.workbench_example_awaiting_run())).toBeNull();
});

it("keeps the last output of a draft the parser refuses, as the Preview does", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  render(mounted.ui);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "Research",
      notePath: "Research",
    }),
  );
  act(() =>
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]!, hold: "invalid" }),
  );
  expect(schedulerState(mounted).staleReason).toBe("invalid");
  expect(screen.queryByText(m.workbench_example_awaiting_run())).toBeNull();
  expect(
    screen.getAllByText(m.workbench_preview_retained()).length,
  ).toBeGreaterThan(0);
  // The last note name stands beside the notice.
  expect(screen.getAllByText(/Research/).length).toBeGreaterThan(0);
});

it("offers local item actions and shows retry only after evaluation fails", async () => {
  const choose = vi.fn<() => void>();
  const retry = vi.fn<() => void>();
  using mounted = mount(
    <Configuration onChooseItem={choose} onRetry={retry} />,
  );
  render(mounted.ui);
  for (const button of screen.getAllByRole("button", {
    name: m.workbench_choose_preview_item(),
  })) {
    expect(button.textContent).toBe(m.workbench_choose_preview_item());
    fireEvent.click(button);
  }
  expect(choose).toHaveBeenCalledTimes(2);
  expect(
    screen.queryByRole("button", { name: m.workbench_example_retry() }),
  ).toBeNull();
  act(() =>
    mounted.registry.update(
      mounted.model.view,
      chooseItem({ id: "selected", title: "Selected item title" }),
    ),
  );
  expect(
    screen.getAllByRole("button", { name: m.workbench_choose_preview_item() }),
  ).toHaveLength(2);
  expect(screen.queryByText("Selected item title")).toBeNull();
  act(() => reportFailure(mounted, { code: "render-error" }));
  for (const button of screen.getAllByRole("button", {
    name: m.workbench_example_retry(),
  }))
    fireEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(2);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  expect(
    screen.queryByRole("button", { name: m.workbench_example_retry() }),
  ).toBeNull();
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "Recovered",
      notePath: "Recovered",
    }),
  );
  expect(screen.getByText("literatures/Recovered.md")).toBeTruthy();
});

it("clears note-name and expanded spread results immediately when another item is selected", async () => {
  using mounted = mount(<Configuration selected={5} />, {
    state: { item: { id: "first", title: "First item" } },
  });
  mounted.controller.editManagedEntry({
    action: "add",
    kind: "spread",
    after: 4,
  });
  render(mounted.ui);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "First",
      notePath: "First",
      properties: [
        {
          key: "source",
          value: "First item value",
          position: 5,
          missing: false,
        },
      ],
    }),
  );
  expect(screen.getByText("literatures/First.md")).toBeTruthy();
  expect(screen.getByText("First item value")).toBeTruthy();
  act(() =>
    mounted.registry.update(
      mounted.model.view,
      chooseItem({ id: "second", title: "Second item" }),
    ),
  );
  expect(screen.queryByText("literatures/First.md")).toBeNull();
  expect(screen.queryByText("First item value")).toBeNull();
  expect(screen.getAllByText(m.workbench_loading_item())).toHaveLength(2);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[1]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[1]!.answer({
      filename: "Second",
      notePath: "Second",
      properties: [
        {
          key: "source",
          value: "Second item value",
          position: 5,
          missing: false,
        },
      ],
    }),
  );
  expect(screen.getByText("literatures/Second.md")).toBeTruthy();
  expect(screen.getByText("Second item value")).toBeTruthy();
});

/** The note name the tab shows now, whatever sentence stands beside it. */
const noteName = (container: HTMLElement) =>
  container.querySelector('[data-part="filename-output"]')?.textContent;

/** Renders the first example with a value on the first two rows. */
async function renderFirstExample(
  mounted: ReturnType<typeof mount>,
  diagnostics: readonly RenderDiagnostic[] = [],
) {
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "Research",
      notePath: "Research",
      properties: [
        { key: "title", position: 1, value: "A paper", missing: false },
        { key: "related", position: 2, value: "Linked", missing: false },
      ],
      diagnostics,
    }),
  );
}

it("keeps the previous example on screen while a live render is queued", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  const dom = render(mounted.ui);
  await renderFirstExample(mounted);
  act(() => {
    mounted.controller.setManifestKey("filename", "Updated");
  });
  expect(schedulerState(mounted)).toMatchObject({
    staleReason: "live",
    busy: false,
  });
  expect(
    screen.queryAllByText(m.workbench_example_awaiting_run()),
  ).toHaveLength(0);
  expect(screen.queryByText(m.workbench_loading_item())).toBeNull();
  expect(noteName(dom.container)).toBe("literatures/Research.md");
  expect(screen.getByRole("button", { name: "title A paper" })).toBeTruthy();
  // The render the edit queued is on its way: the example stays until it lands.
  act(() => pressRun(mounted));
  expect(screen.queryByText(m.workbench_loading_item())).toBeNull();
  expect(screen.getByRole("button", { name: "title A paper" })).toBeTruthy();
});

it("keeps each row's own value while a reordered list renders again", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  const dom = render(mounted.ui);
  await renderFirstExample(mounted);
  act(() => {
    mounted.controller.editManagedEntry({ action: "move", position: 1, by: 1 });
  });
  expect(
    screen.queryAllByText(m.workbench_example_awaiting_run()),
  ).toHaveLength(0);
  const rows = [
    ...dom.container.querySelectorAll('[data-part="row-toggle"]'),
  ].map((row) => row.textContent);
  expect(rows.slice(0, 2)).toEqual(["relatedLinked", "titleA paper"]);
});

it("names each row's problem at the row's new place until the next render lands", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  render(mounted.ui);
  await renderFirstExample(mounted, [
    { code: "property-error", position: 1, message: "The rule stopped." },
  ]);
  act(() => {
    mounted.controller.editManagedEntry({ action: "move", position: 1, by: 1 });
  });
  // Every reader of the result — rows, Problems, the entry editor — reads the
  // positions of the list on screen.
  const { result } = schedulerState(mounted);
  expect(result?.diagnostics.map(({ position }) => position)).toEqual([2]);
  expect(
    result?.properties.map(({ key, position }) => [key, position]),
  ).toEqual([
    ["title", 2],
    ["related", 1],
  ]);
  act(() => {
    mounted.controller.editManagedEntry({ action: "remove", position: 2 });
  });
  // The removed row's value leaves with it. Its problem still explains the
  // attempt, so it stays, naming no row.
  const removed = schedulerState(mounted).result;
  expect(removed?.properties).toMatchObject([{ key: "related", position: 1 }]);
  expect(removed?.diagnostics).toHaveLength(1);
  expect(removed?.diagnostics[0]).toMatchObject({ code: "property-error" });
  expect(removed?.diagnostics[0]).not.toHaveProperty("position");
});

it("asks for a run after the source changes while refresh is on demand", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  const dom = render(mounted.ui);
  await renderFirstExample(mounted);
  act(() =>
    mounted.registry.update(mounted.model.choices, setPreview({ live: false })),
  );
  act(() => {
    mounted.controller.setManifestKey("filename", "Updated");
  });
  expect(schedulerState(mounted)).toMatchObject({
    staleReason: "demand",
  });
  expect(screen.getAllByText(m.workbench_example_awaiting_run())).toHaveLength(
    2,
  );
  // The example the source left behind stands beside the notice, as the
  // result column's output does.
  expect(noteName(dom.container)).toBe("literatures/Research.md");
  expect(screen.getByRole("button", { name: "title A paper" })).toBeTruthy();
});

it("tells a broken Filename Template from an empty note name", async () => {
  const show = vi.fn<(id: string) => void>();
  using mounted = mount(<Configuration onShowProblem={show} />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  const dom = render(mounted.ui);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      creationBody: "# A paper",
      managedRegion: "Managed",
      properties: [
        { key: "title", position: 1, value: "A paper", missing: false },
      ],
      diagnostics: [{ code: "liquid-syntax-error", part: "filename" }],
    }),
  );

  expect(noteName(dom.container)).toBe(m.workbench_preview_unavailable());
  // The item is not at fault, and neither is anything the other tabs show.
  expect(screen.queryByText(m.workbench_example_failed())).toBeNull();
  expect(screen.getByRole("button", { name: "title A paper" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problem_show() }),
  );
  expect(show).toHaveBeenCalledTimes(1);
});

it("labels the retained note name and drops it with the selected item", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  const dom = render(mounted.ui);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "Working",
      notePath: "Working",
      creationBody: "# A paper",
    }),
  );
  expect(noteName(dom.container)).toBe("literatures/Working.md");

  act(() => {
    mounted.controller.setManifestKey("filename", "{% for a i b %}");
  });
  act(() => pressRun(mounted));
  await act(async () =>
    mounted.host.renders[1]!.answer({
      creationBody: "# A paper",
      diagnostics: [{ code: "liquid-syntax-error", part: "filename" }],
    }),
  );
  expect(noteName(dom.container)).toBe("literatures/Working.md");
  expect(screen.getByText(m.workbench_preview_retained())).toBeTruthy();

  act(() =>
    mounted.registry.update(
      mounted.model.view,
      chooseItem({ id: "second", title: "Second item" }),
    ),
  );
  expect(noteName(dom.container)).toBe(m.workbench_loading_item());
});

it("claims no fault in a note name that never rendered", async () => {
  const show = vi.fn<(id: string) => void>();
  using mounted = mount(<Configuration onShowProblem={show} />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  const dom = render(mounted.ui);
  act(() => {
    setItemData(mounted, { snapshot: SAMPLE_ITEMS[0]! });
    pressRun(mounted);
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      diagnostics: [{ code: "invalid-profile", part: "profile" }],
    }),
  );

  expect(noteName(dom.container)).toBe(m.workbench_preview_unavailable());
  // Nothing names the note name, so the tab offers no explanation of its own
  // and blames neither the template nor the item.
  expect(
    screen.queryByRole("button", { name: m.workbench_problem_show() }),
  ).toBeNull();
  expect(screen.queryByText(m.workbench_example_failed())).toBeNull();
});
