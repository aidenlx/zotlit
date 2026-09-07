// The active editor's result, shown as native Markdown in an independently owned leaf.
import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useStore } from "zustand";

import { profileSourceRevision } from "@zotlit/workbench/render";
import {
  PreviewControls,
  ResultColumn,
  PropertiesResult,
  useWorkbenchStore,
  useDocumentRevision,
} from "@zotlit/workbench/ui";

import * as m from "@/lib/i18n/generated/messages";
import { openSettingsTab } from "@/lib/open-settings";
import type { ProfileEditorView } from "@/views/profile-editor/view";

import { PreviewAnnotationSelection } from "./annotation-selection";
import { subscribeActiveProfileEditor } from "./register";

export const NOTE_PREVIEW_VIEW_TYPE = "zotlit-note-preview";
export class NotePreviewView extends ItemView {
  readonly #pluginId: string;
  #root: Root | null = null;
  constructor(leaf: WorkspaceLeaf, pluginId: string) {
    super(leaf);
    this.#pluginId = pluginId;
    this.contentEl.addClass("zt-root");
  }
  override getViewType(): string {
    return NOTE_PREVIEW_VIEW_TYPE;
  }
  override getDisplayText(): string {
    return m.profile_preview_name();
  }
  override getIcon(): string {
    return "eye";
  }
  protected override async onOpen(): Promise<void> {
    this.#root = createRoot(this.contentEl);
    this.register(
      subscribeActiveProfileEditor(this.app, (editor) => {
        this.#root?.render(
          editor?.preview ? (
            editor.provide(<PreviewContent editor={editor} />)
          ) : (
            <div className="zt:flex zt:flex-col zt:gap-3 zt:p-3">
              <p>{m.profile_preview_empty()}</p>
              <button
                onClick={() =>
                  openSettingsTab(this.app, this.#pluginId, [
                    m.settings_page_profiles(),
                  ])
                }
              >
                {m.settings_page_profiles()}
              </button>
            </div>
          ),
        );
      }),
    );
  }
  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
  }
}
function PreviewContent({ editor }: { editor: ProfileEditorView }) {
  const preview = editor.preview!;
  const { result, busy } = useStore(preview.state, (state) => state);
  const root = useWorkbenchStore((state) => state.root);
  const tab = useWorkbenchStore((state) => state.tab);
  const mode = useWorkbenchStore((state) => state.preview.mode);
  const advanced = useWorkbenchStore((state) => state.advanced);
  useDocumentRevision(editor.controller);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showManaged, setShowManaged] = useState(false);
  return (
    <div className="zt:flex zt:flex-col zt:gap-3 zt:p-3">
      <PreviewControls
        busy={busy}
        onRun={() =>
          void editor.ensureItem().then((ready) => {
            if (ready) void preview.run();
          })
        }
        onStop={() => preview.pause()}
      />
      <PreviewAnnotationSelection session={preview} />
      <ResultColumn
        result={result}
        annotationResult={result}
        mode={
          root === "annotation"
            ? "annotation"
            : !advanced && tab === "properties"
              ? "properties"
              : "note"
        }
        stale={
          result !== null &&
          (result.sourceRevision !==
            profileSourceRevision(editor.controller.source) ||
            result.previewMode !== mode)
        }
        showMarkdown={showMarkdown}
        onShowMarkdown={setShowMarkdown}
        showManaged={showManaged}
        onShowManaged={setShowManaged}
        openAnnotation={() => editor.revealSlice("annotation")}
        goToEntry={(position) => editor.revealSlice(`entry:${position}`)}
        openSource={() => editor.revealSlice("advanced")}
        propertiesResult={
          result && (
            <PropertiesResult
              entries={editor.controller.managedEntries ?? []}
              properties={result.properties}
              fold={result.fold}
              frontmatterBlock={result.frontmatterBlock}
              showMarkdown={showMarkdown}
            />
          )
        }
      />
    </div>
  );
}
