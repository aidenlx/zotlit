import { expect, it } from "vitest";

import { classifyAnnotationLink } from "./annotation-link";

it("classifies an empty link by its Annotation Indexed Key", () => {
  expect(
    classifyAnnotationLink(
      "zotero://open/groups/42/items/ABCD2345?annotation=EFGH6789&page=iv",
      { kind: "link", text: "" },
    ),
  ).toEqual({
    form: "citation",
    indexedKey: "EFGH6789g42",
    attachmentKey: "ABCD2345",
    pageLabel: "iv",
  });
});

it.each([
  [{ kind: "link", text: "p. 4" }, "labelled"],
  [{ kind: "link", text: " \t" }, "labelled"],
  [{ kind: "autolink" }, "labelled"],
  [{ kind: "image" }, "embed"],
] as const)("classifies %j as %s", (shape, form) => {
  expect(
    classifyAnnotationLink(
      "zotero://open/library/items/ABCD2345?annotation=EFGH6789",
      shape,
    ),
  ).toEqual({
    form,
    indexedKey: "EFGH6789",
    attachmentKey: "ABCD2345",
    pageLabel: null,
  });
});

it.each([
  "zotero://open/library/items/ABCD2345",
  "zotero://open/library/items/ABCD2345?annotation=bad",
  "zotero://open/groups/0/items/ABCD2345?annotation=EFGH6789",
])("records only the empty-text malformed citation: %s", (destination) => {
  expect(
    classifyAnnotationLink(destination, { kind: "link", text: "" }),
  ).toEqual({ form: "malformed", destination });
  expect(
    classifyAnnotationLink(destination, { kind: "link", text: " " }),
  ).toBeNull();
  expect(classifyAnnotationLink(destination, { kind: "autolink" })).toBeNull();
  expect(classifyAnnotationLink(destination, { kind: "image" })).toBeNull();
});

it.each([
  "file:///paper.pdf#zt-annotation=EFGH6789",
  "zotero://select/library/items/ABCD2345",
  "not a URL",
])("drops unrelated destinations: %s", (destination) => {
  expect(
    classifyAnnotationLink(destination, { kind: "link", text: "" }),
  ).toBeNull();
});
