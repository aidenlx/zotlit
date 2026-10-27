import type { App, ExtendedHotkey, TFile, View } from "obsidian";

/** Host APIs used only by the End-to-end Run, outside the plugin's surface. */
export interface RenameListener {
  fn: (file: TFile, oldPath: string) => unknown;
}
export type PageApp = App & {
  plugins: App["plugins"] & {
    plugins: App["plugins"]["plugins"] & { zotlit?: { _loaded: boolean } };
    disablePlugin(id: string): Promise<void>;
    enablePlugin(id: string): Promise<void>;
  };
  hotkeyManager: App["hotkeyManager"] & {
    setHotkeys(id: string, hotkeys: ExtendedHotkey[]): void;
    removeHotkeys(id: string): void;
    save(): Promise<void>;
  };
  vault: App["vault"] & {
    _: { rename?: RenameListener[] };
    getConfig(key: "nativeMenus" | "settingsPopoutWindow"): boolean;
    setConfig(
      key: "nativeMenus" | "settingsPopoutWindow",
      value: boolean,
    ): void;
  };
};

export interface EmptyView extends View {
  actionListEl: HTMLElement;
}

declare global {
  interface Window {
    __ztRestoreBackgroundThrottling?: () => void;
  }
}
