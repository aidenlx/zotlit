// Modal shell for one document's Profile Match.
import { Modal } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";
import type { MatchTree } from "@zotlit/templates/facade";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import { listCollectionChoices } from "@/services/profile-selection";

import type { SettingTabContext } from "./context";
import { draftInvalid, toFilter } from "./profile-match/draft";
import type { MatchEditorDeps } from "./profile-match/draft";
import { MatchEditor } from "./profile-match/MatchEditor";
import {
  createMatchEditorStore,
  MatchEditorStoreProvider,
} from "./profile-match/store";
import type { MatchEditorStore } from "./profile-match/store";

export type MatchEdit =
  | { action: "save"; match: MatchTree }
  | { action: "remove"; match?: never };

export async function editProfileMatch(
  ctx: SettingTabContext,
  id: ProfileId,
): Promise<void> {
  const { manifest } = parseLiteratureNoteTemplate(
    await ctx.profile.getSource(id),
  );
  const modal = new ProfileMatchModal(ctx, {
    label: manifest.name,
    match: manifest.match,
  });
  modal.open();
  const edit = await modal.result;
  if (edit)
    await ctx.profile.setMatch(
      id,
      edit.action === "save" ? edit.match : undefined,
    );
}

export class ProfileMatchModal extends Modal {
  readonly #options: { label: string; match?: MatchTree };
  readonly #store: MatchEditorStore;
  readonly #decision = Promise.withResolvers<MatchEdit | undefined>();
  readonly result = this.#decision.promise;
  #root: Root | null = null;
  #footer: HTMLElement | null = null;

  constructor(
    ctx: SettingTabContext,
    options: { label: string; match?: MatchTree },
  ) {
    super(ctx.app);
    this.#options = options;
    this.#store = createMatchEditorStore(editorDeps(ctx), options.match);
  }

  override onOpen(): void {
    this.modalEl.classList.add(
      "mod-scrollable-content",
      "zt-profile-match-modal",
    );
    this.contentEl.classList.add("zt-root");
    this.setTitle(
      m.settings_profile_match_title({ profile: this.#options.label }),
    );
    const footer = document.createElement("div");
    footer.className = "modal-button-container zt-root zt-profile-match-footer";
    this.modalEl.append(footer);
    this.#footer = footer;
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <MatchEditorStoreProvider value={this.#store}>
        <MatchEditor
          footer={footer}
          onSave={() => {
            const { draft, deps } = this.#store.getState();
            if (draftInvalid(draft, deps)) return;
            this.#decision.resolve({
              action: "save",
              match: toFilter(draft.root),
            });
            this.close();
          }}
          onCancel={() => {
            this.#decision.resolve(undefined);
            this.close();
          }}
          onRemove={
            this.#options.match === undefined
              ? undefined
              : () => {
                  this.#decision.resolve({ action: "remove" });
                  this.close();
                }
          }
        />
      </MatchEditorStoreProvider>,
    );
  }

  override onClose(): void {
    this.#decision.resolve(undefined);
    this.#root?.unmount();
    this.#root = null;
    this.#footer?.remove();
    this.#footer = null;
    this.contentEl.replaceChildren();
  }
}

function editorDeps(ctx: SettingTabContext): MatchEditorDeps {
  return {
    libraries: ctx.libraryScope.libraries,
    collections:
      ctx.db.state === "ready"
        ? listCollectionChoices(ctx.db.client, ctx.libraryScope.libraries)
        : [],
  };
}
