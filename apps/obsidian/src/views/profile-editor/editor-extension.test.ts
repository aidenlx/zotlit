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

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
  Reflect.deleteProperty(HTMLElement.prototype, "onWindowMigrated");
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

describe("code panes", () => {
  function migrationHost() {
    let migrate: ((win: Window) => void) | null = null;
    const dispose = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "onWindowMigrated", {
      configurable: true,
      value: (listener: (win: Window) => void) => {
        migrate = listener;
        return dispose;
      },
    });
    return { dispose, move: (win: Window) => migrate?.(win) };
  }
  it("puts the code class on the editor element", () => {
    migrationHost();
    view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [codePane] }),
      parent: document.body,
    });
    expect(view.dom.classList.contains(CODE_PANE_CLASS)).toBe(true);
  });

  it("moves editor styles to its new document and releases the native listener", () => {
    const host = migrationHost();
    view = new EditorView({
      state: EditorState.create({
        doc: "{{ zt.title }}",
        extensions: [codePane],
      }),
      parent: document.body,
    });
    const state = view.state;
    const destination = document.implementation.createHTMLDocument();
    const setRoot = vi.spyOn(view, "setRoot");
    const measure = vi.spyOn(view, "requestMeasure");
    host.move({ document: destination } as Window);
    expect(setRoot).toHaveBeenCalledWith(destination);
    expect(measure).toHaveBeenCalled();
    expect(view.state).toBe(state);
    view.destroy();
    view = null;
    expect(host.dispose).toHaveBeenCalledOnce();
  });
});
