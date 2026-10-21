import { join } from "node:path";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { annotationDesign, workbenchChrome } from "./oxlint-plugin-design.ts";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});
const chrome = [{ messageId: "chrome" }];
// Failure modes: kit bypasses, default/dynamic/oversized controls, nested class
// expressions and variants, physical directions, and the content exemption.
tester.run("workbench-chrome", workbenchChrome, {
  valid: [
    'import { Popover } from "@/components/ui/popover"',
    '<Button size="xs" className="ms-2" />',
    '<Button size={"icon-2xs"} />',
    '<Input size="xs" />',
    '<div className={cn("text-xs", active && "text-end")} />',
    {
      filename: "/workbench/reading-view.tsx",
      code: '<article className="text-[12px] uppercase" />',
    },
    'const text = "uppercase ml-2"; <div title="content" />',
  ],
  invalid: [
    'import { Popover } from "@base-ui/react/popover"',
    "<Popover.Close />",
    "<PopoverClose />",
    "<Button />",
    '<Button size="lg" />',
    "<Button size={chosen} />",
    '<Button size="xs" className="h-8" />',
    '<Button size="xs" className={cn("hover:px-2")} />',
    '<Button size="xs" className="[&_svg]:size-3" />',
    ...["Input", "NativeSelect", "Textarea", "DropdownMenuContent"].map(
      (name) => `<${name} size="sm" />`,
    ),
    '<div className="hover:ml-2" />',
    '<div className={active ? "text-left" : "text-start"} />',
    "<div className={`text-[12px] ${other}`} />",
    '<div className="uppercase" />',
    {
      filename: "/workbench/reading-view.tsx",
      code: '<article className="mr-2" />',
      errors: chrome,
    },
  ].map((test) =>
    typeof test === "string" ? { code: test, errors: chrome } : test,
  ),
});

const design = [{ messageId: "design" }];
// Failure modes: each Annotation authoring constraint, per-element clamp
// pairing, and CSS comments/selectors/strings versus actual declarations.
tester.run("annotation-view", annotationDesign, {
  valid: [
    '<div className="zt:ms-2 zt:text-xs zt:line-clamp-2 zt:leading-normal" aria-label="Open" />',
    '<><div className="zt:line-clamp-2" /><div className="zt:leading-tight" /></>',
    'el.setAttribute("aria-label", "Open")',
    {
      filename: join(import.meta.dirname, "__fixtures__/design/register.ts"),
      code: 'import "./valid.css"',
    },
  ],
  invalid: [
    '<div className="zt:hover:pl-2" />',
    '<div className="zt:text-right" />',
    '<div className="zt:text-[10px]" />',
    '<div className="zt:uppercase" />',
    "<div title={label} />",
    'el.setAttribute("title", label)',
    '<div className="zt:md:columns-2" />',
    '<div className="zt:transition-all" />',
    '<div className={cn("zt:line-clamp-3", active && "zt:leading-none")} />',
    '<div className="zt:line-clamp-2 zt:leading-tight" />',
    {
      filename: join(import.meta.dirname, "__fixtures__/design/register.ts"),
      code: 'import "./invalid.css"',
      errors: Array.from({ length: 8 }, () => ({ messageId: "design" })),
    },
  ].map((test) =>
    typeof test === "string" ? { code: test, errors: design } : test,
  ),
});
