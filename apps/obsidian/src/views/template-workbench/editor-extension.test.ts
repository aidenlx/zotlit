// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  eta,
  jsonRule,
  liquidTemplate,
  templateHighlighting,
} from "@zotlit/workbench/language";

import { themeHook } from "@/lib/theme-hooks";

import { CODE_PANE_CLASS, codePane } from "./editor-extension";
import { windowMigration } from "./test-window-migration";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  Reflect.deleteProperty(navigator, "clipboard");
});

function mount(doc: string, language: Extension) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [language, templateHighlighting],
    }),
    parent: document.body,
  });
  return view;
}

/** The text under each element of one hook class, in document order. */
function texts(editor: EditorView, hook: string): string[] {
  return [...editor.contentDOM.querySelectorAll(`.${hook}`)].map(
    (element) => element.textContent,
  );
}

describe("template token hooks", () => {
  it("names each kind of Liquid token by its public class", () => {
    const editor = mount(
      '{%- if zt.notes.size > 0 -%}{{ zt.title | map: "x", 2 }}{% endif %}',
      liquidTemplate,
    );
    expect(texts(editor, themeHook.templateDelimiter)).toEqual([
      "{%-",
      "-%}",
      "{{",
      "}}",
      "{%",
      "%}",
    ]);
    expect(texts(editor, themeHook.templateKeyword)).toEqual(["if", "endif"]);
    expect(texts(editor, themeHook.templateVariable)).toEqual(["zt", "zt"]);
    expect(texts(editor, themeHook.templateProperty)).toEqual([
      "notes",
      "size",
      "title",
    ]);
    expect(texts(editor, themeHook.templateFilter)).toEqual(["map"]);
    expect(texts(editor, themeHook.templateString)).toEqual(['"x"']);
    expect(texts(editor, themeHook.templateValue)).toEqual(["0", "2"]);
    expect(texts(editor, themeHook.templateOperator)).toEqual([
      ".",
      ".",
      ">",
      ".",
    ]);
    expect(texts(editor, themeHook.templatePunctuation)).toEqual([
      "|",
      ":",
      ",",
    ]);
  });

  it("colors a ZotLit block tag and its closer, which the parser refuses", () => {
    const editor = mount("{% bq %}x{%- endbq -%}", liquidTemplate);
    expect(texts(editor, themeHook.templateDelimiter)).toEqual([
      "{%",
      "%}",
      "{%-",
      "-%}",
    ]);
    expect(texts(editor, themeHook.templateKeyword)).toEqual(["bq", "endbq"]);
  });

  it("keeps an incomplete Liquid output on the parser's token path", () => {
    const editor = mount("{{ zt", liquidTemplate);
    expect(texts(editor, themeHook.templateDelimiter)).toEqual(["{{"]);
    expect(texts(editor, themeHook.templateVariable)).toEqual(["zt"]);
    expect(texts(editor, themeHook.templateKeyword)).toEqual([]);
  });

  it("marks a Liquid comment and leaves the prose between tags bare", () => {
    const editor = mount(
      "Plain {% comment %}x{% endcomment %}",
      liquidTemplate,
    );
    expect(texts(editor, themeHook.templateComment)).toEqual(["x"]);
    const plain = editor.contentDOM.querySelector(".cm-line")!.firstChild!;
    expect(plain.nodeType).toBe(Node.TEXT_NODE);
    expect(plain.textContent).toBe("Plain ");
  });

  it("names Eta delimiters and keeps tag bodies plain", () => {
    const editor = mount("<%= it.title.toUpperCase() %>", eta);
    expect(texts(editor, themeHook.templateDelimiter)).toEqual(["<%=", "%>"]);
    expect(texts(editor, themeHook.templateVariable)).toEqual([]);
    expect(texts(editor, themeHook.templateProperty)).toEqual([]);
    expect(texts(editor, themeHook.templateFilter)).toEqual([]);
  });

  it("names JSON keys and values in a rule", () => {
    const editor = mount('{"key": "title", "n": 1, "on": true}', jsonRule);
    expect(texts(editor, themeHook.templateDelimiter)).toEqual(["{", "}"]);
    expect(texts(editor, themeHook.templateProperty)).toEqual([
      '"key"',
      '"n"',
      '"on"',
    ]);
    expect(texts(editor, themeHook.templateString)).toEqual(['"title"']);
    expect(texts(editor, themeHook.templateValue)).toEqual(["1", "true"]);
  });
});

/**
 * A code pane in `document.body`, closed when its scope ends. Declared after
 * the window-migration stub, it closes before the stub is restored.
 */
function codePaneEditor(doc: string) {
  const editor = new EditorView({
    state: EditorState.create({ doc, extensions: [codePane] }),
    parent: document.body,
  });
  let open = true;
  const close = () => {
    if (open) editor.destroy();
    open = false;
  };
  return { editor, close, [Symbol.dispose]: close };
}

describe("code panes", () => {
  it("puts the code class on the editor element", () => {
    using _migration = windowMigration();
    using pane = codePaneEditor("");
    expect(pane.editor.dom.classList.contains(CODE_PANE_CLASS)).toBe(true);
  });

  it("moves editor styles to its new document and releases the native listener", () => {
    using host = windowMigration();
    using pane = codePaneEditor("{{ zt.title }}");
    const { editor } = pane;
    const state = editor.state;
    const destination = document.implementation.createHTMLDocument();
    const setRoot = vi.spyOn(editor, "setRoot");
    const measure = vi.spyOn(editor, "requestMeasure");
    host.move({ document: destination } as Window);
    expect(setRoot).toHaveBeenCalledWith(destination);
    expect(measure).toHaveBeenCalled();
    expect(editor.state).toBe(state);
    pane.close();
    expect(host.release).toHaveBeenCalledOnce();
  });

  it("takes the document it stands in as its root when it takes focus, though no move was told", () => {
    // Obsidian tells of a move when the element shows, which an editor in a
    // closed popover does not.
    using _host = windowMigration();
    using pane = codePaneEditor("{{ zt.title }}");
    const { editor } = pane;
    const destination = document.implementation.createHTMLDocument();
    destination.body.append(editor.dom);
    editor.contentDOM.dispatchEvent(new FocusEvent("focus"));
    expect(editor.root).toBe(destination);
  });

  it("copies in a popout without moving focus through a fallback textarea", () => {
    using host = windowMigration();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    using pane = codePaneEditor("alpha beta");
    const view = pane.editor;
    frame.contentDocument!.body.append(view.dom);
    host.move(frame.contentWindow!);
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    view.focus();

    const copy = new Event("copy", { bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(copy);

    expect(copy.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith("alpha");
    expect(frame.contentDocument!.activeElement).toBe(view.contentDOM);
    expect(frame.contentDocument!.querySelector("textarea")).toBeNull();
    frame.remove();
  });
});
