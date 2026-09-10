import type { ProfileRenderResult } from "#/render/result";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { PreviewControls } from "./preview-controls";
import { PropertyList } from "./property-list";
import { ResultBody, ResultColumn } from "./result-column";
import type { ResultColumnProps } from "./result-column";
import type { PreviewSettings } from "./store";
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

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
    staleReason: null,
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
  return Object.assign(mounted, { props });
}

it("passes the complete note and folded properties to the host renderer", () => {
  using mounted = column({ stale: true, staleReason: "hold" });
  const { props } = mounted;
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
  using _mounted = column({ showManaged: true, showMarkdown: true });
  expect(screen.getByTestId("markdown").textContent).toBe("Updated paragraph");
  expect(screen.getByTestId("markdown").getAttribute("data-source")).toBe(
    "true",
  );
});

it("shows a pending annotation until the selected example has a result", () => {
  using _mounted = column({ mode: "annotation", annotationResult: null });
  expect(screen.getByText(m.workbench_result_pending())).toBeDefined();
  expect(screen.queryByText("Papers/Reading.md")).toBeNull();
  expect(screen.queryByTestId("markdown")).toBeNull();
});

it("shows a single annotation with no complete-note properties", () => {
  using _mounted = column({ mode: "annotation", annotationResult: result });
  expect(screen.getByTestId("markdown").textContent).toBe("One highlight");
});

it("links the first property error to its one-based entry", () => {
  using mounted = column({
    result: {
      ...result,
      diagnostics: [
        { code: "property-error", position: 2, message: "Invalid property" },
      ],
    },
  });
  const { props } = mounted;
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problems_where_entry() }),
  );
  expect(props.goToEntry).toHaveBeenCalledWith(2);
});

it("links a profile error to source", () => {
  using mounted = column({
    result: { ...result, diagnostics: [{ code: "render-error" }] },
  });
  const { props } = mounted;
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problems_where_advanced() }),
  );
  expect(props.openSource).toHaveBeenCalledOnce();
});

it("changes preview mode, runs on demand, and pauses future work", () => {
  const onRun = vi.fn<() => void>();
  function Controls() {
    const [store] = useState(() =>
      createStore<PreviewSettings>(() => ({ mode: "create", live: true })),
    );
    const preview = useStore(store);
    return (
      <PreviewControls
        preview={preview}
        onChange={store.setState}
        busy={false}
        onRun={onRun}
      />
    );
  }
  using mounted = mount(<Controls />);
  const { ui } = mounted;
  render(ui);
  fireEvent.input(screen.getByLabelText(m.workbench_preview_mode()), {
    target: { value: "update" },
  });
  expect(
    (screen.getByLabelText(m.workbench_preview_mode()) as HTMLSelectElement)
      .value,
  ).toBe("update");
  expect(
    screen.queryByRole("button", { name: m.workbench_preview_run() }),
  ).toBeNull();
  fireEvent.input(screen.getByLabelText(m.workbench_preview_refresh()), {
    target: { value: "demand" },
  });
  expect(
    (screen.getByLabelText(m.workbench_preview_refresh()) as HTMLSelectElement)
      .value,
  ).toBe("demand");
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_preview_run() }),
  );
  expect(onRun).toHaveBeenCalledOnce();
  expect(
    (screen.getByLabelText(m.workbench_preview_refresh()) as HTMLSelectElement)
      .value,
  ).toBe("demand");
  fireEvent.input(screen.getByLabelText(m.workbench_preview_refresh()), {
    target: { value: "live" },
  });
  expect(
    (screen.getByLabelText(m.workbench_preview_refresh()) as HTMLSelectElement)
      .value,
  ).toBe("live");
  fireEvent.input(screen.getByLabelText(m.workbench_preview_refresh()), {
    target: { value: "demand" },
  });
  expect(
    (screen.getByLabelText(m.workbench_preview_refresh()) as HTMLSelectElement)
      .value,
  ).toBe("demand");
});

it("shows the behind notice with a working Run button when on demand", () => {
  const onRun = vi.fn<() => void>();
  using _mounted = column({ staleReason: "demand", onRun });
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_preview_behind() + m.workbench_preview_run(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_preview_run() }),
  );
  expect(onRun).toHaveBeenCalledOnce();
});

it("shows the behind notice with no Run button when none is given", () => {
  using _mounted = column({ staleReason: "demand" });
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_preview_behind(),
  );
  expect(
    screen.queryByRole("button", { name: m.workbench_preview_run() }),
  ).toBeNull();
});

it("shows no status while a live render is on its way", () => {
  using _mounted = column({ stale: true, staleReason: "live" });
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows no status once the shown result is current", () => {
  using _mounted = column({ stale: false, staleReason: null });
  expect(screen.queryByRole("status")).toBeNull();
});

it("renders ResultBody with no heading", () => {
  using mounted = mount(
    <ResultBody
      result={result}
      mode="note"
      stale={false}
      staleReason={null}
      showMarkdown={false}
      showManaged={false}
      openAnnotation={vi.fn<() => void>()}
      goToEntry={vi.fn<(position: number) => void>()}
      openSource={vi.fn<() => void>()}
    />,
  );
  render(mounted.ui);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.getByText("Papers/Reading.md")).toBeDefined();
});
