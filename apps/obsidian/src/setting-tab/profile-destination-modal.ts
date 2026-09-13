// Collect a second destination before committing its Profile document.
import { Modal, TextComponent } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type {
  LiteratureNoteProfile,
  PreparedProfileCreation,
} from "@/services/profile/service";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

import type { SettingTabContext } from "./context";
import {
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  note,
} from "./profile-dialog";

type DestinationContext = Pick<SettingTabContext, "app" | "profile">;

export async function addProfileDestination(
  ctx: DestinationContext,
): Promise<void> {
  const modal = new ProfileDestinationModal(ctx);
  modal.open();
  const profile = await modal.result;
  if (!profile) return;
  ctx.app.setting.close();
  const file = ctx.app.vault.getFileByPath(profile.path);
  if (!file) throw new Error(m.notice_profile_action_failed());
  await openTemplateWorkbench(ctx.app, file, { tab: "name", customize: true });
  new BaseNotice(m.notice_profile_created({ label: profile.label }));
}

export class ProfileDestinationModal extends Modal {
  readonly #ctx;
  readonly #decision = Promise.withResolvers<
    LiteratureNoteProfile | undefined
  >();
  readonly result = this.#decision.promise;
  #revision = 0;
  #closed = false;
  #saving = false;

  constructor(ctx: DestinationContext) {
    super(ctx.app);
    this.#ctx = ctx;
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
      this.#ctx.profile.resolveProfile("default")!.bindings[
        "note.literature-folder"
      ] || "/",
    );
    const reason = note(controls, { status: true });
    let draft: PreparedProfileCreation | undefined;
    const footer = dialogFooter(this);
    const create = footerButton(footer, m.settings_profile_add(), async () => {
      if (!draft || draft.reason || this.#saving) return;
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
        const prepared = await this.#ctx.profile.prepareCreate({
          label: name.getValue(),
          look: "default",
          bindings: { folder: folder.getValue() || undefined },
        });
        if (this.#closed || revision !== this.#revision) return;
        draft = prepared;
        reason.set(prepared.reason ?? "", prepared.reason ? "error" : "muted");
        create.setDisabled(!!prepared.reason || this.#saving);
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
    name.onChange(() => void update());
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
