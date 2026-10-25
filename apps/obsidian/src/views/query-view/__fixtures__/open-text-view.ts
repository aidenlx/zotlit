import { TextFileView } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";

import type { ObsidianHost } from "@/lib/__fixtures__/obsidian-host";
import { stubService } from "@/lib/__fixtures__/service-stub";

class OpenTextView extends TextFileView {
  data = "";

  constructor(
    leaf: WorkspaceLeaf,
    readonly file: TFile,
    readonly host: ObsidianHost,
  ) {
    super(leaf);
    this.lastSavedData = host.text(file.path) ?? "";
    this.setViewData(this.lastSavedData);
  }

  edit(data: string): void {
    this.setViewData(data);
  }

  override getViewData(): string {
    return this.data;
  }

  override setViewData(data: string): void {
    this.data = data;
  }

  override clear(): void {
    this.data = "";
  }

  override getViewType(): string {
    return "markdown";
  }

  override save(): Promise<void> {
    return this.host.vault.modify(this.file, this.data);
  }
}

export function openTextFileView(
  host: ObsidianHost,
  file: TFile,
): OpenTextView {
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader() {},
  });
  Object.defineProperty(leaf, "app", { value: host.app });
  const view = new OpenTextView(leaf, file, host);
  leaf.view = view;
  Object.assign(host.workspace, {
    iterateAllLeaves(callback: (target: WorkspaceLeaf) => void) {
      callback(leaf);
    },
  });
  return view;
}
