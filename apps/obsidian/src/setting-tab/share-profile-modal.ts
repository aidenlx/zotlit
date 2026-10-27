// One Profile snapshot supplies both Share destinations without changing the vault.
import { Modal, Setting } from "obsidian";
import type { App, ButtonComponent, TextComponent } from "obsidian";
import inc from "semver/functions/inc";

import { AbortError } from "@/lib/abort-error";
import * as m from "@/lib/i18n/generated/messages";
import { UserCancelled } from "@/lib/user-cancel";
import type {
  PreparedProfileShare,
  ProfileShareOptions,
} from "@/services/profile/service";

import {
  dialogFooter,
  footerButton,
  frameDialog,
  heading,
  note,
} from "./profile-dialog";

/** Where Share puts the bundle. */
export type ShareDestination = "clipboard" | "file";

/**
 * Put `source` at `destination`. It settles once the output is done or has
 * told the user why not.
 */
export type ShareOutput = (
  destination: ShareDestination,
  source: string,
) => Promise<void>;

export class ShareProfileModal extends Modal {
  readonly #plan: PreparedProfileShare;
  readonly #share: ShareOutput;
  readonly #decision = Promise.withResolvers<void>();
  /** Settles when the dialog closes. */
  readonly result = this.#decision.promise;
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

  constructor(app: App, plan: PreparedProfileShare, share: ShareOutput) {
    super(app);
    this.#plan = plan;
    this.#share = share;
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
    this.#decision.resolve();
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
    if (this.#plan.missing.length > 0)
      note(parent, {
        text: m.profile_share_missing_partials({
          names: this.#plan.missing.join(", "),
        }),
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

  async #output(destination: ShareDestination): Promise<void> {
    if (this.#busy || this.#closed || this.#source === undefined) return;
    const source = this.#source;
    this.#busy = true;
    this.#refresh();
    try {
      await this.#share(destination, source);
    } catch (error) {
      if (!AbortError.test(error) && !(error instanceof UserCancelled))
        throw error;
    } finally {
      this.#busy = false;
      if (!this.#closed) this.#refresh();
    }
  }
}
