import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import {
  noEvalCapture,
  noClassAssertion,
  noMarkupAssertion,
  noSourceText,
  noInternalMock,
} from "./oxlint-plugin-tests.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});

const ztClass = [{ messageId: "ztClass" }];

tester.run("no-class-assertion", noClassAssertion, {
  valid: [
    'expect(el.textContent).toBe("Preview unavailable")',
    'expect(el.dataset.state).toBe("open")',
    'expect(el.classList.contains("is-active")).toBe(true)',
    'render(<div className="zt:flex" />)',
    "expect(render(\"{% render 'annotation', zt: annotation %}\")).toEqual([])",
    "const data = { zt: { title: 'x' } }",
  ],
  invalid: [
    {
      code: 'expect(el.classList.contains("zt:sr-only")).toBe(true)',
      errors: ztClass,
    },
    {
      code: 'return node.classList.contains("zt:border-green")',
      errors: ztClass,
    },
    { code: 'expect(el).toHaveClass("zt:sr-only")', errors: ztClass },
    { code: 'expect(el.classList).toContain("zt:px-3")', errors: ztClass },
    { code: "expect(el.className).toMatch(/zt:text-/)", errors: ztClass },
    {
      code: 'expect(rows.map((el) => el.className)).toEqual(["mod-complex zt:@container"])',
      errors: ztClass,
    },
    {
      code: 'expect(block.querySelector(".zt\\\\:text-destructive")).toBeNull()',
      errors: ztClass,
    },
    {
      code: "const warning = root.querySelector('[class~=\"zt:text-(--text-error)\"]')",
      errors: ztClass,
    },
    {
      code: "obEval(id, `String(p.classList.contains('zt:bg-accent'))`)",
      errors: ztClass,
    },
  ],
});

// Failure modes: a markup read reaches an assertion directly, through a
// matcher, or through a variable it initializes; selecting an element to act
// on it, or by text, role or data attribute, stays legal.
tester.run("no-markup-assertion", noMarkupAssertion, {
  valid: [
    'if (el.classList.contains("is-active")) el.click()',
    'el.className = "suggestion-item"',
    'expect(el.getAttribute("aria-label")).toBe("Open")',
    'render(<div className="suggestion-item mod-complex" />)',
    'root.querySelector<HTMLElement>(".mod-cta")!.click()',
    'expect(root.querySelector("[data-state=open]")).not.toBeNull()',
    'expect(root.querySelector("button[aria-pressed=true]")).not.toBeNull()',
    'expect(root.querySelectorAll("li")).toHaveLength(2)',
    "expect(root.querySelector(selector)).toBeNull()",
    `const button = root.querySelector<HTMLElement>(".mod-cta")!;
     button.click();
     expect(onSubmit).toHaveBeenCalledOnce();`,
    `const input = root.querySelector<HTMLInputElement>("input.prompt-input")!;
     input.value = "kant";
     input.dispatchEvent(new Event("input"));
     expect(store.query).toBe("kant");`,
    `const items = root.querySelectorAll(".suggestion-item");
     fireEvent.click(items[1]!);
     expect(onChoose).toHaveBeenCalledWith("b");`,
    `const editor = EditorView.findFromDOM(root.querySelector(".cm-editor")!)!;
     expect(editor.state.doc.toString()).toBe("{{ title }}");`,
    'expect(EditorView.findFromDOM(root.querySelector(".cm-editor")!)?.state.doc.length).toBe(0)',
  ],
  invalid: [
    'expect(el.classList.contains("is-active")).toBe(true)',
    'expect(item.className).toBe("suggestion-item mod-complex")',
    'expect(rows.map((row) => row.className)).toEqual(["mod-complex"])',
    'expect(el.getAttribute("class")).toContain("is-active")',
    'expect(el.classList).toContain("is-active")',
    'expect(root.querySelector(".zt-code-pane")).toBeNull()',
    'expect(root.querySelectorAll("li.is-selected")).toHaveLength(1)',
    'expect(el.closest(`[class~="is-open"]`)).not.toBeNull()',
    'expect(el.matches(".is-active")).toBe(true)',
    'expect(root.querySelector(".tree-item-self")?.textContent).toBe("A")',
    'expect(root.querySelector("." + CODE_PANE_CLASS)).toBeNull()',
    "expect(root.querySelector(`.${CODE_PANE_CLASS}`)).toBeNull()",
    `const pane = root.querySelector(".zt-code-pane");
     expect(pane).toBeNull();`,
    `const names = [...root.querySelectorAll(".suggestion-item")];
     expect(names.map((item) => item.textContent)).toEqual(["A"]);`,
    `const rows = root.querySelectorAll(".tree-item");
     const first = rows[0];
     expect(first?.textContent).toBe("A");`,
    `const classes = el.className;
     expect(classes).toBe("suggestion-item mod-complex");`,
    `const button = root.querySelector<HTMLElement>(".mod-cta")!;
     button.click();
     expect(button.textContent).toBe("Saved");`,
    'expect(Array.from(root.querySelectorAll(".row"), (row) => row.textContent)).toEqual(["A"])',
    `await vi.waitFor(() =>
       expect(view.dom.querySelector(".cm-unresolved")?.textContent).toBe("@b"),
     );`,
    `const classes = rows.map((row) => {
       return row.className;
     });
     expect(classes).toEqual(["is-selected"]);`,
  ].map((code) => ({ code, errors: [{ messageId: "markup" }] })),
});

