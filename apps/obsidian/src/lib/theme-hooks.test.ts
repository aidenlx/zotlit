// The hooks the Preact surfaces promise, held to their literal names.
//
// The Annotation View is React, and components are not mounted in tests, so
// what a test can hold is the name itself: a rename of a registry key is free,
// a rename of the class a theme selects on is not.
//
// @see apps/obsidian/policies/theme-hooks.md
import { expect, it } from "vitest";

import { themeAttribute, themeHook } from "./theme-hooks";

it("promises the Annotation View hooks by literal name", () => {
  expect({
    conflict: themeHook.annotConflict,
    draft: themeHook.annotDraft,
  }).toEqual({
    conflict: "zt-annot-conflict",
    draft: "zt-annot-draft",
  });
});

it("promises the Chooser hooks by literal name", () => {
  expect({
    popup: themeHook.chooser,
    trigger: themeHook.chooserTrigger,
  }).toEqual({
    popup: "zt-chooser",
    trigger: "zt-chooser-trigger",
  });
});

it("promises the PDF reader's mode attributes by literal name", () => {
  expect({ inking: themeAttribute.pdfInking }).toEqual({
    inking: "data-zt-inking",
  });
});
