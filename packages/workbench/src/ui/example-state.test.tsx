import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { useRenderState, useWorkbenchController } from "./editor";
import { NameFolderPane } from "./name-folder";
import { PropertiesPane } from "./properties-tab";
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { SAMPLE_ITEMS } from "#/render/index";

afterEach(cleanup);

function Configuration() {
  const controller = useWorkbenchController();
  const { result } = useRenderState();
  return (
    <>
      <NameFolderPane
        controller={controller}
        manifest={controller.document!.manifest}
        filename={result?.filename ?? null}
      />
      <PropertiesPane
        controller={controller}
        entries={controller.managedEntries!}
        properties={result?.properties ?? []}
        fold={result?.fold ?? []}
        diagnostics={[]}
        selected={null}
        onSelect={() => {}}
      />
    </>
  );
}

it("shows configuration before an Item is selected and distinguishes pending and failed examples", () => {
  using mounted = mount(<Configuration />);
  render(mounted.ui);
  expect(screen.getAllByText(m.workbench_example_select_item())).toHaveLength(
    2,
  );
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
  expect(screen.getAllByText(m.workbench_preview_stale())).toHaveLength(2);
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
  expect(screen.getAllByText(m.workbench_preview_stale())).toHaveLength(2);
});
