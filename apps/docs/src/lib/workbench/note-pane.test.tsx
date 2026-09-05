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
  /** How many times the box asked for the section in Source. */
  sourced: () => number;
  /** What the box last told the host about the reader being at the format. */
  emphasis: () => boolean | null;
  /** The box's two faces, by whether each is the one the reader can use. */
  faces: () => Record<"preview" | "source", boolean>;
  press: (label: string) => void;
}

interface PaneOptions {
  /** The one highlight the render produced, or null for a sample without. */
  preview?: string | null;
  /** The render's own complaint about the format. */
  formatProblem?: string | null;
  count?: number;
}

/** The tab mounted for real, so both editors and the boxes over them run. */
function openPane(
  source: string,
  {
    preview = "> One highlight",
    formatProblem = null,
    count = 3,
  }: PaneOptions = {},
): OpenPane {
  const controller = new WorkbenchDocumentController(source);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let opened = 0;
  let sourced = 0;
  let emphasis: boolean | null = null;
  act(() => {
    root.render(
      <NotePane
        controller={controller}
        preview={preview}
        formatProblem={formatProblem}
        count={count}
        onOpenHighlight={() => (opened += 1)}
        onOpenSource={() => (sourced += 1)}
        onEmphasis={(on) => (emphasis = on)}
        onEditing={() => {}}
      />,
    );
  });
  return {
    controller,
    host,
    opened: () => opened,
    sourced: () => sourced,
    emphasis: () => emphasis,
    faces: () => ({
      preview: !host
        .querySelector("[data-face=preview]")!
        .hasAttribute("inert"),
      source: !host.querySelector("[data-face=source]")!.hasAttribute("inert"),
    }),
    press(label) {
      const button = [...host.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === label,
      );
      if (!button) throw new Error(`No button reads "${label}".`);
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
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

    expect(pane.host.textContent).toContain(m.workbench_highlight_label());
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
      (button) =>
        button.textContent === m.workbench_highlight_label() &&
        button.title === m.workbench_highlight_chip_hint(),
    );

    // Two calls, one editor: the second call carries the name and the way back.
    expect(links).toHaveLength(1);
    expect(labels(pane.host)).toHaveLength(2);

    act(() => {
      links[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pane.opened()).toBe(1);
  });

  it("shows one rendered highlight first, and the format's source on request", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE, {
      preview: "> Marked text from the paper",
    });

    expect(pane.host.textContent).toContain("Marked text from the paper");
    expect(pane.faces()).toEqual({ preview: true, source: false });

    pane.press(m.workbench_highlight_edit_format());
    expect(pane.faces()).toEqual({ preview: false, source: true });

    pane.press(m.workbench_highlight_done());
    expect(pane.faces()).toEqual({ preview: true, source: false });
  });

  it("folds to its name and back without losing the format's source", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE);
    const fold = pane.host.querySelector<HTMLButtonElement>(
      "[data-highlight-box] [aria-expanded]",
    )!;
    const body = () =>
      pane.host.querySelector("[data-face=preview]")!.parentElement!;

    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(fold.getAttribute("aria-label")).toBe(m.workbench_highlight_close());
    act(() => fold.click());
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.getAttribute("aria-label")).toBe(m.workbench_highlight_edit());
    expect(body().hidden || body().classList.contains("hidden")).toBe(true);
    // Both editors stay mounted, so nothing typed in the format is lost.
    expect(labels(pane.host)).toHaveLength(2);
    act(() => fold.click());
    expect(fold.getAttribute("aria-expanded")).toBe("true");
  });

  it("says how many highlights the one format is used for", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE, { count: 12 });

    expect(pane.host.textContent).toContain(
      m.workbench_highlight_count({ count: 12 }),
    );
  });

  it("keeps the real call and the way to Source beside the box", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE);

    expect(pane.host.textContent).toContain(
      "{% render_annotation annotation %}",
    );
    pane.press(m.workbench_highlight_open_source());
    expect(pane.sourced()).toBe(1);
  });

  it("points at the sample when it has no highlights", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE, { preview: null, count: 0 });

    expect(pane.host.textContent).toContain(
      m.workbench_highlight_preview_empty(),
    );
    expect(pane.host.textContent).toContain(m.workbench_highlight_lede());
    pane.press(m.workbench_highlight_edit_format());
    expect(pane.faces().source).toBe(true);
  });

  it("shows the render problem in place, with the way to fix it", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE, {
      formatProblem: "Unknown filter: shout",
    });

    expect(pane.host.textContent).toContain("Unknown filter: shout");
    pane.press(m.workbench_highlight_fix());
    expect(pane.faces().source).toBe(true);
  });

  it("tells the host while the reader is at the format", () => {
    using pane = openPane(DEFAULT_PROFILE_SOURCE);
    const box = pane.host.querySelector("[data-highlight-box]")!;

    act(() => {
      box.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(pane.emphasis()).toBe(true);
    act(() => {
      box.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(pane.emphasis()).toBe(false);
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
