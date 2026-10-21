import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import {
  noClassAssertion,
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
