// The Obsidian leaf adapter for the References model in the plugin's view registry.
import { ItemView } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { createRoot } from "react-dom/client";

import { writeClipboardRichText } from "@/lib/clipboard";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";

import {
  copyBibliographyMessage,
  createReferenceActions,
  ReferenceActionsContext,
} from "./actions";
import {
  dismissEngineHintCommand,
  openIndexedKeyCommand,
  openReferenceLinkCommand,
  revealReferenceOccurrenceCommand,
  referencesSelectionAtom,
} from "./atoms";
import {
  advanceOccurrence,
  holdReferencesModel,
  makeReferencesModel,
  ReferencesModelContext,
} from "./model";
import { References } from "./References";

export const REFERENCES_VIEW_TYPE = "zotlit-references";

export interface ReferencesViewDeps {
  registry: ViewRegistryHandle;
  app: App;
  /** Reveals the engine row in settings, where the install lives. */
  openSettings: () => void;
  /** Reveals the Citation and References Style row in settings. */
  openStyleSettings: () => void;
}

export class ReferencesView extends ItemView {
  readonly model = makeReferencesModel();
  readonly #deps;
  #release: (() => void) | null;
  #cleanup: DisposableStack | null = null;

  constructor(leaf: WorkspaceLeaf, deps: ReferencesViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.contentEl.addClass("zt-references-view");
    this.#deps = deps;
    this.#release = holdReferencesModel(deps.registry, this.model);
  }

  override getViewType(): string {
    return REFERENCES_VIEW_TYPE;
  }
  override getDisplayText(): string {
    return m.references_view_name();
  }
  override getIcon(): string {
    return "quote";
  }

  protected override async onOpen(): Promise<void> {
    using cleanup = new DisposableStack();
    const { registry, app } = this.#deps;
    this.#release ??= holdReferencesModel(registry, this.model);
    cleanup.defer(registry.mount(openIndexedKeyCommand));
    cleanup.defer(registry.mount(dismissEngineHintCommand));
    cleanup.defer(registry.mount(openReferenceLinkCommand));
    cleanup.defer(registry.mount(revealReferenceOccurrenceCommand));
    const actions = createReferenceActions({
      app,
      getSourcePath: () => registry.get(referencesSelectionAtom).path,
      openIndexedKey: (key) => registry.set(openIndexedKeyCommand, key),
      openLinkText: (linkpath, sourcePath) =>
        registry.set(openReferenceLinkCommand, { linkpath, sourcePath }),
      nextOccurrence: (id, count) => {
        registry.update(this.model.cursors, advanceOccurrence(id, count));
        return registry.get(this.model.cursors)[id]!;
      },
      revealOccurrence: (sourcePath, occurrence) =>
        registry.set(revealReferenceOccurrenceCommand, {
          sourcePath,
          occurrence,
        }),
      onOpenEngineSettings: this.#deps.openSettings,
      onChangeStyle: this.#deps.openStyleSettings,
      onDismissEngineHint: () =>
        registry.set(dismissEngineHintCommand, undefined),
      getCopySnapshot: () => registry.get(this.model.snapshot),
      writeClipboard: writeClipboardRichText,
      reportCopy: (outcome) =>
        void new BaseNotice(copyBibliographyMessage(outcome)),
    });
    // References has no saved layout fields; its title is fixed and its actions
    // read the current model. The registry owns their refresh with the leaf.
    cleanup.defer(
      registry.subscribe(this.model.state, () => this.leaf.updateHeader()),
    );
    const root = cleanup.adopt(createRoot(this.contentEl), (root) =>
      root.unmount(),
    );
    root.render(
      <ViewRegistryProvider registry={registry}>
        <ReferencesModelContext value={this.model}>
          <ReferenceActionsContext value={actions}>
            <References />
          </ReferenceActionsContext>
        </ReferencesModelContext>
      </ViewRegistryProvider>,
    );
    this.#cleanup = cleanup.move();
  }

  protected override async onClose(): Promise<void> {
    this.#cleanup?.dispose();
    this.#cleanup = null;
    this.#release?.();
    this.#release = null;
  }
}
