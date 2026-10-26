// Collect a second destination before committing its Profile document.
import { Modal, TextComponent } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type {
  LiteratureNoteProfile,
  PreparedProfileCreation,
  ProfileCreateOptions,
} from "@/services/profile/service";

import {
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  note,
} from "./profile-dialog";

/** What the destination dialog reads and runs while it is open. */
export interface ProfileDestinationDeps {
  app: App;
  /** The default Profile's note folder, which an empty folder falls back to. */
  defaultFolder: string;
  prepareCreate(
    options: ProfileCreateOptions,
  ): Promise<PreparedProfileCreation>;
}

export class ProfileDestinationModal extends Modal {
  readonly #deps;
  readonly #decision = Promise.withResolvers<
    LiteratureNoteProfile | undefined
  >();
  readonly result = this.#decision.promise;
  #revision = 0;
  #closed = false;
  #saving = false;

  constructor(deps: ProfileDestinationDeps) {
    super(deps.app);
    this.#deps = deps;
  }

  override onOpen(): void {
    frameDialog(this);
    this.setTitle(m.settings_profile_add());
    note(this.contentEl, { text: m.settings_profile_destination_desc() });
    const controls = this.contentEl.createDiv({
      cls: "zt:flex zt:flex-col zt:gap-4",
    });
    const name = new TextComponent(
      field(controls, m.settings_profile_name_name()),
    );
    const folder = new TextComponent(
      field(controls, m.settings_profile_folder_name()),
    ).setPlaceholder(
      m.settings_profile_same_as_default({
        value: this.#deps.defaultFolder || "/",
      }),
    );
    const reason = note(controls, { status: true });
    let draft: PreparedProfileCreation | undefined;
    let nameEdited = false;
    const footer = dialogFooter(this);
    const create = footerButton(footer, m.settings_profile_add(), async () => {
      if (!draft || draft.constraint || this.#saving) return;
      this.#saving = true;
      create.setDisabled(true);
      name.setDisabled(true);
      folder.setDisabled(true);
      cancel.setDisabled(true);
      try {
        const profile = await draft.create();
        this.#saving = false;
        this.#decision.resolve(profile);
        this.close();
      } catch (error) {
        reason.set(
          Error.isError(error)
            ? error.message
            : m.notice_profile_action_failed(),
          "error",
        );
        this.#saving = false;
        create.setDisabled(false);
        name.setDisabled(false);
        folder.setDisabled(false);
        cancel.setDisabled(false);
      }
    })
      .setCta()
      .setDisabled(true);
    const cancel = footerButton(footer, m.modal_cancel(), () => this.close());
    const update = async () => {
      if (this.#saving) return;
      const revision = ++this.#revision;
      draft = undefined;
      create.setDisabled(true);
      try {
        const prepared = await this.#deps.prepareCreate({
          label: name.getValue(),
          look: "default",
          bindings: { folder: folder.getValue() || undefined },
        });
        if (this.#closed || revision !== this.#revision) return;
        draft = prepared;
        const constraint = prepared.constraint;
        reason.set(
          constraint?.message ?? "",
          constraint && nameEdited ? "error" : "muted",
        );
        create.setDisabled(!!constraint || this.#saving);
      } catch (error) {
        if (this.#closed || revision !== this.#revision) return;
        reason.set(
          Error.isError(error)
            ? error.message
            : m.notice_profile_action_failed(),
          "error",
        );
      }
    };
    name.onChange(() => {
      nameEdited = true;
      void update();
    });
    folder.onChange(() => void update());
    name.inputEl.focus();
    void update();
  }

  override close(): void {
    if (!this.#saving) super.close();
  }

  override onClose(): void {
    this.#closed = true;
    this.#decision.resolve(undefined);
    this.contentEl.empty();
  }
}
