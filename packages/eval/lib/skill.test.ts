import { describe, expect, test } from "vitest";

import { parseSkillMd } from "#skill";

describe("parseSkillMd", () => {
  test("reads an inline name and description", () => {
    const content = [
      "---",
      "name: zotlit-template",
      "description: Author ZotLit templates. Use when editing a Profile.",
      "---",
      "",
      "# Body",
    ].join("\n");

    expect(parseSkillMd(content)).toEqual({
      name: "zotlit-template",
      description: "Author ZotLit templates. Use when editing a Profile.",
    });
  });

  test("folds a block scalar description onto one line", () => {
    const content = [
      "---",
      "name: zotlit-pandoc",
      "description: >",
      "  Set up the native Pandoc workflow.",
      "  Use when exporting a note.",
      "---",
    ].join("\n");

    expect(parseSkillMd(content).description).toBe(
      "Set up the native Pandoc workflow. Use when exporting a note.",
    );
  });

  test("strips surrounding quotes", () => {
    const content = [
      "---",
      'name: "quoted-name"',
      "description: 'single quoted'",
      "---",
    ].join("\n");

    expect(parseSkillMd(content)).toEqual({
      name: "quoted-name",
      description: "single quoted",
    });
  });

  test("rejects a file without frontmatter", () => {
    expect(() => parseSkillMd("# No frontmatter")).toThrow(/opening/);
  });

  test("rejects unterminated frontmatter", () => {
    expect(() => parseSkillMd("---\nname: x\n")).toThrow(/closing/);
  });
});
