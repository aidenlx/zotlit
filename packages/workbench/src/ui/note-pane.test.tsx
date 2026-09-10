import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { WorkbenchHostProvider } from "./host";
import { NotePane } from "./note-pane";
import { SliceEditor } from "./slice-editor";
import { fakeHost, renderWithMessages as render } from "./test-host";
import { m } from "./test-messages";

import { WorkbenchDocumentController } from "#/document/controller";
import { DEFAULT_PROFILE_SOURCE } from "#/render/default-profile";

afterEach(cleanup);

function note(
  controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE),
  example: { preview?: string | null; previewHint?: string | null } = {},
) {
  const host = fakeHost();
  const open = vi.fn<() => void>();
  const result = render(
    <WorkbenchHostProvider host={host}>
      <NotePane
        controller={controller}
        preview="An example annotation"
        formatProblem={null}
        onOpenAnnotation={open}
        {...example}
      />
    </WorkbenchHostProvider>,
  );
  const view = EditorView.findFromDOM(
    result.container.querySelector(".cm-editor")!,
  )!;
  return { ...result, controller, view, open };
}

it("names the Managed Block and reveals its boundary source when selected", () => {
  const { container, controller, view } = note();
  expect(container.textContent).toContain(m.workbench_managed_start());
  expect(container.textContent).toContain(m.workbench_managed_end());
  expect(view.contentDOM.textContent).not.toContain("{% managed %}");
  const tag = controller.noteRegions.managedBlock!.open;
  act(() =>
    view.dispatch({
      selection: { anchor: tag.from - controller.sliceRange("note").from },
    }),
  );
  expect(view.contentDOM.textContent).toContain("{% managed %}");
  expect(
    container.querySelectorAll('[data-part="managed-line"]').length,
  ).toBeGreaterThan(0);
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  expect(view.contentDOM.textContent).not.toContain("{% managed %}");
});

it("opens the injected example and routes each placeholder to Annotation", () => {
  const { open } = note();
  expect(screen.queryByText("An example annotation")).toBeNull();
  const toggle = screen.getAllByRole("button", {
    name: m.workbench_annotation_preview(),
  })[0]!;
  expect(toggle.getAttribute("aria-description")).toBe(
    m.workbench_annotation_preview(),
  );
  expect(toggle.hasAttribute("title")).toBe(false);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("document").textContent).toBe(
    "An example annotation",
  );
  fireEvent.click(
    screen.getAllByRole("button", {
      name: m.workbench_annotation_edit_format(),
    })[0]!,
  );
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(toggle);
  expect(screen.queryByText("An example annotation")).toBeNull();
});

it("names the choice the example waits on instead of a render in flight", () => {
  const { container } = note(undefined, {
    preview: null,
    previewHint: "Choose an annotation",
  });
  fireEvent.click(
    screen.getAllByRole("button", {
      name: m.workbench_annotation_preview(),
    })[0]!,
  );
  expect(container.textContent).toContain("Choose an annotation");
  expect(container.textContent).not.toContain(m.workbench_result_pending());
});

it("reads as pending while a render is on its way", () => {
  const { container } = note(undefined, { preview: null });
  fireEvent.click(
    screen.getAllByRole("button", {
      name: m.workbench_annotation_preview(),
    })[0]!,
  );
  expect(container.textContent).toContain(m.workbench_result_pending());
});

it("keeps edits in the master history when Advanced mounts and unmounts", () => {
  const { controller, view } = note();
  act(() =>
    view.dispatch({
      changes: { from: 0, insert: "Written in Note\n" },
      userEvent: "input.type",
    }),
  );
  expect(controller.source).toContain("Written in Note");
  const advanced = render(
    <SliceEditor controller={controller} slice="advanced" label="Source" />,
  );
  const source = EditorView.findFromDOM(
    advanced.container.querySelector(".cm-editor")!,
  )!;
  expect(source.state.doc.toString()).toBe(controller.source);
  advanced.unmount();
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(DEFAULT_PROFILE_SOURCE);
  expect(view.state.doc.toString()).toBe(controller.sliceText("note"));
});

it("moves one example between calls and retains it through a source edit", () => {
  const controller = new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE);
  const call = controller.noteRegions.annotationCalls[0]!.call;
  const text = controller.source.slice(call.from, call.to);
  controller.dispatch({ changes: { from: call.to, insert: `\n${text}` } });
  const { container } = note(controller);
  const toggles = screen.getAllByRole("button", {
    name: m.workbench_annotation_preview(),
  });
  fireEvent.click(toggles[0]!);
  fireEvent.click(toggles[1]!);
  expect(screen.getAllByRole("document")).toHaveLength(1);
  expect(toggles[0]!.getAttribute("aria-pressed")).toBe("false");
  expect(toggles[1]!.getAttribute("aria-pressed")).toBe("true");
  act(() =>
    controller.dispatch({
      changes: {
        from: controller.sliceRange("note").from,
        insert: "New introduction\n",
      },
    }),
  );
  expect(screen.getAllByRole("document")).toHaveLength(1);
  expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
});

