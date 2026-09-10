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

import {
  dialogFooter,
  footerButton,
  frameDialog,
  heading,
  note,
} from "./profile-dialog";

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
  /** Every share choice but the checked partials, which {@link #partials} holds. */
  readonly #options: Omit<ProfileShareOptions, "partials">;
  /** The checked partials, which the bundle carries and nothing else. */
  readonly #partials: Set<string>;
  #source: string | undefined;
  #reason: { set(text: string, tone?: "muted" | "error"): void } | undefined;
  #bump: ButtonComponent | undefined;
  readonly #outputs: ButtonComponent[] = [];
  #busy = false;
  #closed = false;

  constructor(app: App, plan: PreparedProfileShare) {
    super(app);
    this.#plan = plan;
    this.#partials = new Set(plan.reachable);
    this.#options = {
      version: plan.manifest.version,
      author: plan.manifest.author ?? "",
      description: plan.manifest.description ?? "",
      includeFolders: false,
      includeMatch: true,
    };
  }

  override onOpen(): void {
    frameDialog(this);
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
    const description = new Setting(this.contentEl)
      .setName(m.profile_share_description())
      .addTextArea((text) => {
        text.inputEl.addClass("zt:w-full", "zt:resize-y");
        text.inputEl.rows = 3;
        text.setValue(this.#options.description).onChange((value) => {
          this.#options.description = value;
          this.#refresh();
        });
      });
    // Stacked so the text area gets the row's full width.
    description.settingEl.addClasses(["zt:flex-col", "zt:gap-2"]);
    description.controlEl.addClass("zt:w-full");
    this.#partialChecklist(this.contentEl);
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
    this.#reason = note(this.contentEl, { status: true });
    const footer = dialogFooter(this);
    this.#outputs.push(
      footerButton(footer, m.profile_share_copy(), () =>
        this.#output("clipboard"),
      ),
      footerButton(footer, m.profile_share_save(), () =>
        this.#output("file"),
      ).setCta(),
    );
    footerButton(footer, m.modal_cancel(), () => this.close());
    this.#refresh();
  }

  override onClose(): void {
    this.#closed = true;
    this.contentEl.empty();
  }

  /**
   * One checkbox per partial the bundle can carry, opened on the set the
   * dependency scan reaches. The scan reads a quoted name wherever it stands,
   * so a partial named only in prose starts checked and the reader clears it.
   */
  #partialChecklist(parent: HTMLElement): void {
    heading(parent, m.profile_share_partials()).addClass("zt:pt-3");
    note(parent, {
      text: this.#plan.partials.length
        ? m.profile_share_partials_desc()
        : m.profile_share_no_partials(),
    });
    for (const name of this.#plan.partials)
      new Setting(parent).setName(name).addToggle((toggle) =>
        toggle.setValue(this.#partials.has(name)).onChange((value) => {
          if (value) this.#partials.add(name);
          else this.#partials.delete(name);
          this.#refresh();
        }),
      );
  }

  #refresh(): void {
    try {
      this.#source = this.#plan.render({
        ...this.#options,
        partials: [...this.#partials],
      });
      this.#reason?.set("");
    } catch (error) {
      this.#source = undefined;
      this.#reason?.set(
        Error.isError(error) ? error.message : m.profile_share_failed(),
        "error",
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
