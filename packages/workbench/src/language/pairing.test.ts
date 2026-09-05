import { defaultKeymap } from "@codemirror/commands";
// @vitest-environment happy-dom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { expect, it, vi } from "vitest";

import { applyTemplateCompletion } from "./completion";
import { liquidMarkdown } from "./liquid";
import { templatePairing } from "./pairing";
import { suggestions } from "./suggestions";

function editor(
  source = "",
  language: "liquid" | "eta" = "liquid",
  mode?: "expression",
) {
  const view = new EditorView({
    state: EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [
        templatePairing(() => ({ language, mode })),
        keymap.of(defaultKeymap),
      ],
    }),
    parent: document.body,
  });
  return { view, [Symbol.dispose]: () => view.destroy() };
}

function type(view: EditorView, text: string) {
  const { from, to } = view.state.selection.main;
  const insert = () =>
    view.state.update({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
  if (
    !view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, from, to, text, insert))
  )
    view.dispatch(insert());
}

function snapshot(view: EditorView) {
  const { doc, selection } = view.state;
  return `${doc.sliceString(0, selection.main.head)}|${doc.sliceString(selection.main.head)}`;
}

it.each([
  ["liquid", "{{", "{{ | }}"],
  ["liquid", "{%", "{% | %}"],
  ["eta", "<%", "<% | %>"],
] as const)(
  "pairs %s %s after the complete opener",
  (language, opening, expected) => {
    using e = editor("", language);
    type(e.view, opening[0]!);
    expect(snapshot(e.view)).toBe(`${opening[0]}|`);
    type(e.view, opening[1]!);
    expect(snapshot(e.view)).toBe(expected);
  },
);

it("skips and deletes generated pairs while preserving existing closing text", () => {
  using e = editor();
  type(e.view, "{");
  type(e.view, "{");
  type(e.view, "value");
  type(e.view, "}");
  expect(snapshot(e.view)).toBe("{{ value }|}");
  type(e.view, "}");
  expect(snapshot(e.view)).toBe("{{ value }}|");
  using existing = editor("{{ value }}");
  existing.view.dispatch({ selection: { anchor: 8 } });
  type(existing.view, "}");
  expect(snapshot(existing.view)).toBe("{{ value}| }}");
  using empty = editor();
  type(empty.view, "{");
  type(empty.view, "%");
  empty.view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(snapshot(empty.view)).toBe("|");
});

it("pairs expression brackets while leaving strings, comments, and raw content literal", () => {
  for (const source of [
    "{% raw %}\n{",
    "{% comment %}\n{",
    "{{ ' {",
    "{% # {",
    "{% liquid\n comment\n {",
  ]) {
    using e = editor(source);
    type(e.view, "{");
    expect(snapshot(e.view)).toBe(`${source}{|`);
  }
  using eta = editor('<%= "%> <', "eta");
  type(eta.view, "%");
  expect(snapshot(eta.view)).toBe('<%= "%> <%|');
  using fence = editor("```\n{");
  type(fence.view, "{");
  expect(snapshot(fence.view)).toBe("```\n{{ | }}");
  using expression = editor("", "liquid", "expression");
  type(expression.view, "(");
  type(expression.view, "[");
  type(expression.view, '"');
  expect(snapshot(expression.view)).toBe('(["|"])');
  type(expression.view, "{");
  expect(snapshot(expression.view)).toBe('(["{|"])');
});

it("reflows fresh opening markers while keeping expression minus ordinary", () => {
  using liquid = editor();
  type(liquid.view, "{");
  type(liquid.view, "{");
  type(liquid.view, "-");
  expect(snapshot(liquid.view)).toBe("{{- | }}");
  using eta = editor("", "eta");
  type(eta.view, "<");
  type(eta.view, "%");
  type(eta.view, "-");
  type(eta.view, "=");
  expect(snapshot(eta.view)).toBe("<%-= | %>");
  type(eta.view, "-");
  type(eta.view, "1");
  expect(snapshot(eta.view)).toBe("<%-= -1| %>");
});

it.each(["liquid", "eta"] as const)(
  "retains only generated closers after %s completion",
  (language) => {
    const open = language === "eta" ? "<%=" : "{{";
    const close = language === "eta" ? "%>" : "}}";
    for (const existing of [false, true]) {
      using e = editor(`${open} zt.ti${existing ? ` ${close}` : ""}`, language);
      e.view.dispatch({ selection: { anchor: open.length + 6 } });
      const result = suggestions(
        e.view.state.doc.toString(),
        e.view.state.selection.main.head,
        { root: "note", partials: [], language },
      )!;
      applyTemplateCompletion(
        e.view,
        result,
        result.options.find((option) => option.label === "title")!,
      );
      expect(snapshot(e.view)).toBe(`${open} zt.title ${close}|`);
      e.view.dispatch({ selection: { anchor: open.length + 9 } });
      type(e.view, close[0]!);
      expect(snapshot(e.view)).toBe(
        existing
          ? `${open} zt.title${close[0]}| ${close}`
          : `${open} zt.title ${close[0]}|${close[1]}`,
      );
    }
  },
);

