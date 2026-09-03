// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { etaAutoPair } from "./eta-auto-pair";

interface Editor extends Disposable {
  view: EditorView;
}

function open(doc: string, cursor: number): Editor {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [etaAutoPair()],
    }),
    parent: document.body,
  });
  return {
    view,
    [Symbol.dispose]() {
      view.destroy();
    },
  };
}

function type(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  const insert = () =>
    view.state.update({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, insert));
  if (!handled) view.dispatch(insert());
}

function snapshot(view: EditorView): string {
  const { doc, selection } = view.state;
  const at = selection.main.head;
  return `${doc.sliceString(0, at)}|${doc.sliceString(at)}`;
}

describe("etaAutoPair", () => {
  it("opens a padded pair when % follows <", () => {
    using editor = open("a <", 3);
    type(editor.view, "%");
    expect(snapshot(editor.view)).toBe("a <% | %>");
  });

  it("reflows a prefix and a marker into a fresh pair", () => {
    using editor = open("<%  %>", 3);
    type(editor.view, "=");
    expect(snapshot(editor.view)).toBe("<%= | %>");
    using editor2 = open("<%  %>", 3);
    type(editor2.view, "-");
    expect(snapshot(editor2.view)).toBe("<%- | %>");
    type(editor2.view, "~");
    expect(snapshot(editor2.view)).toBe("<%-~ | %>");
  });

  it("types over the close delimiter", () => {
    using editor = open("<% x %>", 5);
    type(editor.view, "%");
    expect(snapshot(editor.view)).toBe("<% x %|>");
    type(editor.view, ">");
    expect(snapshot(editor.view)).toBe("<% x %>|");
  });

  it("deletes an empty pair with one Backspace", () => {
    using editor = open("<%=  %>", 4);
    const backspace = new KeyboardEvent("keydown", { key: "Backspace" });
    editor.view.contentDOM.dispatchEvent(backspace);
    expect(snapshot(editor.view)).toBe("|");
  });
});
