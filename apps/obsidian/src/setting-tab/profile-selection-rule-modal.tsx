// One Profile Selection Rule editor: Library scope, grouped item-type,
// Collection, and Tag conditions, and the target Profile. The stored Filter
// Expression is the one source; the visual editor and the expression editor
// are two surfaces over it. This is the modal shell; the editor itself is the
// React tree under `profile-selection-rule/`.
import { customAlphabet } from "nanoid";
import { Modal } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import * as m from "@/lib/i18n/generated/messages";
import { listCollectionChoices } from "@/services/profile-selection";
import type {
  CollectionChoice,
  ProfileSelectionRule,
} from "@/services/profile-selection";

import type { SettingTabContext } from "./context";
import type { RuleEditorDeps } from "./profile-selection-rule/draft";
import { RuleEditor } from "./profile-selection-rule/RuleEditor";
import {
  createRuleEditorStore,
  RuleEditorStoreProvider,
} from "./profile-selection-rule/store";
import type { RuleEditorStore } from "./profile-selection-rule/store";

const mintId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);

/**
 * Open the rule editor. Resolves the edited (or newly created) rule, or
 * `undefined` when the dialog is cancelled.
 */
export function editProfileSelectionRule(
  ctx: SettingTabContext,
  rule?: ProfileSelectionRule,
): Promise<ProfileSelectionRule | undefined> {
  const modal = new ProfileSelectionRuleModal(ctx, rule);
  modal.open();
  return modal.result;
}

export class ProfileSelectionRuleModal extends Modal {
  readonly #rule: ProfileSelectionRule | undefined;
  readonly #store: RuleEditorStore;
  readonly #decision = Promise.withResolvers<
    ProfileSelectionRule | undefined
  >();
  readonly result = this.#decision.promise;
  #root: Root | null = null;
  #footer: HTMLElement | null = null;

  constructor(ctx: SettingTabContext, rule?: ProfileSelectionRule) {
    super(ctx.app);
    this.#rule = rule;
    this.#store = createRuleEditorStore(editorDeps(ctx), rule);
  }

  override onOpen(): void {
    // Obsidian's scrollable layout: the title and the button container stay
    // put while the content between them scrolls.
    this.modalEl.classList.add("mod-scrollable-content");
    this.contentEl.classList.add("zt-root");
    this.setTitle(
      this.#rule
        ? m.settings_profile_rule_title_edit()
        : m.settings_profile_rule_title_new(),
    );
    const footer = document.createElement("div");
    footer.className = "modal-button-container zt-root";
    this.modalEl.append(footer);
    this.#footer = footer;
    this.#root = createRoot(this.contentEl);
    this.#root.render(
      <RuleEditorStoreProvider value={this.#store}>
        <RuleEditor
          footer={footer}
          onSave={(draft) => {
            this.#decision.resolve({
              id: this.#rule?.id ?? mintId(),
              scope: draft.scope,
              expression: draft.expression,
              profile: draft.profile,
            });
            this.close();
          }}
          onCancel={() => {
            this.#decision.resolve(undefined);
            this.close();
          }}
        />
      </RuleEditorStoreProvider>,
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

/** What the editor reads from the plugin, captured once when the dialog opens. */
function editorDeps(ctx: SettingTabContext): RuleEditorDeps {
  return {
    profiles: [
      { id: "default", label: m.settings_profile_default_name() },
      ...ctx.profile.profiles.map(({ id, label }) => ({ id, label })),
    ],
    libraries: ctx.libraryScope.libraries,
    collections: availableCollections(ctx),
  };
}

/** Every Collection of every available Library; none while the database is unreadable. */
function availableCollections(ctx: SettingTabContext): CollectionChoice[] {
  if (ctx.db.state !== "ready") return [];
  return listCollectionChoices(ctx.db.client, ctx.libraryScope.libraries);
}
