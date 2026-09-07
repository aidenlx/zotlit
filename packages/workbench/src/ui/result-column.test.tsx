import type { ProfileRenderResult } from "#/render/result";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { m } from "./paraglide/messages.js";
import { PreviewControls } from "./preview-controls";
import { PropertyList } from "./property-list";
import { ResultColumn } from "./result-column";
import type { ResultColumnProps } from "./result-column";
import { mount } from "./test-host";

import { failedRender } from "#/render/result";

const result: ProfileRenderResult = {
  ...failedRender(
    { sourceRevision: "1", snapshotRevision: "2" },
    { code: "render-error" },
  ),
  filename: "Papers/Reading.md",
  creationBody: "Created note",
  managedRegion: "Updated paragraph",
  annotation: "One highlight",
  diagnostics: [],
  fold: [
    { key: "tags", value: ["reading", "science"], missing: false, position: 1 },
  ],
};

afterEach(cleanup);

function column(overrides: Partial<ResultColumnProps> = {}) {
  const props: ResultColumnProps = {
    result,
    mode: "note",
    stale: false,
    showMarkdown: false,
    onShowMarkdown: vi.fn<(show: boolean) => void>(),
    showManaged: false,
    onShowManaged: vi.fn<(show: boolean) => void>(),
    openAnnotation: vi.fn<() => void>(),
    goToEntry: vi.fn<(position: number) => void>(),
    openSource: vi.fn<() => void>(),
    ...overrides,
  };
  const mounted = mount(<ResultColumn {...props} />);
  mounted.host.markdown = ({ markdown, properties, showMarkdown, marks }) => (
    <div
      data-testid="markdown"
      data-source={showMarkdown}
      data-marks={JSON.stringify(marks)}
    >
      {markdown}
      <PropertyList properties={properties} />
    </div>
  );
  render(mounted.ui);
  return props;
}

it("passes the complete note and folded properties to the host renderer", () => {
  const props = column({ stale: true });
  expect(
    screen
      .getByText("Papers/Reading.md")
      .closest("header")
      ?.getAttribute("aria-description"),
  ).toBe("Papers/Reading.md");
  expect(
    screen
      .getByLabelText(m.workbench_preview_show())
      .getAttribute("aria-description"),
  ).toBe(m.workbench_preview_whole());
  expect(screen.getByTestId("markdown").textContent).toBe(
    "Created notetagsreading, science",
  );
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_preview_stale(),
  );
  fireEvent.input(screen.getByLabelText(m.workbench_preview_format()), {
    target: { value: "markdown" },
  });
  expect(props.onShowMarkdown).toHaveBeenCalledWith(true);
  fireEvent.input(screen.getByLabelText(m.workbench_preview_show()), {
    target: { value: "managed" },
  });
  expect(props.onShowManaged).toHaveBeenCalledWith(true);
  expect(screen.getByRole("region").className).toBe("");
});

it("renders the managed region without folding properties into it", () => {
  column({ showManaged: true, showMarkdown: true });
  expect(screen.getByTestId("markdown").textContent).toBe("Updated paragraph");
  expect(screen.getByTestId("markdown").getAttribute("data-source")).toBe(
    "true",
  );
});

it("shows a pending annotation until the selected example has a result", () => {
  column({ mode: "annotation", annotationResult: null });
  expect(screen.getByText(m.workbench_result_pending())).toBeDefined();
  expect(screen.queryByText("Papers/Reading.md")).toBeNull();
  expect(screen.queryByTestId("markdown")).toBeNull();
});

it("shows a single annotation with no complete-note properties", () => {
  column({ mode: "annotation", annotationResult: result });
  expect(screen.getByTestId("markdown").textContent).toBe("One highlight");
});

it("links the first property error to its one-based entry", () => {
  const props = column({
    result: {
      ...result,
      diagnostics: [
        { code: "property-error", position: 2, message: "Invalid property" },
      ],
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problems_where_entry() }),
  );
  expect(props.goToEntry).toHaveBeenCalledWith(2);
});

it("links a profile error to source", () => {
  const props = column({
    result: { ...result, diagnostics: [{ code: "render-error" }] },
  });
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problems_where_advanced() }),
  );
  expect(props.openSource).toHaveBeenCalledOnce();
});

it("changes preview mode, runs on demand, and pauses future work", () => {
  const onRun = vi.fn<() => void>();
  const onStop = vi.fn<() => void>();
  const { store, ui } = mount(
    <PreviewControls busy={false} onRun={onRun} onStop={onStop} />,
  );
  render(ui);
  fireEvent.input(screen.getByLabelText(m.workbench_preview_mode()), {
    target: { value: "update" },
  });
  expect(store.getState().preview.mode).toBe("update");
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_preview_stop() }),
  );
  expect(store.getState().preview.live).toBe(false);
  expect(onStop).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_preview_run() }),
  );
  expect(onRun).toHaveBeenCalledOnce();
  expect(store.getState().preview.live).toBe(false);
  fireEvent.input(screen.getByLabelText(m.workbench_preview_refresh()), {
    target: { value: "live" },
  });
  expect(store.getState().preview.live).toBe(true);
  fireEvent.input(screen.getByLabelText(m.workbench_preview_refresh()), {
    target: { value: "demand" },
  });
  expect(store.getState().preview.live).toBe(false);
  expect(onStop).toHaveBeenCalledTimes(2);
});
