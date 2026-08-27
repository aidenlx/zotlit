import { describe, expect, it } from "vitest";

import {
  FRONTMATTER_ABSENT,
  FrontmatterJsonEError,
  renderJsonEFrontmatterValue,
} from "./frontmatter";

const OPERATION_TIMESTAMP = Temporal.Instant.from("2026-08-28T01:02:03Z");

function render(value: unknown, zt: Record<string, unknown> = {}): unknown {
  return renderJsonEFrontmatterValue(value, {
    key: "tags",
    zt,
    operationTimestamp: OPERATION_TIMESTAMP,
  });
}

function nestedArray(depth: number): unknown {
  let value: unknown = "leaf";
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
}

describe("Managed Frontmatter JSON-e values", () => {
  it.each([
    ["a generated value", { nested: [true, 42, "text"] }],
    ["an explicit null", null],
  ])("distinguishes %s", (_case, value) => {
    expect(render(value)).toEqual(value);
  });

  it("maps an omitted envelope property to the absent operation", () => {
    expect(render({ $if: "false" })).toBe(FRONTMATTER_ABSENT);
  });

  it.each([
    [
      "Monograph tag",
      [{ name: "Monograph" }],
      ["reference/book", "reference/book/monograph"],
    ],
    ["another tag", [{ name: "Reference" }], ["reference/book"]],
  ])("selects the #645 value for $case", (_case, tags, expected) => {
    expect(
      render(
        {
          $if: 'has(zt.tags, "name", "Monograph")',
          // oxlint-disable-next-line unicorn/no-thenable -- JSON-e names this conditional arm `then`.
          then: ["reference/book", "reference/book/monograph"],
          else: ["reference/book"],
        },
        { tags },
      ),
    ).toEqual(expected);
  });

  it("makes the #645 field absent when its condition is false", () => {
    expect(
      render(
        {
          $if: 'zt.itemType == "book"',
          // oxlint-disable-next-line unicorn/no-thenable -- JSON-e names this conditional arm `then`.
          then: "reference/book",
        },
        { itemType: "journalArticle" },
      ),
    ).toBe(FRONTMATTER_ABSENT);
  });

  it("pins now to the operation timestamp", () => {
    expect(render({ $eval: "now" })).toBe(OPERATION_TIMESTAMP.toString());
  });

  it("exposes the has host function", () => {
    expect(
      render(
        { $eval: 'has(zt.tags, "name", "Monograph")' },
        { tags: [{ name: "Monograph" }] },
      ),
    ).toBe(true);
    expect(() => render({ $eval: 'has("tags", "name", "Monograph")' })).toThrow(
      FrontmatterJsonEError,
    );
  });

  it("exposes the uniq host function", () => {
    expect(
      render({ $eval: "uniq(zt.values)" }, { values: [1, 1, "a", "a"] }),
    ).toEqual([1, "a"]);
    expect(() => render({ $eval: 'uniq("value")' })).toThrow(
      FrontmatterJsonEError,
    );
  });

  it("exposes the basename host function", () => {
    expect(
      render([
        { $eval: 'basename("folder/paper.md")' },
        { $eval: 'basename("folder/paper.txt", ".txt")' },
      ]),
    ).toEqual(["paper", "paper"]);
    expect(() => render({ $eval: "basename(42)" })).toThrow(
      FrontmatterJsonEError,
    );
  });

  it.each([
    ["a function", () => undefined],
    ["a non-finite number", Number.POSITIVE_INFINITY],
    ["a class instance", new (class InvalidValue {})()],
  ])("refuses $case and names the field", (_case, value) => {
    expect(() => render({ $eval: "zt.value" }, { value })).toThrowError(
      expect.objectContaining<Partial<FrontmatterJsonEError>>({
        key: "tags",
        message: expect.stringContaining("tags"),
        recovery: expect.any(String),
      }),
    );
  });

  it("refuses a cycle and names the field", () => {
    const value: unknown[] = [];
    value.push(value);

    expect(() => render({ $eval: "zt.value" }, { value })).toThrowError(
      expect.objectContaining<Partial<FrontmatterJsonEError>>({
        key: "tags",
        message: expect.stringContaining("tags"),
      }),
    );
  });

  it("allows depth 32 and refuses depth 33", () => {
    expect(render(nestedArray(32))).toEqual(nestedArray(32));
    expect(() => render(nestedArray(33))).toThrowError(
      expect.objectContaining<Partial<FrontmatterJsonEError>>({
        key: "tags",
        message: expect.stringContaining("tags"),
      }),
    );
  });

  it("wraps a JSON-e parse error with the field diagnostic", () => {
    expect(() => render({ $eval: "(" })).toThrowError(
      expect.objectContaining<Partial<FrontmatterJsonEError>>({
        key: "tags",
        message: expect.stringContaining("tags"),
        recovery: expect.any(String),
      }),
    );
  });
});
