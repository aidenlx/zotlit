import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { noLayerCheck } from "./oxlint-plugin-keyboard.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});

const layerCheck = [{ messageId: "layerCheck" }];

tester.run("no-layer-check", noLayerCheck, {
  valid: [
    // The target's own control, not another layer.
    '<div onKeyDown={(e) => { if (e.target.closest("input, textarea, [contenteditable], .cm-editor")) return; }} />',
    '<div onKeyDown={(e) => { if (e.target.closest(\'[role="listbox"], [role="combobox"]\')) return; }} />',
    "<div onKeyDown={(e) => { if (inTextEntry(e.target)) return; }} />",
    // Outside a key handler.
    'const parent = dom.closest("[popover]") ?? dom.ownerDocument.body;',
    '<div onClick={(e) => e.target.closest(".menu")} />',
    'el.addEventListener("focusout", (e) => e.relatedTarget?.closest(".modal-container"));',
    "this.register(() => el.querySelector('.menu')?.remove());",
    // A selector the rule cannot read.
    "<div onKeyDown={(e) => e.target.closest(selectorFor(e))} />",
  ],
  invalid: [
    {
      code: '<section onKeyDown={(event) => { if ((event.target as Element).closest("[popover]")) return; }} />',
      errors: layerCheck,
    },
    {
      code: 'el.addEventListener("keydown", (e) => { if (e.target.matches(":popover-open")) return; });',
      errors: layerCheck,
    },
    {
      code: 'registerDomEvent(el, "keyup", function (e) { if (el.querySelector(\'[aria-expanded="true"]\')) return; });',
      errors: layerCheck,
    },
    {
      code: 'scope.register(["Mod"], "Z", () => { if (doc.querySelector(".suggestion-container")) return; });',
      errors: layerCheck,
    },
    {
      code: 'registerKeymap(scope, [], "Escape", (e) => { if (e.target.closest(".modal, .menu")) return; });',
      errors: layerCheck,
    },
    {
      code: 'registerKeymap(scope, [], "Enter", (e) => { const open = items.some((el) => el.hasClass("has-active-menu")); });',
      errors: layerCheck,
    },
    {
      code: '<div onKeyDown={(e) => { if (trigger.classList.contains("is-open")) return; }} />',
      errors: layerCheck,
    },
    {
      code: '<div onKeyUp={(e) => { if (e.target.getAttribute("aria-haspopup")) return; }} />',
      errors: layerCheck,
    },
    {
      code: 'const OWN_KEYS = \'button, [role="menu"], [role="menuitem"]\';\nscope.register([], "Enter", (e) => { if (e.target.closest(OWN_KEYS)) return; });',
      errors: layerCheck,
    },
    {
      code: "const MENU = 'menuitem';\nscope.register([], 'Enter', (e) => e.target.closest(`[role=\"${MENU}\"]`));",
      errors: layerCheck,
    },
  ],
});
