// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { DEFAULT_PROFILE_SOURCE } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { NotePane } from "./note-pane";

/** A second call, written in the native form, above the built-in one. */
const TWO_CALLS = DEFAULT_PROFILE_SOURCE.replace(
  "# {{ zt.title }}",
  '# {{ zt.title }}\n\n{% render "annotation" with annotation as zt %}',
);

interface OpenPane extends Disposable {
  controller: WorkbenchDocumentController;
  host: HTMLElement;
  /** How many times a later call asked for the one highlight editor. */
  opened: () => number;
}

/** The tab mounted for real, so both editors and the boxes over them run. */
function openPane(source: string): OpenPane {
  const controller = new WorkbenchDocumentController(source);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let opened = 0;
  act(() => {
    root.render(
      <NotePane
        controller={controller}
        onOpenHighlight={() => (opened += 1)}
        onEditing={() => {}}
      />,
    );
  });
  return {
    controller,
    host,
    opened: () => opened,
    [Symbol.dispose]() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** The editors the pane mounted, by the label each one carries. */
function labels(host: HTMLElement): string[] {
  return [...host.querySelectorAll(".cm-content")].map(
    (content) => content.getAttribute("aria-label") ?? "",
  );
}

describe("the Your note tab", () => {
  it("opens the highlight editor at the first render call", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE);

    expect(pane.host.textContent).toContain(m.workbench_highlight_heading());
    expect(labels(pane.host)).toEqual([
      m.workbench_tab_note(),
      m.workbench_highlight_label(),
    ]);
    // The box edits the Annotation Section of the same document.
    const editor = pane.host.querySelector(
      `[aria-label="${m.workbench_highlight_label()}"]`,
    )!;
    expect(editor.textContent).toContain("{% bq %}");
  });

  it("names the Managed Block instead of its raw tags", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE);
    const note = pane.host.querySelector(
      `[aria-label="${m.workbench_tab_note()}"]`,
    )!;

    expect(note.textContent).toContain(m.workbench_managed_start());
    expect(note.textContent).toContain(m.workbench_managed_end());
    expect(note.textContent).not.toContain("{% managed %}");
    expect(note.querySelectorAll(".zt-managed").length).toBeGreaterThan(0);
  });

  it("links a later call back to the one editor rather than opening a second", () => {
    using pane = openPane(TWO_CALLS);
    const links = [...pane.host.querySelectorAll("button")].filter(
      (button) => button.textContent === m.workbench_highlight_later_call(),
    );

    // Two calls, one editor: the second call carries the name and the way back.
    expect(links).toHaveLength(1);
    expect(labels(pane.host)).toHaveLength(2);

    act(() => {
      links[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pane.opened()).toBe(1);
  });

  it("writes an edit in the box to the section bytes alone", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE);
    const view = EditorView.findFromDOM(
      pane.host.querySelectorAll<HTMLElement>(".cm-editor")[1]!,
    )!;

    act(() => {
      view.dispatch({
        changes: { from: 0, insert: "Marked. " },
        userEvent: "input.type",
      });
    });

    expect(pane.controller.source).toBe(
      DEFAULT_PROFILE_SOURCE.replace(
        "--- zotlit:annotation ---\n{% bq %}",
        "--- zotlit:annotation ---\nMarked. {% bq %}",
      ),
    );
    expect(pane.controller.problems).toEqual([]);
  });
});
