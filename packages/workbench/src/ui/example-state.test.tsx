import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useRenderState, useWorkbenchController } from "./editor";
import { NameFolderPane } from "./name-folder";
import { PropertiesPane } from "./properties-tab";
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { SAMPLE_ITEMS } from "#/render/index";

afterEach(cleanup);

function Configuration({
  onChooseItem,
  onRetry,
  selected = null,
}: {
  onChooseItem?: () => void;
  onRetry?: () => void;
  selected?: number | null;
}) {
  const controller = useWorkbenchController();
  const { result } = useRenderState();
  return (
    <>
      <NameFolderPane
        controller={controller}
        manifest={controller.document!.manifest}
        filename={result?.filename ?? null}
        onChooseItem={onChooseItem}
        onRetry={onRetry}
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
    mounted.store.getState().setItem({ id: "1:ABCDEFGH", title: "A paper" }),
  );
  expect(screen.getAllByText(m.workbench_loading_item())).toHaveLength(2);
  act(() => mounted.scheduler.fail({ code: "render-error" }));
  expect(screen.getAllByText(m.workbench_example_failed())).toHaveLength(2);
});

it("marks the previous example stale after the source changes", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  render(mounted.ui);
  act(() => {
    mounted.scheduler.setInput({ snapshot: SAMPLE_ITEMS[0]! });
    mounted.scheduler.run();
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({ filename: "Research.md" }),
  );
  act(() => {
    mounted.controller.setManifestKey("filename", "Updated");
  });
  expect(mounted.scheduler.getState()).toMatchObject({
    stale: true,
    busy: false,
  });
  expect(screen.queryByText(m.workbench_loading_item())).toBeNull();
  expect(screen.getAllByText(m.workbench_example_awaiting_run())).toHaveLength(
    2,
  );
});

it("keeps Name and Properties examples when only Annotation fails", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  render(mounted.ui);
  act(() => {
    mounted.scheduler.setInput({ snapshot: SAMPLE_ITEMS[0]! });
    mounted.scheduler.run();
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "Research.md",
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
  expect(screen.getByText("Research.md")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "title Published research" }),
  ).toBeTruthy();
  expect(screen.queryByText(m.workbench_example_failed())).toBeNull();
});

it("marks a held live result as stale while rendering cannot run", async () => {
  using mounted = mount(<Configuration />, {
    state: { item: { id: "1:ABCDEFGH", title: "A paper" } },
  });
  render(mounted.ui);
  act(() => {
    mounted.scheduler.setInput({ snapshot: SAMPLE_ITEMS[0]! });
    mounted.scheduler.run();
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({ filename: "Research.md" }),
  );
  act(() => {
    mounted.scheduler.setInput({ snapshot: SAMPLE_ITEMS[0]!, hold: true });
    mounted.scheduler.run();
  });
  expect(mounted.scheduler.getState()).toMatchObject({
    stale: true,
    busy: false,
  });
  expect(mounted.host.renders).toHaveLength(1);
  expect(screen.queryByText(m.workbench_loading_item())).toBeNull();
  expect(screen.getAllByText(m.workbench_example_awaiting_run())).toHaveLength(
    2,
  );
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
    mounted.store
      .getState()
      .setItem({ id: "selected", title: "Selected item title" }),
  );
  expect(
    screen.getAllByRole("button", { name: m.workbench_choose_preview_item() }),
  ).toHaveLength(2);
  expect(screen.queryByText("Selected item title")).toBeNull();
  act(() => mounted.scheduler.fail({ code: "render-error" }));
  for (const button of screen.getAllByRole("button", {
    name: m.workbench_example_retry(),
  }))
    fireEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(2);
  act(() => {
    mounted.scheduler.setInput({ snapshot: SAMPLE_ITEMS[0]! });
    mounted.scheduler.run();
  });
  expect(
    screen.queryByRole("button", { name: m.workbench_example_retry() }),
  ).toBeNull();
  await act(async () =>
    mounted.host.renders[0]!.answer({ filename: "Recovered.md" }),
  );
  expect(screen.getByText("Recovered.md")).toBeTruthy();
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
    mounted.scheduler.setInput({ snapshot: SAMPLE_ITEMS[0]! });
    mounted.scheduler.run();
  });
  await act(async () =>
    mounted.host.renders[0]!.answer({
      filename: "First.md",
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
  expect(screen.getByText("First.md")).toBeTruthy();
  expect(screen.getByText("First item value")).toBeTruthy();
  act(() =>
    mounted.store.getState().setItem({ id: "second", title: "Second item" }),
  );
  expect(screen.queryByText("First.md")).toBeNull();
  expect(screen.queryByText("First item value")).toBeNull();
  expect(screen.getAllByText(m.workbench_loading_item())).toHaveLength(2);
  act(() => {
    mounted.scheduler.setInput({ snapshot: SAMPLE_ITEMS[1]! });
    mounted.scheduler.run();
  });
  await act(async () =>
    mounted.host.renders[1]!.answer({
      filename: "Second.md",
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
  expect(screen.getByText("Second.md")).toBeTruthy();
  expect(screen.getByText("Second item value")).toBeTruthy();
});
