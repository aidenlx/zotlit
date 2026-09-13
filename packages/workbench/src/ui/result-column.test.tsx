import type { RenderDiagnostic, TemplateRenderResult } from "#/render/result";
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

const result: TemplateRenderResult = {
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
    onShowProblem: vi.fn<(diagnostic: RenderDiagnostic | null) => void>(),
    ...overrides,
  };
  const mounted = mount(<ResultColumn {...props} />);
  mounted.host.markdown = ({
    markdown,
    surface,
    properties,
    showMarkdown,
    marks,
  }) => (
    <div
      data-testid="markdown"
      data-source={showMarkdown}
      data-surface={surface}
      data-marks={JSON.stringify(marks)}
    >
      {markdown}
      <PropertyList properties={properties} />
    </div>
  );
  render(mounted.ui);
  return Object.assign(mounted, { props });
}

it.each(["note", "annotation"] as const)(
  "identifies the %s surface when note and Annotation text match",
  (mode) => {
    const identical = {
      ...result,
      creationBody: "Shared text",
      annotation: "Shared text",
    };
    using _mounted = column({
      mode,
      result: identical,
      annotationResult: identical,
    });
    expect(screen.getByTestId("markdown").getAttribute("data-surface")).toBe(
      mode,
    );
  },
);

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
    "Created notetagsreadingscience",
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

it("names the failure and leads to its explanation", () => {
  using mounted = column({
    result: {
      ...result,
      diagnostics: [
        { code: "property-error", position: 2, message: "Invalid property" },
      ],
    },
  });
  const { props } = mounted;
  expect(screen.getByRole("status").textContent).toContain(
    m.workbench_preview_problem(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problem_show() }),
  );
  expect(props.onShowProblem).toHaveBeenCalledWith({
    code: "property-error",
    position: 2,
    message: "Invalid property",
  });
});

it("retains the note when a Property evaluation fails", () => {
  const propertyFailure: TemplateRenderResult = {
    ...result,
    creationBody: "Incomplete note",
    fold: [],
    frontmatterBlock: null,
    diagnostics: [
      {
        code: "property-error",
        part: "properties",
        position: 1,
        message: "Invalid property",
      },
    ],
  };
  using mounted = column({ result: propertyFailure, retained: result });
  const status = screen.getByRole("status");
  expect(status.textContent).toContain(m.workbench_preview_retained());
  expect(screen.getByTestId("markdown").textContent).toBe(
    "Created notetagsreadingscience",
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problem_show() }),
  );
  expect(mounted.props.onShowProblem).toHaveBeenCalledWith(
    propertyFailure.diagnostics[0],
  );
});

it("tells a failed render from a template that produced nothing", () => {
  using _failed = column({
    result: {
      ...result,
      creationBody: null,
      diagnostics: [{ code: "render-error", message: "Unclosed tag" }],
    },
  });
  expect(screen.queryByTestId("markdown")).toBeNull();
  expect(screen.queryByText("Papers/Reading.md")).toBeNull();
  // A failure the engine named nothing about reads as a plain sentence; its
  // own words are the editor's evidence, not the preview's notice.
  expect(screen.getByRole("status").textContent).toContain(
    m.workbench_diagnostic_render_error(),
  );
  expect(screen.getByRole("status").textContent).not.toContain("Unclosed tag");
});

it("reads a template that produced an empty note as a result", () => {
  using _empty = column({ result: { ...result, creationBody: "" } });
  expect(screen.getByTestId("markdown")).toBeDefined();
  expect(screen.queryByRole("status")).toBeNull();
});

const broken: TemplateRenderResult = {
  ...result,
  filename: null,
  creationBody: null,
  managedRegion: null,
  annotation: null,
  diagnostics: [{ code: "render-error", message: "Unclosed tag" }],
};

it("reads a failure against the last successful preview", () => {
  using _kept = column({ result: broken, retained: result });
  expect(screen.getByRole("status").textContent).toContain(
    m.workbench_preview_retained(),
  );
  // The working output stands beside the failure for the repair to be read
  // against; the note name belongs to the attempt that produced it.
  expect(screen.getByTestId("markdown").textContent).toBe(
    "Created notetagsreadingscience",
  );
  expect(screen.queryByText("Papers/Reading.md")).toBeNull();
});

it("names no preview when nothing successful stands for this selection", () => {
  using _none = column({ result: broken });
  expect(screen.getByRole("status").textContent).toContain(
    m.workbench_preview_unavailable(),
  );
  expect(screen.queryByTestId("markdown")).toBeNull();
});

it("shows the note that worked while the annotation beside it renders", () => {
  // One attempt, two surfaces: the note failed and the annotation did not, so
  // each reader reads the newest output their own surface has.
  const half: TemplateRenderResult = {
    ...broken,
    annotation: "One highlight",
  };
  using _note = column({ result: half, retained: result, mode: "note" });
  expect(screen.getByRole("status").textContent).toContain(
    m.workbench_preview_retained(),
  );
  expect(screen.getByTestId("markdown").textContent).toBe(
    "Created notetagsreadingscience",
  );
  cleanup();

  using _annotation = column({
    result: half,
    annotationResult: half,
    retained: result,
    mode: "annotation",
  });
  expect(screen.queryByText(m.workbench_preview_retained())).toBeNull();
  expect(screen.getByTestId("markdown").textContent).toBe("One highlight");
});

it("keeps Annotation output successful beside a failed Note Property", () => {
  const propertyFailure: TemplateRenderResult = {
    ...result,
    creationBody: "Incomplete note",
    diagnostics: [
      {
        code: "property-error",
        part: "properties",
        position: 1,
        message: "Invalid property",
      },
    ],
  };
  using _mounted = column({
    result: propertyFailure,
    annotationResult: propertyFailure,
    retained: result,
    mode: "annotation",
  });
  expect(screen.queryByText(m.workbench_preview_retained())).toBeNull();
  expect(screen.getByTestId("markdown").textContent).toBe("One highlight");
});

it("keeps the hold notice its own sentence while the last result stands", () => {
  using _mounted = column({ stale: true, staleReason: "hold" });
  expect(screen.getByRole("status").textContent).toBe(
    m.workbench_preview_stale(),
  );
  expect(screen.queryByText(m.workbench_preview_retained())).toBeNull();
});

it("reads a document the parser refuses as a failure, not as a wait", () => {
  using mounted = column({
    stale: true,
    staleReason: "invalid",
    retained: result,
  });
  expect(screen.getByRole("status").textContent).toContain(
    m.workbench_preview_retained(),
  );
  expect(screen.queryByText(m.workbench_preview_stale())).toBeNull();
  expect(screen.getByTestId("markdown").textContent).toBe(
    "Created notetagsreadingscience",
  );
  // A document that never parsed reached no render and names no diagnostic,
  // so Show problem leads to whatever the editor's own checks found.
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_problem_show() }),
  );
  expect(mounted.props.onShowProblem).toHaveBeenCalledWith(null);
});

it("names no preview for a refused document with nothing kept", () => {
  // Nothing successful stands for this selection, so the preview says so even
  // before any attempt has run.
  using _none = column({ result: null, stale: true, staleReason: "invalid" });
  expect(screen.getByRole("status").textContent).toContain(
    m.workbench_preview_unavailable(),
  );
  expect(screen.queryByTestId("markdown")).toBeNull();
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
    />,
  );
  render(mounted.ui);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.getByText("Papers/Reading.md")).toBeDefined();
});
