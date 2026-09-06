// One Profile snapshot supplies both Share destinations without changing the vault.
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Modal, Setting } from "obsidian";
import type { App, ButtonComponent, TextComponent } from "obsidian";
import inc from "semver/functions/inc";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { requireDialog } from "@/lib/require";
import type {
  PreparedProfileShare,
  ProfileService,
  ProfileShareOptions,
} from "@/services/profile/service";

const logger = getLogger(["setting-tab", "profile-share"]);

export async function shareProfile(
  deps: { app: App; profile: Pick<ProfileService, "prepareShare"> },
  selector: ProfileSelector,
): Promise<void> {
  const plan = await deps.profile.prepareShare(selector);
  new ShareProfileModal(deps.app, plan).open();
}

export class ShareProfileModal extends Modal {
  readonly #plan: PreparedProfileShare;
  readonly #options: ProfileShareOptions;
  #source: string | undefined;
  #reason: HTMLElement | undefined;
  #bump: ButtonComponent | undefined;
  readonly #outputs: ButtonComponent[] = [];
  #busy = false;
  #closed = false;

  constructor(app: App, plan: PreparedProfileShare) {
    super(app);
    this.#plan = plan;
    this.#options = {
      version: plan.manifest.version,
      author: plan.manifest.author ?? "",
      description: plan.manifest.description ?? "",
      includeFolders: false,
      includeMatch: true,
    };
  }

  override onOpen(): void {
    this.contentEl.addClass("zt-root");
    this.setTitle(m.profile_share_title({ label: this.#plan.manifest.name }));
    let version: TextComponent;
    new Setting(this.contentEl)
      .setName(m.profile_share_version())
      .addText((text) => {
        version = text;
        text.inputEl.addClass("zt:w-28");
        text.setValue(this.#options.version).onChange((value) => {
          this.#options.version = value;
          this.#refresh();
        });
      })
      .addButton((button) => {
        this.#bump = button;
        button.setButtonText(m.profile_share_bump()).onClick(() => {
          const next = inc(this.#options.version, "patch");
          if (!next) return;
          version.setValue(next);
          this.#options.version = next;
          this.#refresh();
        });
      });
    new Setting(this.contentEl)
      .setName(m.profile_share_author())
      .addText((text) =>
        text.setValue(this.#options.author).onChange((value) => {
          this.#options.author = value;
          this.#refresh();
        }),
      );
    new Setting(this.contentEl)
      .setName(m.profile_share_description())
      .addTextArea((text) =>
        text.setValue(this.#options.description).onChange((value) => {
          this.#options.description = value;
          this.#refresh();
        }),
      );
    this.contentEl.createEl("p", {
      cls: "zt:text-sm zt:text-muted-foreground",
      text: this.#plan.partials.length
        ? m.profile_share_partials({ names: this.#plan.partials.join(", ") })
        : m.profile_share_no_partials(),
    });
    new Setting(this.contentEl)
      .setName(m.profile_share_folders())
      .setDesc(m.profile_share_folders_desc())
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => {
          this.#options.includeFolders = value;
          this.#refresh();
        }),
      );
    new Setting(this.contentEl)
      .setName(m.profile_share_include_match())
      .addToggle((toggle) =>
        toggle.setValue(this.#options.includeMatch!).onChange((value) => {
          this.#options.includeMatch = value;
          this.#refresh();
        }),
      );
    this.#reason = this.contentEl.createEl("p", {
      cls: "zt:text-sm zt:text-muted-foreground",
      attr: { role: "status" },
    });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(m.modal_cancel()).onClick(() => this.close()),
      )
      .addButton((button) => {
        this.#outputs.push(button);
        button
          .setButtonText(m.profile_share_copy())
          .onClick(() => this.#output("clipboard"));
      })
      .addButton((button) => {
        this.#outputs.push(button);
        button
          .setButtonText(m.profile_share_save())
          .setCta()
          .onClick(() => this.#output("file"));
      });
    this.#refresh();
  }

  override onClose(): void {
    this.#closed = true;
    this.contentEl.empty();
  }

  #refresh(): void {
    try {
      this.#source = this.#plan.render(this.#options);
      this.#reason?.setText("");
    } catch (error) {
      this.#source = undefined;
      this.#reason?.setText(
        Error.isError(error) ? error.message : m.profile_share_failed(),
      );
    }
    this.#bump?.setDisabled(!inc(this.#options.version, "patch"));
    for (const button of this.#outputs)
      button.setDisabled(this.#busy || this.#source === undefined);
  }

  async #output(destination: "clipboard" | "file"): Promise<void> {
    if (this.#busy || this.#closed || this.#source === undefined) return;
    const source = this.#source;
    this.#busy = true;
    this.#refresh();
    try {
      if (destination === "clipboard") {
        await navigator.clipboard.writeText(source);
        new BaseNotice(m.profile_share_copied());
      } else {
        const selection = await requireDialog().showSaveDialog({
          title: m.profile_share_save(),
          defaultPath: this.#plan.filename,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (selection.canceled || !selection.filePath || this.#closed) return;
        await writeFile(selection.filePath, source);
        new BaseNotice(
          m.profile_share_saved({ file: basename(selection.filePath) }),
        );
      }
      logger.debug("Shared Profile", {
        id: this.#plan.manifest.id,
        destination,
      });
    } catch (error) {
      logger.error("Failed to share Profile", { destination, error });
      new BaseNotice(m.profile_share_failed());
    } finally {
      this.#busy = false;
      if (!this.#closed) this.#refresh();
    }
  }
}
