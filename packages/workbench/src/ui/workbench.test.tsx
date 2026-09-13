import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { AnnotationPane } from "./annotation";
import { EditToolbar } from "./edit-toolbar";
import { useWorkbenchController, useWorkbenchStore } from "./editor";
import { NotePane } from "./note-pane";
import { SliceEditor } from "./slice-editor";
import { TabBar, TabPanel } from "./tab-bar";
// The shared panes together, under a fake adapter and theme in both runtimes.
import { mount, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

afterEach(cleanup);

/** The host composes panes; the shared store keeps their tab and mode. */
function Panes() {
  const controller = useWorkbenchController();
  const advanced = useWorkbenchStore((state) => state.advanced);
  const setTab = useWorkbenchStore((state) => state.setTab);
  return (
    <>
      <EditToolbar />
      <TabBar />
      <div hidden={advanced}>
        <TabPanel tab="note" keepMounted>
          <NotePane
            controller={controller}
            preview="Selected annotation"
            formatProblem={null}
            onOpenAnnotation={() => setTab("annotation")}
          />
        </TabPanel>
        <TabPanel tab="annotation">
          <AnnotationPane controller={controller} problem={null} />
        </TabPanel>
      </div>
      {advanced && (
        <SliceEditor controller={controller} slice="advanced" label="Source" />
      )}
    </>
  );
}

function sourceView() {
  return EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Source" }),
  )!;
}

it("keeps one undo history when switching between Basic and Source", () => {
  using mounted = mount(<Panes />);
  render(mounted.ui);
  fireEvent.click(screen.getByRole("button", { name: m.workbench_advanced() }));
  const source = sourceView();
  act(() =>
    source.dispatch({
      changes: {
        from: source.state.doc.toString().indexOf("# {{ zt.title }}"),
        insert: "Study notes\n",
      },
      userEvent: "input.type",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: m.workbench_basic() }));
  fireEvent.click(screen.getByRole("button", { name: m.workbench_undo() }));
  fireEvent.click(screen.getByRole("button", { name: m.workbench_advanced() }));
  expect(sourceView().state.doc.toString()).toBe(DEFAULT_PROFILE_SOURCE);
  fireEvent.click(screen.getByRole("button", { name: m.workbench_redo() }));
  expect(sourceView().state.doc.toString()).toContain(
    "Study notes\n# {{ zt.title }}",
  );
});

it("opens the format from a collapsed placeholder and preserves the note across tabs and modes", () => {
  const source = DEFAULT_PROFILE_SOURCE.replace(
    "# {{ zt.title }}",
    '# {{ zt.title }}\n\nBefore {% render "annotation" with annotation as zt %} after',
  );
  using mounted = mount(<Panes />, { source });
  const { container } = render(mounted.ui);
  const placeholders = [
    ...container.querySelectorAll<HTMLElement>("[data-annotation-box]"),
  ];
  expect(placeholders).toHaveLength(2);
  for (const placeholder of placeholders) {
    expect(
      placeholder.querySelector("[aria-pressed]")?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(placeholder.textContent).not.toContain("{% render");
    expect(placeholder.querySelector(".cm-editor")).toBeNull();
    expect(placeholder.closest(".cm-line")).not.toBeNull();
  }
  const note = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: m.workbench_tab_note() }),
  )!;
  act(() => note.dispatch({ selection: { anchor: 4 } }));
  fireEvent.click(placeholders[1]!.querySelector("[aria-pressed]")!);
  expect(screen.getAllByRole("document")).toHaveLength(1);
  expect(
    placeholders[1]!.querySelector("[data-annotation-preview]"),
  ).toBeNull();
  expect(
    container.querySelector("[data-annotation-preview]")?.closest(".cm-line"),
  ).toBeNull();
  fireEvent.click(placeholders[0]!.querySelector("[aria-pressed]")!);
  expect(
    placeholders[1]!
      .querySelector("[aria-pressed]")
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
  expect(screen.getAllByRole("document")).toHaveLength(1);
  fireEvent.click(placeholders[1]!.querySelector("[aria-pressed]")!);
  fireEvent.click(
    placeholders[1]!.querySelector(
      `[aria-label="${m.workbench_annotation_edit_format()}"]`,
    )!,
  );
  expect(
    screen
      .getByRole("tab", { name: m.workbench_tab_annotation() })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: m.workbench_tab_note() }));
  expect(
    EditorView.findFromDOM(
      screen.getByRole("textbox", { name: m.workbench_tab_note() }),
    ),
  ).toBe(note);
  expect(note.state.selection.main.head).toBe(4);
  expect(
    placeholders[1]!
      .querySelector("[aria-pressed]")
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(note.state.doc.toString()).toContain(
    '{% render "annotation" with annotation as zt %}',
  );
  fireEvent.click(screen.getByRole("button", { name: m.workbench_advanced() }));
  fireEvent.click(screen.getByRole("button", { name: m.workbench_basic() }));
  expect(
    EditorView.findFromDOM(
      screen.getByRole("textbox", { name: m.workbench_tab_note() }),
    ),
  ).toBe(note);
  expect(note.state.selection.main.head).toBe(4);
  expect(
    placeholders[1]!
      .querySelector("[aria-pressed]")
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
});

it("restores a reversed stale slice selection without moving focus or host scroll", () => {
  function RestorePane() {
    const controller = useWorkbenchController();
    const { from, to } = controller.sliceRange("note");
    return (
      <SliceEditor
        controller={controller}
        slice="note"
        label="Restored note"
        reveal={{
          from: to + 100,
          to: from + 2,
          focus: false,
          scrollIntoView: false,
        }}
      />
    );
  }
  using cleanup = new DisposableStack();
  const external = cleanup.adopt(document.createElement("input"), (element) =>
    element.remove(),
  );
  document.body.append(external);
  external.focus();
  using mounted = mount(<RestorePane />);
  const { container } = render(mounted.ui);
  const editor = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: "Restored note" }),
  )!;
  expect(editor.state.selection.main.anchor).toBe(editor.state.doc.length);
  expect(editor.state.selection.main.head).toBe(2);
  expect(document.activeElement).toBe(external);
  expect(
    container.querySelector<HTMLElement>("[data-workbench-scroll=note]")!
      .scrollTop,
  ).toBe(0);
});
