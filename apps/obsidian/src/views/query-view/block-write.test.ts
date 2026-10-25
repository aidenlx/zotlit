import type { MarkdownPostProcessorContext } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { createObsidianHost } from "@/lib/__fixtures__/obsidian-host";

import { openTextFileView } from "./__fixtures__/open-text-view";
import { writeBlockCode } from "./block-write";

const PATH = "literatures/Paper.md";
const OLD = "views:\n  - type: annotations\n    name: All";
const NEW = "views:\n  - type: annotations\n    name: All\n    sort: []";
const NOTE = `---\nzotero-key: ABCD2345\n---\n# Paper\n\n\`\`\`zotquery\n${OLD}\n\`\`\`\n\nAfter the block.\n`;

/** The block's lines in {@link NOTE}: the fence opens on line 5 and closes on line 9. */
function context(
  text: string | null,
  extra: Partial<MarkdownPostProcessorContext> = {},
): MarkdownPostProcessorContext {
  return {
    docId: "doc",
    sourcePath: PATH,
    frontmatter: {},
    addChild: vi.fn(),
    getSectionInfo: () =>
      text === null ? null : { text, lineStart: 5, lineEnd: 9 },
    ...extra,
  };
}

const el = {} as HTMLElement;
const EDIT = { previous: OLD, next: NEW };

describe("writeBlockCode", () => {
  it("hands the new code to the context's own replaceCode", async () => {
    const host = createObsidianHost({ [PATH]: NOTE });
    const replaceCode = vi.fn();
    await writeBlockCode(
      host.app,
      { ctx: context(NOTE, { replaceCode }), el },
      EDIT,
    );
    expect(replaceCode).toHaveBeenCalledWith(NEW);
    expect(host.text(PATH)).toBe(NOTE);
  });

  it("without replaceCode, rewrites only the block text in the note", async () => {
    const host = createObsidianHost({ [PATH]: NOTE });
    await writeBlockCode(host.app, { ctx: context(NOTE), el }, EDIT);
    expect(host.text(PATH)).toBe(NOTE.replace(OLD, NEW));
  });

  it("without replaceCode, rewrites the open note's unsaved text", async () => {
    const host = createObsidianHost({ [PATH]: NOTE });
    const view = openTextFileView(host, host.file(PATH));
    const typed = `${NOTE}Typed below.\n`;
    view.edit(typed);
    await writeBlockCode(host.app, { ctx: context(typed), el }, EDIT);
    expect(view.getViewData()).toBe(typed.replace(OLD, NEW));
    expect(host.text(PATH)).toBe(typed.replace(OLD, NEW));
  });

  it("without replaceCode, refuses when the block text changed since it rendered", async () => {
    const host = createObsidianHost({
      [PATH]: NOTE.replace("name: All", "name: Mine"),
    });
    await expect(
      writeBlockCode(host.app, { ctx: context(NOTE), el }, EDIT),
    ).rejects.toThrow();
    expect(host.text(PATH)).toBe(NOTE.replace("name: All", "name: Mine"));
  });

  it("without replaceCode, refuses when lines above the block moved it", async () => {
    const moved = NOTE.replace("# Paper\n", "# Paper\nA new line.\n");
    const host = createObsidianHost({ [PATH]: moved });
    await expect(
      writeBlockCode(host.app, { ctx: context(NOTE), el }, EDIT),
    ).rejects.toThrow();
    expect(host.text(PATH)).toBe(moved);
  });

  it("refuses where the block has no place in a note", async () => {
    const host = createObsidianHost({ [PATH]: NOTE });
    const replaceCode = vi.fn();
    await expect(
      writeBlockCode(
        host.app,
        { ctx: context(null, { replaceCode }), el },
        EDIT,
      ),
    ).rejects.toThrow();
    expect(replaceCode).not.toHaveBeenCalled();
    expect(host.text(PATH)).toBe(NOTE);
  });
});
