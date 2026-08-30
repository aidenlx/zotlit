// One Profile creation dialog shared by settings and contextual Profile pickers.
import { Modal, Setting, stringifyYaml } from "obsidian";
import type { App, ButtonComponent } from "obsidian";

import type { NoteTemplateContext } from "@zotlit/db";

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
import type { SettingsService } from "@/services/settings/service";
import { loadTemplateData } from "@/services/template-workbench/data";
import { loadLiteratureNoteTemplateMigrationData } from "@/services/template/migration";
import type { LiteratureNoteTemplateMigrationDataDeps } from "@/services/template/migration";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

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
  settings: Pick<SettingsService, "update">;
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
  return modal.result;
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
    this.containerEl.addClasses(["zt-root"]);
    this.modalEl.addClasses([
      "zt:[--dialog-width:var(--modal-width)]",
      "zt:[--dialog-max-width:var(--modal-max-width)]",
    ]);
    this.setTitle(m.settings_profile_add());
    const base = this.#deps.profile.resolveProfile("default")!;
    const layout = this.contentEl.createDiv({
      cls: "zt:grid zt:grid-cols-1 zt:gap-6 zt:md:grid-cols-2",
    });
    const controls = layout.createDiv({ cls: "zt:min-w-0" });
    const field = (name: string) => {
      const setting = new Setting(controls).setName(name);
      setting.settingEl.addClasses([
        "zt:flex-col",
        "zt:items-stretch",
        "zt:gap-2",
      ]);
      setting.controlEl.addClasses([
        "zt:min-w-0",
        "zt:w-full",
        "zt:justify-start",
        "zt:[&>*]:min-w-0",
        "zt:[&>*]:w-full",
      ]);
      return setting;
    };
    const previewEl = layout.createDiv({ cls: "zt:min-w-0" });
    let label = "";
    let look: ProfileSelector = "default";
    const bindings: ProfileBindings = {};
    let draft: PreparedProfileCreation | undefined;
    let preview: ProfileNotePreview | undefined;
    let button: ButtonComponent;
    field(m.settings_profile_name_name()).addText((text) =>
      text.onChange((value) => {
        label = value;
        void update();
      }),
    );
    controls.createEl("h3", { text: m.settings_profile_create_differences() });
    field(m.settings_profile_folder_name()).addText((text) =>
      text
        .setPlaceholder(
          m.settings_profile_same_as_default({
            value: base.bindings["note.literature-folder"] || "/",
          }),
        )
        .onChange((value) => {
          if (value) bindings.folder = value;
          else delete bindings.folder;
          void update();
        }),
    );
    const styleLabel = (id: string | null) =>
      this.#options.styles.find((style) => style.id === id)?.title ??
      id ??
      m.settings_citation_references_style_default();
    field(m.settings_profile_citation_style_name()).addDropdown((dropdown) => {
      dropdown.addOption(
        "inherit",
        m.settings_profile_same_as_default({
          value: styleLabel(base.bindings["citation.references-style"]),
        }),
      );
      dropdown.addOption("none", m.settings_profile_citation_style_none());
      for (const style of this.#options.styles)
        dropdown.addOption(style.id, style.title);
      dropdown.setValue("inherit").onChange((value) => {
        if (value === "inherit") delete bindings.citationStyle;
        else bindings.citationStyle = value === "none" ? null : value;
        void update();
      });
    });
    field(m.settings_profile_look_name()).addDropdown((dropdown) => {
      dropdown.addOption(
        "default",
        m.settings_profile_same_as_default({
          value: base.document ?? m.settings_profile_document_builtin(),
        }),
      );
      for (const profile of this.#deps.profile.profiles)
        dropdown.addOption(
          profile.id,
          m.settings_profile_copy_look({ document: profile.document }),
        );
      dropdown.onChange((value) => {
        look = value as ProfileSelector;
        void update();
      });
    });
    const inheritance = controls.createEl("p", {
      cls: "zt:text-sm zt:text-muted-foreground",
    });
    const reason = controls.createEl("p", {
      cls: "zt:text-sm zt:text-muted-foreground",
      attr: { role: "status" },
    });
    previewEl.createEl("h3", { text: m.settings_profile_preview_path() });
    const path = previewEl.createEl("code", { cls: "zt:break-all" });
    previewEl.createEl("h3", { text: m.settings_profile_preview_properties() });
    const properties = previewEl.createEl("pre", {
      cls: "zt:overflow-auto zt:whitespace-pre-wrap zt:text-xs",
    });
    previewEl.createEl("h3", { text: m.settings_profile_preview_body() });
    const body = previewEl.createEl("pre", {
      cls: "zt:max-h-72 zt:overflow-auto zt:whitespace-pre-wrap zt:text-xs",
    });
    const update = async () => {
      const revision = ++this.#revision;
      button?.setDisabled(true);
      draft = undefined;
      preview = undefined;
      path.setText("");
      properties.setText("");
      body.setText("");
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
        inheritance.setText(
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
          path.setText(preview.path);
          properties.setText(stringifyYaml(preview.properties));
          body.setText(preview.body);
        }
        const problem =
          prepared.reason ??
          (!preview ? m.settings_profile_preview_unavailable() : undefined);
        reason.setText(problem ?? "");
        button.setDisabled(!!problem || this.#saving);
      } catch (error) {
        if (revision !== this.#revision || this.#closed) return;
        logger.debug("Profile creation preview was refused", { label, error });
        reason.setText(
          Error.isError(error)
            ? error.message
            : m.notice_profile_action_failed(),
        );
        button.setDisabled(true);
      }
    };
    new Setting(controls).addButton((value) => {
      button = value;
      button
        .setButtonText(
          this.#options.useForNote
            ? m.settings_profile_create_use()
            : m.settings_profile_add(),
        )
        .setCta()
        .setDisabled(true)
        .onClick(async () => {
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
            if (!this.#options.useForNote)
              new BaseNotice(
                renderProfileCreatedNotice(profile, this.#deps.settings),
              );
          } catch (error) {
            logger.error("Failed to create Profile from dialog", { error });
            reason.setText(
              Error.isError(error)
                ? error.message
                : m.notice_profile_action_failed(),
            );
            this.#saving = false;
            button.setDisabled(false);
          }
        });
    });
    void update();
  }

  override onClose(): void {
    if (!this.#saving) logger.debug("Cancelled Profile creation");
    this.#closed = true;
    this.#decision.resolve(undefined);
    this.contentEl.empty();
  }
}

/** The confirmation and next-note action are independently renderable. */
export function renderProfileCreatedNotice(
  profile: Pick<LiteratureNoteProfile, "id" | "label">,
  settings: Pick<SettingsService, "update">,
): DocumentFragment {
  return BaseNotice.render((notice) =>
    notice
      .setTitle(m.notice_profile_created({ label: profile.label }))
      .addAction((action) =>
        action
          .setButtonText(m.profile_use_next_note())
          .onClick(() =>
            settings.update({ "note.last-used-profile": profile.id }),
          ),
      ),
  );
}
