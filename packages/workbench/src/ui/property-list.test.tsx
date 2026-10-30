import type { RenderedProperty } from "#/render/result";
import { screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { PropertyList, propertyType } from "./property-list";
import { mount, renderWithMessages as render } from "./test-host";

const property = (
  key: string,
  value: unknown,
  position = 1,
): RenderedProperty => ({ key, value, missing: false, position });

it("infers the type Obsidian's editor would assign each property", () => {
  expect(propertyType(property("title", "A study"))).toBe("text");
  expect(propertyType(property("authors", ["Ada", "Grace"]))).toBe("list");
  expect(propertyType(property("tags", ["reading"]))).toBe("tags");
  expect(propertyType(property("aliases", "study"))).toBe("aliases");
  expect(propertyType(property("year", 2021))).toBe("number");
  expect(propertyType(property("read", false))).toBe("checkbox");
  expect(propertyType(property("added", "2021-03-09"))).toBe("date");
  expect(propertyType(property("modified", "2021-03-09T08:30"))).toBe(
    "datetime",
  );
  expect(propertyType(property("note", "2021-03-09 draft"))).toBe("text");
  expect(propertyType({ key: "doi", missing: true, position: 2 })).toBe("text");
});

it("renders one typed row per property, with its type's icon on the key", () => {
  using mounted = mount(
    <PropertyList
      label="Properties"
      properties={[
        property("title", "A study", 1),
        property("tags", ["reading", "todo"], 2),
        property("read", true, 3),
        property("year", 2021, 4),
      ]}
    />,
  );
  render(mounted.ui);
  const list = screen.getByLabelText("Properties");
  expect(list.tagName).toBe("DL");
  const rows = [...list.querySelectorAll("[data-part=row]")];
  expect(rows.map((row) => row.getAttribute("data-state"))).toEqual([
    "text",
    "tags",
    "checkbox",
    "number",
  ]);
  expect(
    rows.map((row) =>
      row.querySelector("[data-icon]")?.getAttribute("data-icon"),
    ),
  ).toEqual([
    "property-text",
    "property-tags",
    "property-checkbox",
    "property-number",
  ]);
  const pills = rows[1]!.querySelectorAll("[data-part=pill]");
  expect([...pills].map((pill) => pill.textContent)).toEqual([
    "reading",
    "todo",
  ]);
  const checkbox = screen.getByRole("checkbox");
  expect(checkbox).toHaveProperty("checked", true);
  expect(checkbox.getAttribute("aria-readonly")).toBe("true");
  expect(rows[3]!.querySelector("[data-part=value]")?.textContent).toBe("2021");
});