it("recognizes delimiters and call brackets supplied by explicit snippets", () => {
  using managed = editor("{% man");
  const result = suggestions("{% man", 6, { root: "note", partials: [] })!;
  applyTemplateCompletion(
    managed.view,
    result,
    result.options.find((option) => option.label === "managed")!,
  );
  expect(snapshot(managed.view)).toBe("{% managed %}\n|\n{% endmanaged %}");
  managed.view.dispatch({ selection: { anchor: 10 } });
  type(managed.view, "%");
  expect(snapshot(managed.view)).toBe("{% managed %|}\n\n{% endmanaged %}");
  using helper = editor("<%~ renderA", "eta");
  const helpers = suggestions("<%~ renderA", 11, {
    root: "note",
    partials: [],
    language: "eta",
  })!;
  applyTemplateCompletion(helper.view, helpers, helpers.options[0]!);
  expect(snapshot(helper.view)).toBe("<%~ renderAnnotation(|annotation)");
  helper.view.dispatch({
    selection: { anchor: helper.view.state.doc.length - 1 },
  });
  type(helper.view, ")");
  expect(snapshot(helper.view)).toBe("<%~ renderAnnotation(annotation)|");
});

it("preserves generated closers through scalar and object completion", () => {
  using e = editor();
  type(e.view, "{");
  type(e.view, "{");
  type(e.view, "zt.cre");
  const objects = suggestions(
    e.view.state.doc.toString(),
    e.view.state.selection.main.head,
    { root: "note", partials: [] },
  )!;
  applyTemplateCompletion(
    e.view,
    objects,
    objects.options.find((option) => option.label === "creators")!,
  );
  expect(snapshot(e.view)).toBe("{{ zt.creators.| }}");
  e.view.dispatch({
    changes: { from: 3, to: 15, insert: "zt.ti" },
    selection: { anchor: 8 },
  });
  const fields = suggestions(e.view.state.doc.toString(), 8, {
    root: "note",
    partials: [],
  })!;
  applyTemplateCompletion(
    e.view,
    fields,
    fields.options.find((option) => option.label === "title")!,
  );
  e.view.dispatch({ selection: { anchor: 11 } });
  type(e.view, "}");
  type(e.view, "}");
  expect(snapshot(e.view)).toBe("{{ zt.title }}|");
});

it("leaves paste, composition, selections, and multiple cursors to normal editing", () => {
  using e = editor();
  e.view.dispatch({
    changes: { from: 0, insert: "{{  }}" },
    selection: { anchor: 3 },
    userEvent: "input.paste",
  });
  type(e.view, "}");
  expect(snapshot(e.view)).toBe("{{ }| }}");
  using ime = editor("{");
  const composing = vi
    .spyOn(ime.view, "compositionStarted", "get")
    .mockReturnValue(true);
  type(ime.view, "{");
  expect(snapshot(ime.view)).toBe("{{|");
  composing.mockRestore();
  using selection = editor("{word");
  selection.view.dispatch({ selection: { anchor: 1, head: 5 } });
  type(selection.view, "{");
  expect(snapshot(selection.view)).toBe("{{|");
  const multi = new EditorView({
    state: EditorState.create({
      doc: "{ {",
      selection: EditorSelection.create([
        EditorSelection.cursor(1),
        EditorSelection.cursor(3),
      ]),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        liquidMarkdown,
        templatePairing(),
      ],
    }),
    parent: document.body,
  });
  using cleanup = new DisposableStack();
  cleanup.adopt(multi, (view) => view.destroy());
  {
    const insert = () =>
      multi.state.update(
        multi.state.changeByRange((range) => ({
          changes: { from: range.from, insert: "%" },
          range: EditorSelection.cursor(range.from + 1),
        })),
      );
    expect(
      multi.state
        .facet(EditorView.inputHandler)
        .some((handler) => handler(multi, 1, 1, "%", insert)),
    ).toBe(false);
    multi.dispatch(insert());
    expect(multi.state.doc.toString()).toBe("{% {%");
  }
});

it("skips call brackets supplied by an Eta loop snippet", () => {
  using e = editor("<%= zt.cre %>", "eta");
  const result = suggestions(e.view.state.doc.toString(), 10, {
    root: "note",
    partials: [],
    language: "eta",
  })!;
  const loop = result.options.find((option) => option.category === "loop")!;
  applyTemplateCompletion(e.view, result, loop);
  const source = e.view.state.doc.toString();
  e.view.dispatch({ selection: { anchor: source.indexOf(")") } });
  type(e.view, ")");
  expect(e.view.state.doc.toString()).toBe(source);
  expect(e.view.state.selection.main.head).toBe(source.indexOf(")") + 1);
});

it("keeps an escaped quote inside its generated string", () => {
  using e = editor("", "eta", "expression");
  type(e.view, '"');
  type(e.view, "word\\");
  type(e.view, '"');
  expect(snapshot(e.view)).toBe('"word\\"|"');
  type(e.view, '"');
  expect(snapshot(e.view)).toBe('"word\\""|');
});

it("keeps Eta comments, template strings, and incomplete regex literals inactive", () => {
  for (const source of [
    "value /* comment ",
    "value // comment ",
    "`value ",
    "`value \\`",
    "`outer ${`inner`",
    "/foo",
    "/[/",
    "/foo\\/",
  ]) {
    using e = editor(source, "eta", "expression");
    type(e.view, "(");
    expect(snapshot(e.view)).toBe(`${source}(|`);
  }
  using regex = editor("<% const pattern = /foo", "eta");
  type(regex.view, "(");
  expect(snapshot(regex.view)).toBe("<% const pattern = /foo(|");
  using closed = editor("<% /[/]/g", "eta");
  type(closed.view, "(");
  expect(snapshot(closed.view)).toBe("<% /[/]/g(|)");
});
