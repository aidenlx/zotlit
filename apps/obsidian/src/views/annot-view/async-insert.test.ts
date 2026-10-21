// @vitest-environment happy-dom
import { history, undo } from "@codemirror/commands";
import type {
  Editor,
  EventRef,
  MarkdownFileInfo,
  TFile,
  Workspace,
} from "obsidian";
import { describe, expect, it } from "vitest";

import { stateEditor } from "./__fixtures__/editor";
import { captureInsertion } from "./async-insert";

/** The workspace events a held insertion listens to, triggered by hand. */
function fakeWorkspace() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (name: string, callback: () => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(callback);
    listeners.set(name, set);
    return { name, callback } as unknown as EventRef;
  };
  return {
    on: on as Workspace["on"],
    offref(ref: EventRef) {
      const { name, callback } = ref as unknown as {
        name: string;
        callback: () => void;
      };
      listeners.get(name)?.delete(callback);
    },
    trigger(name: string) {
      for (const callback of listeners.get(name) ?? []) callback();
    },
    listening: () =>
      [...listeners.values()].reduce((count, set) => count + set.size, 0),
  };
}

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
  const workspace = fakeWorkspace();
  const target = captureInsertion({
    editor,
    info,
    isCurrent: () => current,
    workspace,
  });
  return {
    cm,
    info,
    target,
    workspace,
    switchEditor: () => {
      current = false;
    },
    returnToEditor: () => {
      current = true;
    },
    [Symbol.dispose]() {
      target[Symbol.dispose]();
      cm.destroy();
    },
  };
}

