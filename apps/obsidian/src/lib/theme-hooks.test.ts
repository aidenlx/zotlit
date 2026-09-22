// The hooks the Preact surfaces promise, held to their literal names.
//
// The Annotation View is React, and components are not mounted in tests, so
// what a test can hold is the name itself: a rename of a registry key is free,
// a rename of the class a theme selects on is not.
//
// @see apps/obsidian/policies/theme-hooks.md
import { expect, it } from "vitest";

import { themeHook } from "./theme-hooks";

it("promises the Annotation View hooks by literal name", () => {
  expect({
    capability: themeHook.annotCapability,
    conflict: themeHook.annotConflict,
  }).toEqual({
    capability: "zt-annot-capability",
    conflict: "zt-annot-conflict",
  });
});

it("promises the Chooser hook by literal name", () => {
  expect(themeHook.chooser).toBe("zt-chooser");
});
