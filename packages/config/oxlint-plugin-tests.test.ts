import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import {
  noEvalCapture,
  noClassAssertion,
  noMarkupAssertion,
  noSourceText,
  noInternalMock,
  noTypedArgName,
  noPollAdapter,
  noPollWrapper,
  noGeneratedPollLabel,
  noStringTransport,
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
      code: "readQueryViewUntil(id, 'JSON.stringify(1)', {ready: Boolean})",
      errors: [{ messageId: "callback" }],
    },
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

// Readable page callbacks (#1873): role names, direct polls, typed values.
tester.run("no-typed-arg-name", noTypedArgName, {
  valid: [
    "obRun(id, ({app}, {attachmentPath}) => app.vault.getFileByPath(attachmentPath), {attachmentPath})",
    "const typedArguments = 1",
  ],
  invalid: [
    {
      code: "obRun(id, ({app}, {__typedArg0}) => app.vault.getFileByPath(__typedArg0), {__typedArg0: path})",
      errors: [
        { messageId: "placeholder" },
        { messageId: "placeholder" },
        { messageId: "placeholder" },
        { messageId: "placeholder" },
      ],
    },
  ],
});

tester.run("no-poll-adapter", noPollAdapter, {
  valid: [
    "await obRunUntil(id, () => true, undefined, {what: 'ready'})",
    "promise.then(() => true)",
    "promise.then((value) => value, () => false)",
    "promise.then(() => false, () => true)",
    "promise.then(() => 1, () => 0)",
  ],
  invalid: [
    {
      code: "const done = await obRunUntil(id, cb, undefined, {what: 'x'}).then(() => true, () => false)",
      errors: [{ messageId: "adapter" }],
    },
    {
      code: "const done = poll().then(\n() => true,\n() => false,\n)",
      errors: [{ messageId: "adapter" }],
    },
  ],
});

tester.run("no-poll-wrapper", noPollWrapper, {
  valid: [
    "await obRunUntil(id, cb, undefined, {what: 'x', tries: 80})",
    "const finds = (query) => obRunUntil(id, cb, {query}, {what: 'x'})",
    "(() => { const value = obRunUntil(id, cb, undefined, {what: 'x'}); return value })()",
    "(() => other())()",
  ],
  invalid: [
    {
      code: "((options) => obRunUntil(id, cb, undefined, {ready: (v) => v === options.expected, what: 'x'}))({expected: 'true'})",
      errors: [{ messageId: "wrapper" }],
    },
    {
      code: "check(((options) => obRunUntil(id, cb, undefined, {what: 'x'}).then(() => true, () => false))({expected: 'true'}))",
      errors: [{ messageId: "wrapper" }],
    },
    {
      code: "(async () => await readQueryViewUntil(id, cb, args, {what: 'x'}))()",
      errors: [{ messageId: "wrapper" }],
    },
  ],
});

tester.run("no-generated-poll-label", noGeneratedPollLabel, {
  valid: [
    "obRunUntil(id, cb, undefined, {what: 'the card in the note embed'})",
    "const file = {name: 'paired-run.e2e.ts:12'}",
    "obRunUntil(id, cb, undefined, {what: 'section 1.2: the title'})",
  ],
  invalid: [
    {
      code: "obRunUntil(id, cb, undefined, {what: 'annotation-drag.ts:34'})",
      errors: [{ messageId: "label" }],
    },
    {
      code: "obRunUntil(id, cb, undefined, {what: 'paired-run.e2e.ts:6683', tries: 2})",
      errors: [{ messageId: "label" }],
    },
  ],
});

tester.run("no-string-transport", noStringTransport, {
  valid: [
    "String(count)",
    "String(value.toFixed(2))",
    "obRunUntil(id, cb, undefined, {what: 'x', ready: (value) => value === true})",
    "obRunUntil(id, () => el.getAttribute('aria-pressed'), undefined, {what: 'x', ready: (value) => value === 'false'})",
    "obRunUntil(id, cb, undefined, {what: 'x', ready: (value) => value === expected})",
    "expect(button.getAttribute('aria-pressed')).toBe('true')",
    "const open = el.ariaExpanded === 'true'",
  ],
  invalid: [
    { code: "String(String(flag))", errors: [{ messageId: "nested" }] },
    {
      code: "(() => String(String(!!el)))()",
      errors: [{ messageId: "nested" }],
    },
    {
      code: "obRunUntil(id, () => { return row ? 'true' : 'false' }, undefined, {what: 'x', ready: (value) => value === 'true'})",
      errors: [{ messageId: "boolean" }],
    },
    {
      code: "obRunUntil(id, () => { if (!row) return 'false'; return 'true' }, undefined, {ready: (value) => 'false' === value, what: 'x'})",
      errors: [{ messageId: "boolean" }],
    },
    {
      code: "obRunUntil(id, ({app}) => app.vault.adapter.exists(path).then(String), undefined, {what: 'x', ready: (value) => value === 'true'})",
      errors: [{ messageId: "boolean" }],
    },
  ],
});
