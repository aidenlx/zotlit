// One Profile creation dialog shared by settings and contextual Profile pickers.
import { DropdownComponent, Modal, TextComponent } from "obsidian";
import type { App } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";

import { citationStyleLabel } from "@/lib/citation-style";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { isUserStop } from "@/lib/user-cancel";
import type { ProfileNoteDraft } from "@/services/note-feature/service";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type {
  LiteratureNoteProfile,
  ProfileBindings,
  ProfileCreateOptions,
  PreparedProfileCreation,
} from "@/services/profile/service";

import {
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  heading,
  note,
  previewPanel,
  twoColumns,
} from "./profile-dialog";

const logger = getLogger(["setting-tab", "profiles"]);

export interface ProfileCreationData {
  note: NoteTemplateContext;
  filename: object;
}
/**
 * The Profile the dialog created, and the note it previewed: its `create`
 * writes that note at the path the dialog showed.
 */
export interface CreatedProfile {
  profile: LiteratureNoteProfile;
  preview: ProfileNoteDraft;
}
export interface CreateProfileOptions {
  indexedKey?: string;
  useForNote?: boolean;
}

/** What the creation dialog reads and runs while it is open. */
export interface ProfileCreationDeps {
  app: App;
  /** The default Profile, whose values the fields fall back to. */
  base: ResolvedProfile;
  /** The Profiles whose look a new one can copy. */
  profiles: readonly LiteratureNoteProfile[];
  prepareCreate(
    options: ProfileCreateOptions,
  ): Promise<PreparedProfileCreation>;
  /**
   * The note `profile` would create from the document `source`; absent when
   * no item supplies preview data.
   */
  previewNote?(
    profile: ResolvedProfile,
    source: string,
  ): Promise<ProfileNoteDraft>;
}

