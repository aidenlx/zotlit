// One Profile creation dialog shared by settings and contextual Profile pickers.
import { DropdownComponent, Modal, TextComponent } from "obsidian";
import type { App } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";

import { citationStyleLabel } from "@/lib/citation-style";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { NoteFeature, ProfileNotePreview } from "@/services/note-feature";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type {
  LiteratureNoteProfile,
  ProfileBindings,
  ProfileService,
  PreparedProfileCreation,
} from "@/services/profile/service";
import { loadTemplateData } from "@/services/template-workbench/data";
import { loadLiteratureNoteTemplateMigrationData } from "@/services/template/migration";
import type { LiteratureNoteTemplateMigrationDataDeps } from "@/services/template/migration";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

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
export interface CreatedProfile {
  profile: LiteratureNoteProfile;
  preview: ProfileNotePreview;
}
export interface CreateProfileOptions {
  indexedKey?: string;
  useForNote?: boolean;
}
export type CreateProfile = (
  options?: CreateProfileOptions,
) => Promise<CreatedProfile | undefined>;
export interface ProfileCreationDeps {
  app: App;
  profile: Pick<
    ProfileService,
    "ready" | "profiles" | "resolveProfile" | "prepareCreate"
  >;
  template: Pick<
    TemplateService,
    "ready" | "prepareLiteratureNoteTemplateSource"
  >;
  noteFeature: Pick<NoteFeature, "prepareProfileNote">;
  zoteroPref: Pick<ZoteroPrefService, "dataDir">;
  loadData: (options?: {
    indexedKey?: string;
  }) => Promise<ProfileCreationData | null>;
}

export type ProfileDialogServices = Omit<
  LiteratureNoteTemplateMigrationDataDeps,
  "templates"
> & {
  template: TemplateService;
  profile: ProfileService;
  noteFeature: Pick<NoteFeature, "prepareProfileNote">;
};

export async function loadProfilePreviewData(
  deps: ProfileDialogServices,
  options: { indexedKey?: string } = {},
): Promise<ProfileCreationData | null> {
  const dataDeps = { ...deps, templates: deps.template };
  if (!options.indexedKey) {
    const data = await loadLiteratureNoteTemplateMigrationData(dataDeps, {
      annotation: false,
    });
    return data
      ? { note: data.note as NoteTemplateContext, filename: data.filename }
      : null;
  }
  const [note, filename] = await Promise.all([
    loadTemplateData(dataDeps, options.indexedKey, "note"),
    loadTemplateData(dataDeps, options.indexedKey, "filename"),
  ]);
  return note.kind === "data" && filename.kind === "data"
    ? { note: note.data as NoteTemplateContext, filename: filename.data }
    : null;
}

export function createProfileCreator(
  deps: ProfileDialogServices,
): CreateProfile {
  return (options = {}) =>
    createProfileDialog(
      { ...deps, loadData: (options) => loadProfilePreviewData(deps, options) },
      options,
    );
}

export async function createProfileDialog(
  deps: ProfileCreationDeps,
  options: CreateProfileOptions = {},
): Promise<CreatedProfile | undefined> {
  await Promise.all([deps.profile.ready, deps.template.ready]);
  const [data, styles] = await Promise.all([
    deps.loadData({ indexedKey: options.indexedKey }).catch((error) => {
      logger.warn("Profile creation preview data is unavailable", {
        indexedKey: options.indexedKey,
        error,
      });
      return null;
    }),
    deps.zoteroPref.dataDir ? listInstalledStyles(deps.zoteroPref.dataDir) : [],
  ]);
  const modal = new CreateProfileModal(deps, { ...options, data, styles });
  modal.open();
  const created = await modal.result;
  if (created && !options.useForNote)
    new BaseNotice(m.notice_profile_created({ label: created.profile.label }));
  return created;
}

export class CreateProfileModal extends Modal {
  readonly #deps: ProfileCreationDeps;
  readonly #options: CreateProfileOptions & {
    data: ProfileCreationData | null;
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
      data: ProfileCreationData | null;
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
    const base = this.#deps.profile.resolveProfile("default")!;
    const { controls, preview: previewEl } = twoColumns(this.contentEl);
    let label = "";
    let look: ProfileSelector = "default";
    const bindings: ProfileBindings = {};
    let draft: PreparedProfileCreation | undefined;
    let preview: ProfileNotePreview | undefined;
    new TextComponent(field(controls, m.settings_profile_name_name())).onChange(
      (value) => {
        label = value;
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
    for (const profile of this.#deps.profile.profiles)
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
        if (!draft || !preview || draft.reason || this.#saving) return;
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
        const prepared = await this.#deps.profile.prepareCreate({
          label,
          look,
          bindings,
        });
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
        if (this.#options.data) {
          preview = this.#deps.noteFeature.prepareProfileNote({
            profile: prepared.profile,
            document: this.#deps.template.prepareLiteratureNoteTemplateSource(
              prepared.source,
            ),
            ...this.#options.data,
          });
          panel.set(preview);
        }
        const problem =
          prepared.reason ??
          (!preview ? m.settings_profile_preview_unavailable() : undefined);
        reason.set(problem ?? "");
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