/** An insertion held over `from`–`to` of a note reading `doc`. */
function holdAt(doc: string, from: number, to = from) {
  const cm = stateEditor({ doc });
  const editor = { cm } as Editor;
  const info = { editor, file: { path: "t.md" } as TFile } as MarkdownFileInfo;
  const target = captureInsertion({
    editor,
    info,
    isCurrent: () => true,
    range: { from, to },
    workspace: fakeWorkspace(),
  });
  return {
    cm,
    target,
    /** The note, with `|` where the cursor rests. */
    withCursor: () => {
      const { doc: text, selection } = cm.state;
      const head = selection.main.head;
      return `${text.sliceString(0, head)}|${text.sliceString(head)}`;
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
  it.each(["active-leaf-change", "layout-change"])(
    "stays cancelled once a %s leaves another note current, even after the researcher returns",
    (event) => {
      using f = fixture();
      f.switchEditor();
      f.workspace.trigger(event);
      f.returnToEditor();
      expect(f.target.commit("late")).toBe(false);
      expect(f.cm.state.doc.toString()).toBe("before TARGET after");
    },
  );
  it("stops listening to the workspace once it settles", () => {
    using f = fixture();
    expect(f.target.commit("text")).toBe(true);
    expect(f.workspace.listening()).toBe(0);
  });
  it("maps an explicit drop position independently of the selection", () => {
    using f = fixture();
    using target = captureInsertion({
      editor: f.info.editor!,
      info: f.info,
      isCurrent: () => true,
      range: { from: 19, to: 19 },
      workspace: f.workspace,
    });
    f.cm.dispatch({ changes: { from: 0, insert: "prefix " } });
    expect(target.commit(" DROP")).toBe(true);
    expect(f.cm.state.doc.toString()).toBe("prefix before TARGET after DROP ");
  });
  it("cancels an explicit drop position when an edit lands on it", () => {
    using f = fixture();
    using target = captureInsertion({
      editor: f.info.editor!,
      info: f.info,
      isCurrent: () => true,
      range: { from: 7, to: 7 },
      workspace: f.workspace,
    });
    f.cm.dispatch({ changes: { from: 7, insert: "overlap" } });
    expect(target.commit(" DROP")).toBe(false);
    expect(f.cm.state.doc.toString()).toBe("before overlapTARGET after");
  });
});

describe("a multi-line insertion", () => {
  const CALLOUT = "> [!note] Page 1\n>\n> A quote.";
  const insertAt = (doc: string, at: number, text = CALLOUT) => {
    using held = holdAt(doc, at);
    expect(held.target.commit(text)).toBe(true);
    return held.cm.state.doc.toString();
  };

  it.each([
    {
      where: "the end of a text line",
      doc: "A sentence.",
      at: 11,
      expected: `A sentence.\n\n${CALLOUT}`,
    },
    {
      where: "an empty last line under text",
      doc: "A sentence.\n",
      at: 12,
      expected: `A sentence.\n\n${CALLOUT}`,
    },
    {
      where: "the middle of a line",
      doc: "LEFT RIGHT",
      at: 5,
      expected: `LEFT \n\n${CALLOUT}\n\nRIGHT`,
    },
    {
      where: "the start of a text line",
      doc: "A\nB",
      at: 2,
      expected: `A\n\n${CALLOUT}\n\nB`,
    },
    {
      where: "an empty line between blank lines",
      doc: "A\n\n\n\nB",
      at: 3,
      expected: `A\n\n${CALLOUT}\n\nB`,
    },
    { where: "an empty document", doc: "", at: 0, expected: CALLOUT },
  ])("stands as its own block at $where", ({ doc, at, expected }) => {
    expect(insertAt(doc, at)).toBe(expected);
  });

  it("drops the rendered text's own edge line breaks", () => {
    expect(insertAt("A sentence.", 11, `\n${CALLOUT}\n`)).toBe(
      `A sentence.\n\n${CALLOUT}`,
    );
  });

  it("keeps a one-line insertion inline", () => {
    expect(insertAt("A sentence.", 2, "short ")).toBe("A short sentence.");
  });

  it("leaves the cursor at the end of the block", () => {
    using held = holdAt("A\nB", 2);
    held.target.commit(CALLOUT);
    expect(held.withCursor()).toBe(`A\n\n${CALLOUT}\n\n|B`);
  });
});

describe("a one-line insertion", () => {
  const QUOTE = "“a quote” [Zotero](zotero://open)";
  /** The note after `text` lands at `at`, with `|` where the cursor rests. */
  const insertAt = (doc: string, at: number, text = QUOTE) => {
    using held = holdAt(doc, at);
    expect(held.target.commit(text)).toBe(true);
    return held.withCursor();
  };

  it.each([
    {
      where: "before a word",
      doc: "As shown here",
      at: 9,
      expected: `As shown ${QUOTE} |here`,
    },
    {
      where: "before a space, which it reuses",
      doc: "As shown here",
      at: 8,
      expected: `As shown${QUOTE} |here`,
    },
    {
      where: "at the end of a line",
      doc: "As shown\nnext",
      at: 8,
      expected: `As shown${QUOTE} |\nnext`,
    },
    {
      where: "at the end of the note",
      doc: "As shown ",
      at: 9,
      expected: `As shown ${QUOTE} |`,
    },
  ])(
    "leaves one space after it $where, so typing goes on past it",
    ({ doc, at, expected }) => {
      expect(insertAt(doc, at)).toBe(expected);
    },
  );

  it("runs straight into closing punctuation", () => {
    expect(insertAt("As shown.", 8)).toBe(`As shown${QUOTE}|.`);
  });

  it("adds no space after text that already ends in one", () => {
    expect(insertAt("As shown here", 9, "@key ")).toBe("As shown @key |here");
  });

  it("reads the text after it as the insert lands, not as it starts", () => {
    using held = holdAt("As shown [>q] here", 9, 13);
    // The space after the range goes while the text is prepared.
    held.cm.dispatch({ changes: { from: 13, to: 14 } });
    held.target.commit(QUOTE);
    expect(held.withCursor()).toBe(`As shown ${QUOTE} |here`);
  });
});