export class CreateProfileModal extends Modal {
  readonly #deps: ProfileCreationDeps;
  readonly #options: CreateProfileOptions & {
    styles: readonly InstalledCslStyle[];
  };
  readonly #decision = Promise.withResolvers<CreatedProfile | undefined>();
  readonly result = this.#decision.promise;
  #revision = 0;
  #closed = false;
  #saving = false;

  constructor(
    deps: ProfileCreationDeps,
    options: CreateProfileOptions & {
      styles: readonly InstalledCslStyle[];
    },
  ) {
    super(deps.app);
    this.#deps = deps;
    this.#options = options;
  }

  override onOpen(): void {
    frameDialog(this, { wide: true });
    this.setTitle(m.settings_profile_add());
    const base = this.#deps.base;
    const { controls, preview: previewEl } = twoColumns(this.contentEl);
    let label = "";
    let nameEdited = false;
    let look: ProfileSelector = "default";
    const bindings: ProfileBindings = {};
    let draft: PreparedProfileCreation | undefined;
    let preview: ProfileNoteDraft | undefined;
    new TextComponent(field(controls, m.settings_profile_name_name())).onChange(
      (value) => {
        label = value;
        nameEdited = true;
        void update();
      },
    );
    const differences = controls.createDiv({
      cls: "zt:flex zt:flex-col zt:gap-4 zt:pt-2",
    });
    heading(differences, m.settings_profile_create_differences());
    new TextComponent(field(differences, m.settings_profile_folder_name()))
      .setPlaceholder(
        m.settings_profile_same_as_default({
          value: base.bindings["note.literature-folder"] || "/",
        }),
      )
      .onChange((value) => {
        if (value) bindings.folder = value;
        else delete bindings.folder;
        void update();
      });
    const style = new DropdownComponent(
      field(differences, m.settings_profile_citation_style_name()),
    );
    style.addOption(
      "inherit",
      m.settings_profile_same_as_default({
        value: citationStyleLabel(
          base.bindings["citation.references-style"],
          this.#options.styles,
        ),
      }),
    );
    style.addOption("none", citationStyleLabel());
    for (const item of this.#options.styles)
      style.addOption(item.id, item.title);
    style.setValue("inherit").onChange((value) => {
      if (value === "inherit") delete bindings.citationStyle;
      else bindings.citationStyle = value === "none" ? null : value;
      void update();
    });
    const lookControl = new DropdownComponent(
      field(differences, m.settings_profile_look_name()),
    );
    lookControl.addOption(
      "default",
      m.settings_profile_same_as_default({
        value: base.document ?? m.settings_profile_document_builtin(),
      }),
    );
    for (const profile of this.#deps.profiles)
      lookControl.addOption(
        profile.id,
        m.settings_profile_copy_look({ document: profile.document }),
      );
    lookControl.onChange((value) => {
      look = value as ProfileSelector;
      void update();
    });
    const inheritance = note(controls);
    const reason = note(controls, { status: true });
    const panel = previewPanel(previewEl, {
      path: m.settings_profile_preview_path(),
      properties: m.settings_profile_preview_properties(),
      body: m.settings_profile_preview_body(),
    });
    const footer = dialogFooter(this);
    const button = footerButton(
      footer,
      this.#options.useForNote
        ? m.settings_profile_create_use()
        : m.settings_profile_add(),
      async () => {
        if (!draft || !preview || draft.constraint || this.#saving) return;
        this.#saving = true;
        button.setDisabled(true);
        const selectedDraft = draft;
        const selectedPreview = preview;
        try {
          const profile = await selectedDraft.create();
          logger.debug("Created Profile from dialog", {
            id: profile.id,
            useForNote: this.#options.useForNote ?? false,
          });
          this.#decision.resolve({ profile, preview: selectedPreview });
          this.close();
        } catch (error) {
          if (isUserStop(error)) return;
          logger.error("Failed to create Profile from dialog", { error });
          reason.set(
            Error.isError(error)
              ? error.message
              : m.notice_profile_action_failed(),
            "error",
          );
          this.#saving = false;
          button.setDisabled(false);
        }
      },
    )
      .setCta()
      .setDisabled(true);
    footerButton(footer, m.modal_cancel(), () => this.close());
    const update = async () => {
      const revision = ++this.#revision;
      button.setDisabled(true);
      draft = undefined;
      preview = undefined;
      panel.set(undefined);
      try {
        const prepared = await this.#deps.prepareCreate({
          label,
          look,
          bindings,
        });
        if (revision !== this.#revision || this.#closed) return;
        const note = await this.#deps.previewNote?.(
          prepared.profile,
          prepared.source,
        );
        if (revision !== this.#revision || this.#closed) return;
        draft = prepared;
        const fields = {
          folder: m.settings_profile_folder_name(),
          citationStyle: m.settings_profile_citation_style_name(),
          look: m.settings_profile_look_name(),
        };
        inheritance.set(
          prepared.inherited.length
            ? m.settings_profile_inheritance({
                values: prepared.inherited.map((key) => fields[key]).join(", "),
              })
            : "",
        );
        if (note) {
          preview = note;
          panel.set(note);
        }
        const problem =
          prepared.constraint?.message ??
          (!preview ? m.settings_profile_preview_unavailable() : undefined);
        reason.set(
          problem ?? "",
          prepared.constraint?.kind === "invalid-name" && nameEdited
            ? "error"
            : "muted",
        );
        button.setDisabled(!!problem || this.#saving);
      } catch (error) {
        if (revision !== this.#revision || this.#closed) return;
        logger.debug("Profile creation preview was refused", { label, error });
        reason.set(
          Error.isError(error)
            ? error.message
            : m.notice_profile_action_failed(),
          "error",
        );
        button.setDisabled(true);
      }
    };
    void update();
  }

  override onClose(): void {
    if (!this.#saving) logger.debug("Cancelled Profile creation");
    this.#closed = true;
    this.#decision.resolve(undefined);
    this.contentEl.empty();
  }
}
