import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  activeProfileEditor,
  openProfileExplorer,
} from "@/views/note-preview/register";
import type { ProfileEditorView } from "@/views/profile-editor/view";

import { openTemplateDataExplorer } from "./register";

vi.mock("@/views/note-preview/register", () => ({
  activeProfileEditor: vi.fn(),
  openProfileExplorer: vi.fn(async () => {}),
}));
vi.mock("./view", () => ({
  EXPLORER_VIEW_TYPE: "zotlit-template-data-explorer",
  TemplateDataExplorerView: class {},
}));

describe("Explorer entry point", () => {
  it("reopens fields beside the active workbench editor instead of selecting another window", async () => {
    const editor = { isWorkbenchWindow: true } as ProfileEditorView;
    vi.mocked(activeProfileEditor).mockReturnValue(editor);
    const getLeavesOfType = vi.fn();
    const getRightLeaf = vi.fn();
    const app = {
      workspace: { getLeavesOfType, getRightLeaf },
    } as unknown as App;
    await openTemplateDataExplorer(app);
    expect(openProfileExplorer).toHaveBeenCalledWith(app, editor);
    expect(getLeavesOfType).not.toHaveBeenCalled();
    expect(getRightLeaf).not.toHaveBeenCalled();
  });
});
