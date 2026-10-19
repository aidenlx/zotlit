import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { noClassAssertion } from "./oxlint-plugin-tests.ts";

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
