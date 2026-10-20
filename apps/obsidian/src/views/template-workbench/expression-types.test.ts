import { expect, it } from "vitest";

import { ANNOTATIONS, ITEMS } from "@zotlit/item-query";

import { expressionTypes } from "./expression-types";

it("types a receiver as the Query Dataset's planner types it", () => {
  const items = expressionTypes(ITEMS);
  expect(items.receiverType?.("title")).toBe("string");
  expect(items.receiverType?.("tags")).toBe("list");
  expect(items.receiverType?.("dateAdded")).toBe("date");
});

it("leaves a receiver the planner cannot type untyped", () => {
  const items = expressionTypes(ITEMS);
  expect(items.receiverType?.("formula.missing")).toBeUndefined();
  expect(items.receiverType?.("title.")).toBeUndefined();
});

it("types a field of one Query Dataset by that dataset", () => {
  expect(expressionTypes(ANNOTATIONS).receiverType?.("text")).toBe("string");
});
