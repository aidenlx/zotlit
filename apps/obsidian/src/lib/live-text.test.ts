import { TextFileView, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { processLiveFrontMatter, processLiveText } from "./live-text";

/** A vault holding one note as `text`, and the views the workspace shows. */
function vaultWith(text: string, views: TextFileView[] = []) {
  const file = new TFile();
  file.path = "Notes/Paper.md";
  const state = { text };
  const app = {
    vault: {
      process: vi.fn(async (_file: TFile, fn: (data: string) => string) => {
        state.text = fn(state.text);
        return state.text;
      }),
    },
    workspace: {
      iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
        for (const view of views)
          callback({ view } as unknown as WorkspaceLeaf);
      },
    },
  };
  return { app, file, state };
}

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
    const vault = vaultWith(text);
    await processLiveFrontMatter(vault.app, vault.file, edit);
    expect(vault.state.text).toBe(written);
  });
});

/** A view that keeps its text with LF line endings, as CodeMirror does. */
class LineEndingView extends TextFileView {
  override getViewData(): string {
    return this.data;
  }
  override setViewData(data: string): void {
    this.data = data.replaceAll("\r\n", "\n");
  }
  override clear(): void {
    this.data = "";
  }
  override getViewType(): string {
    return "markdown";
  }
}

describe("processLiveText", () => {
  it("writes through the vault, and sets the view back, when the view keeps other text", async () => {
    const view = new LineEndingView({ app: {} } as never);
    const vault = vaultWith("Old\n", [view]);
    view.file = vault.file;
    view.lastSavedData = "Old\n";
    view.data = "Old\n";
    const save = vi.fn(async () => {});
    view.save = save;

    await processLiveText(vault.app, vault.file, () => "New\r\n");

    expect(vault.state.text).toBe("New\r\n");
    expect(view.getViewData()).toBe("Old\n");
    expect(save).not.toHaveBeenCalled();
  });
});
