// Both authoring panes remember the last Item in Obsidian's vault-local UI state.
import type { App } from "obsidian";

const KEY = "zotlit.template-item";

export function lastTemplateItem(app: App): string | null {
  const value: unknown = app.loadLocalStorage(KEY);
  return typeof value === "string" ? value : null;
}

export function rememberTemplateItem(app: App, indexedKey: string): void {
  app.saveLocalStorage(KEY, indexedKey);
}
