import { describe, expect, it, vi } from "vitest";

import { createObsidianHost } from "./__fixtures__/obsidian-host";
import {
  processLiveFrontMatter,
  processLiveText,
  readLiveText,
} from "./live-text";

const PATH = "Notes/Paper.md";

describe("processLiveFrontMatter", () => {
  it.each([
    {
      name: "keeps the body and each fence's line ending",
      text: "---\r\nzotero-key: ABCD2345\n---\r\nBody\r\n",
      edit: (fm: Record<string, unknown>) => {
        fm["zotlit-profile"] = "Books";
      },
      written:
        "---\r\nzotero-key: ABCD2345\nzotlit-profile: Books\n---\r\nBody\r\n",
    },
    {
      name: "removes a Properties block left empty",
      text: "---\nzotlit-profile: Books\n---\nBody",
      edit: (fm: Record<string, unknown>) => {
        delete fm["zotlit-profile"];
      },
      written: "Body",
    },
    {
      name: "adds a Properties block to a note without one",
      text: "Body",
      edit: (fm: Record<string, unknown>) => {
        fm["zotlit-profile"] = "Books";
      },
      written: "---\nzotlit-profile: Books\n---\nBody",
    },
  ])("$name", async ({ text, edit, written }) => {
    const host = createObsidianHost({ [PATH]: text });
    await processLiveFrontMatter(host.app, host.file(PATH), edit);
    expect(host.text(PATH)).toBe(written);
  });
});

describe("processLiveText", () => {
  it("rewrites a note no view has open on disk", async () => {
    const host = createObsidianHost({ [PATH]: "Old" });

    await processLiveText(host.app, host.file(PATH), (text) => `${text} new`);

    expect(host.text(PATH)).toBe("Old new");
  });

  it("rewrites an open note's unsaved text and saves it", async () => {
    const host = createObsidianHost({ [PATH]: "Saved" });
    const view = host.openInEditor(host.file(PATH));
    view.edit("Typed");

    await processLiveText(host.app, host.file(PATH), (text) => `${text} new`);

    expect(host.text(PATH)).toBe("Typed new");
    expect(view.getViewData()).toBe("Typed new");
  });

  it("keeps a rewrite that lands while the editor's own save is in progress", async () => {
    const host = createObsidianHost({ [PATH]: "Saved" });
    const view = host.openInEditor(host.file(PATH));
    view.edit("Typed");
    host.saves.hold();
    const editorSave = view.save();

    await processLiveText(host.app, host.file(PATH), (text) => `${text} new`);
    await host.saves.release();
    await editorSave;

    expect(host.text(PATH)).toBe("Typed new");
  });

  it("writes through the vault when the view keeps other text, and the view reloads it", async () => {
    const host = createObsidianHost({ [PATH]: "Old\n" });
    const view = host.openInEditor(host.file(PATH), { lineEndings: "lf" });
    const save = vi.spyOn(view, "save");

    await processLiveText(host.app, host.file(PATH), () => "New\r\n");

    expect(host.text(PATH)).toBe("New\r\n");
    expect(save).not.toHaveBeenCalled();
    // A view left holding the refused text has unsaved edits, and ignores the
    // disk change it would later overwrite.
    expect(view.lastSavedData).toBe("New\r\n");
  });
});

describe("readLiveText", () => {
  it("reads an open note's unsaved text", async () => {
    const host = createObsidianHost({ [PATH]: "Saved" });
    host.openInEditor(host.file(PATH)).edit("Typed");

    expect(await readLiveText(host.app, host.file(PATH))).toBe("Typed");
  });

  it("reads a note no view has open from disk", async () => {
    const host = createObsidianHost({ [PATH]: "Saved" });

    expect(await readLiveText(host.app, host.file(PATH))).toBe("Saved");
  });
});
