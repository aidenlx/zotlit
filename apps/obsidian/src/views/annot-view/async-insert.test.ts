// @vitest-environment happy-dom
import { history, undo } from "@codemirror/commands";
import type { Editor, MarkdownFileInfo, TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import { stateEditor } from "./__fixtures__/editor";
import { captureInsertion } from "./async-insert";

function fixture() {
  const cm = stateEditor({
    doc: "before TARGET after",
    selection: { anchor: 7, head: 13 },
    extensions: [history()],
  });
  const editor = { cm } as Editor;
  const info = {
    editor,
    file: { path: "target.md" } as TFile,
  } as MarkdownFileInfo;
  let current = true;
  const target = captureInsertion({ editor, info, isCurrent: () => current });
  return {
    cm,
    info,
    target,
    switchEditor: () => {
      current = false;
    },
    [Symbol.dispose]() {
      target[Symbol.dispose]();
      cm.destroy();
    },
  };
}

describe("captured asynchronous insertion", () => {
  it("maps edits before the selection and creates one isolated undo step", async () => {
    using f = fixture();
    const prepared = Promise.withResolvers<string>();
    const operation = prepared.promise.then((text) => f.target.commit(text));
    f.cm.dispatch({ changes: { from: 0, insert: "new " } });
    f.cm.dispatch({ selection: { anchor: 0 } });
    prepared.resolve("![excerpt](image.png)");
    expect(await operation).toBe(true);
    expect(f.cm.state.doc.toString()).toBe(
      "new before ![excerpt](image.png) after",
    );
    expect(undo(f.cm)).toBe(true);
    expect(f.cm.state.doc.toString()).toBe("new before TARGET after");
    expect(f.target.commit("duplicate")).toBe(false);
  });
  it("cancels when edits overlap the captured selection", () => {
    using f = fixture();
    f.cm.dispatch({ changes: { from: 8, to: 10, insert: "user" } });
    expect(f.target.commit("late")).toBe(false);
    expect(f.cm.state.doc.toString()).toBe("before TuserGET after");
  });
  it.each(["switch", "file", "close", "cancel", "escape"])(
    "refuses late completion after %s",
    (reason) => {
      using f = fixture();
      if (reason === "switch") f.switchEditor();
      if (reason === "file")
        Object.assign(f.info, { file: { path: "other.md" } as TFile });
      if (reason === "close") f.cm.dom.remove();
      if (reason === "cancel") f.target.cancel();
      if (reason === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(f.target.commit("late")).toBe(false);
      expect(f.cm.state.doc.toString()).toBe("before TARGET after");
    },
  );
  it("maps an explicit drop position independently of the selection", () => {
    using f = fixture();
    using target = captureInsertion({
      editor: f.info.editor!,
      info: f.info,
      isCurrent: () => true,
      range: { from: 19, to: 19 },
    });
    f.cm.dispatch({ changes: { from: 0, insert: "prefix " } });
    expect(target.commit(" DROP")).toBe(true);
    expect(f.cm.state.doc.toString()).toBe("prefix before TARGET after DROP");
  });
  it("cancels an explicit drop position when an edit lands on it", () => {
    using f = fixture();
    using target = captureInsertion({
      editor: f.info.editor!,
      info: f.info,
      isCurrent: () => true,
      range: { from: 7, to: 7 },
    });
    f.cm.dispatch({ changes: { from: 7, insert: "overlap" } });
    expect(target.commit(" DROP")).toBe(false);
    expect(f.cm.state.doc.toString()).toBe("before overlapTARGET after");
  });
});
