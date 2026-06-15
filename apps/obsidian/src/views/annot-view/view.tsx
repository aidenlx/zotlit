import { createStore, Provider } from "jotai";
import { ItemView, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import * as m from "@/paraglide/messages";

import { AnnotView } from "./AnnotView";
import { mockAnnotations, mockAttachments, mockDoc, mockTags } from "./mock";
import {
  allAttachmentsAtom,
  annotationsAtom,
  docAtom,
  tagsAtom,
} from "./store";

export const ANNOT_VIEW_TYPE = "zotero-annotation-view";

export class AnnotationView extends ItemView {
  // Per-instance jotai store keeps each leaf's state isolated; module-scope
  // atoms hold the keys, this store holds the values.
  readonly #store = createStore();
  #root: Root | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    // Stage 8 replaces this seed with live DB queries reacting to the active
    // file / Zotero reader; for now the view renders fixed mock data.
    this.#store.set(docAtom, mockDoc);
    this.#store.set(allAttachmentsAtom, mockAttachments);
    this.#store.set(annotationsAtom, mockAnnotations);
    this.#store.set(tagsAtom, mockTags);
  }

  override getViewType(): string {
    return ANNOT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return m.annot_view_name();
  }

  override getIcon(): string {
    return "highlighter";
  }

  protected override async onOpen(): Promise<void> {
    // Scope Tailwind's preflight to this view's DOM (see `.zt-root` in zt-main.css).
    this.contentEl.classList.add("zt-root");
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <Provider store={this.#store}>
        <AnnotView />
      </Provider>,
    );
  }

  protected override async onClose(): Promise<void> {
    this.#root?.unmount();
    this.#root = null;
  }
}