it("renders newly inserted annotation placeholders from controller updates", () => {
  const { controller } = note();
  const before = screen.getAllByRole("button", {
    name: m.workbench_annotation_edit_format(),
  }).length;
  const call = controller.noteRegions.annotationCalls[0]!.call;
  const text = controller.source.slice(call.from, call.to);
  act(() =>
    controller.dispatch({ changes: { from: call.to, insert: `\n${text}` } }),
  );
  expect(
    screen.getAllByRole("button", {
      name: m.workbench_annotation_edit_format(),
    }),
  ).toHaveLength(before + 1);
});

it("reveals annotation and managed tags while the selection touches their source", () => {
  const { view } = note();
  const content = view.contentDOM;
  const text = view.state.doc.toString();
  const call = text.indexOf("{% render_annotation annotation %}");
  const managed = text.indexOf("{% managed %}");
  const endmanaged = text.indexOf("{% endmanaged %}");
  expect(content.textContent).not.toContain("{% render_annotation");
  expect(content.textContent).not.toContain("{% managed %}");
  expect(content.textContent).not.toContain("{% endmanaged %}");
  for (const position of [
    call,
    call + 10,
    call + "{% render_annotation annotation %}".length,
  ]) {
    act(() => view.dispatch({ selection: { anchor: position } }));
    expect(content.textContent).toContain("{% render_annotation annotation %}");
    expect(content.textContent).not.toContain("{% managed %}");
  }
  act(() =>
    view.dispatch({ selection: { anchor: managed + 3, head: endmanaged + 4 } }),
  );
  expect(content.textContent).toContain("{% managed %}");
  expect(content.textContent).toContain("{% render_annotation annotation %}");
  expect(content.textContent).toContain("{% endmanaged %}");
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  expect(content.textContent).not.toContain("{% render_annotation");
  expect(content.textContent).not.toContain("{% managed %}");
  expect(content.textContent).not.toContain("{% endmanaged %}");
  expect(view.state.doc.toString()).toBe(text);
});

it("shares preview toggles on one line and turns other lines off", () => {
  const source = DEFAULT_PROFILE_SOURCE.replace(
    "# {{ zt.title }}",
    "# {{ zt.title }}\n\n{% render_annotation zt.annotations[0] %} {% render_annotation zt.annotations[0] %}",
  );
  const { container } = note(new WorkbenchDocumentController(source));
  const toggles = [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[data-annotation-box] [aria-pressed]",
    ),
  ];
  expect(toggles).toHaveLength(3);
  const states = () =>
    toggles.map((toggle) => toggle.getAttribute("aria-pressed"));
  fireEvent.click(toggles[0]!);
  expect(states()).toEqual(["true", "true", "false"]);
  expect(screen.getAllByRole("document")).toHaveLength(1);
  fireEvent.click(toggles[2]!);
  expect(states()).toEqual(["false", "false", "true"]);
  fireEvent.click(toggles[1]!);
  expect(states()).toEqual(["true", "true", "false"]);
  fireEvent.click(toggles[0]!);
  expect(states()).toEqual(["false", "false", "false"]);
  expect(screen.queryByRole("document")).toBeNull();
});

it("keeps the preview on its line through Note and Source edits", () => {
  const call = "{% render_annotation zt.annotations[0] %}";
  const { container, view, controller } = note(
    new WorkbenchDocumentController(
      DEFAULT_PROFILE_SOURCE.replace(
        "# {{ zt.title }}",
        `# {{ zt.title }}\n\n${call}`,
      ),
    ),
  );
  const toggles = () => [
    ...container.querySelectorAll<HTMLButtonElement>(
      "[data-annotation-box] [aria-pressed]",
    ),
  ];
  const states = () =>
    toggles().map((toggle) => toggle.getAttribute("aria-pressed"));
  fireEvent.click(toggles()[0]!);
  act(() =>
    view.dispatch({
      changes: { from: 0, insert: "Earlier note text\n\n" },
      selection: { anchor: 0 },
    }),
  );
  expect(states()).toEqual(["true", "false"]);
  expect(screen.getAllByRole("document")).toHaveLength(1);
  const advanced = render(
    <SliceEditor controller={controller} slice="advanced" label="Source" />,
  );
  const source = EditorView.findFromDOM(
    advanced.container.querySelector(".cm-editor")!,
  )!;
  act(() =>
    source.dispatch({
      changes: {
        from: source.state.doc.toString().indexOf("# {{ zt.title }}"),
        insert: `Another paragraph\n${call}\n\n`,
      },
      selection: { anchor: 0 },
    }),
  );
  advanced.unmount();
  expect(states()).toEqual(["false", "true", "false"]);
  expect(screen.getAllByRole("document")).toHaveLength(1);
  const from = view.state.doc.toString().lastIndexOf(call);
  act(() =>
    view.dispatch({
      changes: { from, to: from + call.length },
      selection: { anchor: 0 },
    }),
  );
  expect(states()).toEqual(["false", "false"]);
  expect(screen.queryByRole("document")).toBeNull();
});