// Failure modes: path constructors and templates hide source extensions;
// fixtures remain valid inputs; raw imports read source without a filesystem.
tester.run("no-source-text", noSourceText, {
  valid: [
    'readFile("./fixtures/source.ts", "utf8")',
    'readFileSync(join(root, "__fixtures__", "tsconfig.json"))',
    'readFile(new URL("./test-fixtures/config.yml", import.meta.url))',
    'readFileSync("./__snapshots__/output.md")',
    'readFile("./data.json")',
    'readFile("ts")',
    "readFile(runtimePath)",
    'import data from "./data.json"',
  ],
  invalid: [
    'readFile("./source.ts", "utf8")',
    'fs.readFileSync(join(root, "src", "view.tsx"))',
    'fs.promises.readFile(new URL("../turbo.json", import.meta.url))',
    "readFile(`${root}/README.md`)",
    'readFile(root + "/tsconfig.lib.json")',
    'readFile(join(root, "package.json"))',
    'readFile("./fixtures-not/source.ts")',
    ...["mts", "cts", "js", "mjs", "cjs", "yml", "yaml", "mdx", "css"].map(
      (extension) => `readFile("./file.${extension}")`,
    ),
    'import source from "./source.ts?raw"',
  ].map((code) => ({ code, errors: [{ messageId: "sourceText" }] })),
});

// Failure modes: every internal alias, both mock APIs, and Vitest's typed
// import form must be checked while external boundaries stay available.
tester.run("no-internal-mock", noInternalMock, {
  valid: [
    'vi.mock("obsidian")',
    'vi.mock("node:fs")',
    'vi.doMock("fs/promises")',
    'vi.mock("third-party")',
    'vi.spyOn(service, "read")',
    'other.mock("./module")',
  ],
  invalid: [
    'vi.mock("./module")',
    'vi.doMock("../module")',
    'vi.mock("#module")',
    'vi.mock("@/module")',
    'vi.mock("@zotlit/db")',
    'vi.mock(import("./module"))',
    'vi["doMock"](`@/module`)',
  ].map((code) => ({ code, errors: [{ messageId: "internalMock" }] })),
});

// Serialized page callbacks can use page globals and types, but no host bindings.
tester.run("no-eval-capture", noEvalCapture, {
  valid: [
    "readQueryViewUntil(id, 'JSON.stringify(1)', {ready: Boolean})",
    "readQueryViewUntil(id, ({page}, args) => page.revealQueryView(args.handle), {handle}, {ready: value => value !== null})",
    "obRun(id, ({app}, args) => app.vault.getFileByPath(args.path), {path})",
    "obRunUntil(id, () => document.readyState === 'complete', undefined, {what:'ready'})",
    "type Result = {value: string}; obRun(id, (): Result => ({value:'ok'}))",
    "import type { App } from 'obsidian'; obRun(id, ({app}) => { const typed: App = app; return typed.vault.getName(); })",
    "obRun(id, () => { const inner = () => 1; return inner(); })",
    "const cb = () => document.title; obRun(id, cb)",
    "obRun(id, () => { const listener = function () { return this.value; }; return listener.call({value: 1}); })",
    "obRun(id, () => { class Counter { #value = 1; read() { return this.#value; } } return new Counter().read(); })",
    "obRun(id, function recur(_, n) { return n > 0 ? recur(_, n - 1) : n; }, 2)",
  ],
  invalid: [
    {
      code: "const handle = {}; readQueryViewUntil(id, ({page}) => page.revealQueryView(handle), undefined, {ready: Boolean})",
      errors: [{ messageId: "capture" }],
    },
    {
      code: "const path = 'note'; obRun(id, ({app}) => app.vault.getFileByPath(path))",
      errors: [{ messageId: "capture" }],
    },
    {
      code: "import {helper} from './helper'; obRun(id, () => helper())",
      errors: [{ messageId: "capture" }],
    },
    {
      code: "const x = 1; const cb = () => x; obRun(id, cb)",
      errors: [{ messageId: "capture" }],
    },
    {
      code: "const x = 1; obRun(id, () => {const inner = () => x; return inner()})",
      errors: [{ messageId: "capture" }],
    },
    {
      code: "obRun(id, function () { return this.value })",
      errors: [{ messageId: "thisValue" }],
    },
    {
      code: "obRun(id, () => (() => this.value)())",
      errors: [{ messageId: "thisValue" }],
    },
    {
      code: "obRun(id, { callback() {return 1} }.callback)",
      errors: [{ messageId: "callback" }],
    },
  ],
});
