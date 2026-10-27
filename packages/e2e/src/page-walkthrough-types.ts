import type {
  Editor,
  EditorPosition,
  FileSystemAdapter,
  MarkdownView,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

import type { SearchHit } from "@/services/item-lookup/service";
import type { ZotLitSettingTab } from "@/setting-tab";

import type { PageApp } from "./page-host.ts";

export interface WalkthroughViews {
  markdown: MarkdownView;
  "zotlit-cited-by": import("@/views/cited-by/view").CitedByView;
  "zotlit-template-workbench": import("@/views/template-workbench/view").TemplateWorkbenchView;
  "zotlit-template-data-explorer": import("@/views/template-data-explorer/view").TemplateDataExplorerView;
  "zotlit-note-preview": import("@/views/note-preview/view").NotePreviewView;
}
export type WalkthroughLeaf<K extends keyof WalkthroughViews> = Omit<
  WorkspaceLeaf,
  "view"
> & { view: WalkthroughViews[K] };
export type WalkthroughCitationSuggest =
  PageApp["workspace"]["editorSuggest"]["suggests"][number] & {
    isOpen: boolean;
    showSuggestions(suggestions: SearchHit[]): void;
  };
export interface WalkthroughEditorSuggest {
  trigger(editor: Editor, file: TFile, cursor: EditorPosition): void;
}
export type WalkthroughApp = PageApp & {
  internalPlugins: { plugins: { sync: { enabled: boolean } } };
  plugins: { plugins: { zotlit: { settingTab: ZotLitSettingTab } } };
  workspace: { editorSuggest: WalkthroughEditorSuggest };
  vault: {
    adapter: FileSystemAdapter;
    getConfig(key: "settingsPopoutWindow"): boolean;
    setConfig(key: "settingsPopoutWindow", value: boolean): void;
  };
};
export interface WalkthroughRemote {
  getCurrentWebContents(): {
    debugger: { sendCommand(method: string, params: object): Promise<unknown> };
  };
}
