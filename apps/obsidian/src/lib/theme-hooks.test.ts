// The hooks the Preact surfaces promise, held to their literal names.
//
// The Annotation View and the menu chrome are React, and components are not
// mounted in tests, so what a test can hold is the name itself: a rename of a
// registry key is free, a rename of the class a theme selects on is not.
//
// @see apps/obsidian/policies/theme-hooks.md
import { expect, it } from "vitest";

import { themeHook } from "./theme-hooks";

it("promises the Annotation View and menu hooks by literal name", () => {
  expect({
    capability: themeHook.annotCapability,
    conflict: themeHook.annotConflict,
    menu: themeHook.menu,
  }).toEqual({
    capability: "zt-annot-capability",
    conflict: "zt-annot-conflict",
    menu: "zt-menu",
  });
});
