// @vitest-environment happy-dom
import { MarkdownView } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { ProfileSelector } from "@/lib/profile-stamp";

import type { SettingTabContext } from "./context";
import { duplicateProfileToEditor } from "./duplicate-profile";

function handoff(source: string) {
  let selection: [number, number] | undefined;
  let focused = false;
  let opened = false;
  let closed = false;
  const view = Object.assign(Object.create(MarkdownView.prototype), {
    editor: {
      getValue: () => source,
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      setSelection: (from: { ch: number }, to: { ch: number }) => {
        selection = [from.ch, to.ch];
      },
      focus: () => {
        focused = true;
      },
    },
  });
  const file = { path: "templates/zotlit-profile.reading-copy.md" };
  const duplicate = vi.fn(async () => ({ path: file.path }));
  const ctx = {
    app: {
      setting: {
        close: () => {
          closed = true;
        },
      },
      vault: { getFileByPath: () => file },
      workspace: {
        getLeaf: () => ({
          view,
          openFile: async (
            openedFile: unknown,
            options: { state: unknown },
          ) => {
            expect(openedFile).toBe(file);
            expect(options.state).toEqual({ mode: "source", source: true });
            opened = true;
          },
        }),
      },
    },
    profile: { resolveProfile: () => ({ label: "Reading" }), duplicate },
  } as unknown as Pick<SettingTabContext, "app" | "profile">;
  return {
    ctx,
    duplicate,
    result: () => ({
      opened,
      closed,
      focused,
      selected: selection && source.slice(...selection),
    }),
  };
}

describe("Duplicate Profile editor handoff", () => {
  it.each([
    ["default", "Reading copy", "Reading copy"],
    ["Bk3Qn7XvT2Lp", '"Reading: copy"', '"Reading: copy"'],
  ])(
    "opens the copy from %s and selects only its manifest name",
    async (id, name, selected) => {
      const fixture = handoff(
        `---\nid: Jk6Lm8Np2Qr4\nname: ${name}\nversion: 1.0.0\n---\n# Keep this body\n`,
      );
      await duplicateProfileToEditor(fixture.ctx, id as ProfileSelector);
      expect(fixture.duplicate).toHaveBeenCalledWith(id);
      expect(fixture.result()).toEqual({
        opened: true,
        closed: true,
        focused: true,
        selected,
      });
    },
  );
});
