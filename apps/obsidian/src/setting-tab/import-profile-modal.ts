// Source selection opens one consent sheet for a fresh or held Profile ID.
import { readFile } from "node:fs/promises";
import { Modal, Setting, SuggestModal, stringifyYaml } from "obsidian";
import type { App, ButtonComponent } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { requireDialog } from "@/lib/require";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type {
  LiteratureNoteProfile,
  PreparedProfileImport,
  ProfileImportOptions,
  ProfileService,
} from "@/services/profile/service";

import { loadProfilePreviewData } from "./create-profile-modal";
import type {
  ProfileCreationData,
  ProfileCreationDeps,
  ProfileDialogServices,
} from "./create-profile-modal";

const logger = getLogger(["setting-tab", "profile-import"]);
const WIDE_MODAL_CLASSES = [
  "zt:[--dialog-width:var(--modal-width)]",
  "zt:[--dialog-max-width:var(--modal-max-width)]",
];
type ImportSource = "clipboard" | "file";
export type ImportProfile = (options?: {
  indexedKey?: string;
  source?: ImportSource;
}) => Promise<LiteratureNoteProfile | undefined>;
export interface ImportProfileDeps extends Pick<
  ProfileCreationDeps,
  "app" | "template" | "noteFeature"
> {
  profile: Pick<ProfileService, "ready" | "resolveProfile" | "prepareImport">;
}

export function createProfileImporter(
  deps: ProfileDialogServices,
): ImportProfile {
  return async (options = {}) => {
    const sourceKind = options.source ?? (await chooseImportSource(deps.app));
    if (sourceKind === undefined) return undefined;
    let source: string | null;
    try {
      source =
        sourceKind === "clipboard"
          ? await navigator.clipboard.readText()
          : await readProfileFile();
    } catch (error) {
      logger.error("Failed to read Profile import source", {
        source: sourceKind,
        error,
      });
      new BaseNotice(m.profile_import_read_failed());
      return undefined;
    }
    if (source === null) return undefined;
    if (!source.trim()) {
      new BaseNotice(m.profile_import_empty());
      return undefined;
    }
    try {
      await Promise.all([deps.profile.ready, deps.template.ready]);
      let plan: PreparedProfileImport;
      try {
        plan = await deps.profile.prepareImport(source, {});
      } catch (error) {
        logger.debug("Refused Profile import source", { error });
        new BaseNotice(
          Error.isError(error) ? error.message : m.profile_import_invalid(),
        );
        return undefined;
      }
      const [data, styles] =
        plan.kind === "replace"
          ? ([null, []] as const)
          : await Promise.all([
              loadProfilePreviewData(deps, options).catch((error) => {
                logger.warn("Profile import preview data unavailable", {
                  error,
                });
                return null;
              }),
              deps.zoteroPref.dataDir
                ? listInstalledStyles(deps.zoteroPref.dataDir)
                : [],
            ]);
      return await importProfileDialog(deps, { source, plan, data, styles });
    } catch (error) {
      logger.error("Failed to open Profile import", { error });
      new BaseNotice(m.notice_profile_action_failed());
      return undefined;
    }
  };
}

function chooseImportSource(app: App): Promise<ImportSource | undefined> {
  const picker = new ImportSourceModal(app);
  picker.contentEl.addClass("zt-root");
  picker.setPlaceholder(m.command_import_profile_name());
  picker.open();
  return picker.result;
}

class ImportSourceModal extends SuggestModal<ImportSource> {
  readonly #decision = Promise.withResolvers<ImportSource | undefined>();
  readonly result = this.#decision.promise;
  getSuggestions(query: string): ImportSource[] {
    const sources: ImportSource[] = ["clipboard", "file"];
    return sources.filter((source) =>
      this.#label(source)
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  }
  renderSuggestion(source: ImportSource, el: HTMLElement): void {
    el.setText(this.#label(source));
  }
  onChooseSuggestion(source: ImportSource): void {
    this.#decision.resolve(source);
  }
  override onClose(): void {
    // Native selection closes the suggester before it calls onChooseSuggestion.
    queueMicrotask(() => this.#decision.resolve(undefined));
  }
  #label(source: ImportSource): string {
    return source === "clipboard"
      ? m.profile_import_clipboard()
      : m.profile_import_file();
  }
}

async function readProfileFile(): Promise<string | null> {
  const selection = await requireDialog().showOpenDialog({
    title: m.profile_import_file(),
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  return selection.canceled || !selection.filePaths[0]
    ? null
    : readFile(selection.filePaths[0], "utf8");
}

export function importProfileDialog(
  deps: ImportProfileDeps,
  options: {
    source: string;
    plan: PreparedProfileImport;
    data: ProfileCreationData | null;
    styles: readonly InstalledCslStyle[];
  },
): Promise<LiteratureNoteProfile | undefined> {
  const modal = new ImportProfileModal(deps, options);
  modal.open();
  return modal.result;
}

export class ImportProfileModal extends Modal {
  readonly #deps: ImportProfileDeps;
  readonly #source: string;
  readonly #plan: PreparedProfileImport;
  readonly #data: ProfileCreationData | null;
  readonly #styles: readonly InstalledCslStyle[];
  readonly #decision = Promise.withResolvers<
    LiteratureNoteProfile | undefined
  >();
  readonly result = this.#decision.promise;
  #closed = false;
  #saving = false;
  #revision = 0;
  constructor(
    deps: ImportProfileDeps,
    options: {
      source: string;
      plan: PreparedProfileImport;
      data: ProfileCreationData | null;
      styles: readonly InstalledCslStyle[];
    },
  ) {
    super(deps.app);
    this.#deps = deps;
    this.#source = options.source;
    this.#plan = options.plan;
    this.#data = options.data;
    this.#styles = options.styles;
  }
  override onOpen(): void {
    this.containerEl.addClasses(["zt-root"]);
    this.setTitle(m.command_import_profile_name());
    if (this.#plan.kind === "replace") this.#replace(this.#plan);
    else this.#fresh(this.#source, this.#plan);
  }
  #replace(plan: Extract<PreparedProfileImport, { kind: "replace" }>): void {
    this.modalEl.classList.remove(...WIDE_MODAL_CLASSES);
    this.contentEl.empty();
    this.setTitle(m.profile_import_replace_title({ label: plan.held.label }));
    this.contentEl.createEl("p", {
      text: m.profile_import_replace_effects({
        version: plan.held.version,
        literature: plan.held.literatureNotes,
        imported: plan.held.importedNotes,
      }),
    });
    const error = this.contentEl.createEl("p", { attr: { role: "status" } });
    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText(m.profile_import_cancel())
          .onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText(m.profile_import_replace())
          .setWarning()
          .onClick(() => this.#save(plan, button, error)),
      );
  }
  #fresh(source: string, initial: PreparedProfileImport): void {
    this.modalEl.addClasses(WIDE_MODAL_CLASSES);
    this.contentEl.empty();
    const layout = this.contentEl.createDiv({
      cls: "zt:grid zt:grid-cols-1 zt:gap-6 zt:md:grid-cols-2",
    });
    const controls = layout.createDiv({ cls: "zt:min-w-0" });
    const preview = layout.createDiv({ cls: "zt:min-w-0" });
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
        "zt:[&>*]:w-full",
        "zt:[&>*]:min-w-0",
      ]);
      return setting;
    };
    controls.createEl("h3", { text: initial.manifest.name });
    controls.createEl("p", { text: initial.manifest.version });
    if (initial.manifest.author)
      controls.createEl("p", { text: initial.manifest.author });
    if (initial.manifest.description)
      controls.createEl("p", { text: initial.manifest.description });
    const base = this.#deps.profile.resolveProfile("default")!;
    const options: ProfileImportOptions = {};
    const incomingStyle = initial.profile.bindings["citation.references-style"];
    const missingStyle =
      incomingStyle !== null &&
      !this.#styles.some(({ id }) => id === incomingStyle)
        ? incomingStyle
        : undefined;
    if (missingStyle) options.citationStyle = null;
    field(m.settings_profile_folder_name()).addText((text) =>
      text
        .setValue(initial.manifest.folder ?? "")
        .setPlaceholder(
          m.settings_profile_same_as_default({
            value: base.bindings["note.literature-folder"] || "/",
          }),
        )
        .onChange((value) => {
          options.folder = value || null;
          void update();
        }),
    );
    field(m.settings_profile_citation_style_name()).addDropdown((dropdown) => {
      const baseStyle =
        this.#styles.find(
          ({ id }) => id === base.bindings["citation.references-style"],
        )?.title ??
        base.bindings["citation.references-style"] ??
        m.settings_citation_references_style_default();
      dropdown.addOption(
        "inherit",
        m.settings_profile_same_as_default({ value: baseStyle }),
      );
      dropdown.addOption(
        "none",
        m.settings_citation_references_style_default(),
      );
      for (const style of this.#styles)
        dropdown.addOption(style.id, style.title);
      dropdown
        .setValue(
          missingStyle || initial.manifest.citationStyle === null
            ? "none"
            : (initial.manifest.citationStyle ?? "inherit"),
        )
        .onChange((value) => {
          options.inheritCitationStyle = value === "inherit";
          if (value === "inherit") delete options.citationStyle;
          else options.citationStyle = value === "none" ? null : value;
          void update();
        });
    });
    if (missingStyle)
      controls.createEl("p", {
        text: m.profile_import_missing_style({ style: missingStyle }),
        cls: "zt:text-sm zt:text-muted-foreground",
      });
    controls.createEl("p", {
      text: m.profile_import_contents({ path: initial.path }),
    });
    if (initial.manifest.partials?.length)
      controls.createEl("p", {
        text: m.profile_import_partials({
          names: initial.manifest.partials.map(({ name }) => name).join(", "),
        }),
      });
    controls.createEl("p", { text: m.profile_import_none_changed() });
    preview.createEl("h3", { text: m.settings_profile_preview_path() });
    const path = preview.createEl("code", { cls: "zt:break-all" });
    preview.createEl("h3", { text: m.settings_profile_preview_properties() });
    const properties = preview.createEl("pre", {
      cls: "zt:overflow-auto zt:whitespace-pre-wrap zt:text-xs",
    });
    preview.createEl("h3", { text: m.settings_profile_preview_body() });
    const body = preview.createEl("pre", {
      cls: "zt:max-h-72 zt:overflow-auto zt:whitespace-pre-wrap zt:text-xs",
    });
    const error = controls.createEl("p", { attr: { role: "status" } });
    let current: PreparedProfileImport | undefined;
    let button: ButtonComponent;
    const update = async () => {
      const revision = ++this.#revision;
      current = undefined;
      button.setDisabled(true);
      path.setText("");
      properties.setText("");
      body.setText("");
      try {
        const plan = await this.#deps.profile.prepareImport(source, options);
        if (this.#closed || revision !== this.#revision) return;
        if (plan.kind === "replace") {
          this.#replace(plan);
          return;
        }
        if (!this.#data)
          throw new Error(m.settings_profile_preview_unavailable());
        const rendered = this.#deps.noteFeature.prepareProfileNote({
          profile: plan.profile,
          document: this.#deps.template.prepareLiteratureNoteTemplateSource(
            plan.source,
          ),
          ...this.#data,
        });
        path.setText(rendered.path);
        properties.setText(stringifyYaml(rendered.properties));
        body.setText(rendered.body);
        current = plan;
        error.setText("");
        button.setDisabled(this.#saving);
      } catch (cause) {
        logger.debug("Refused Profile import preview", { cause });
        if (revision === this.#revision && !this.#closed)
          error.setText(
            Error.isError(cause) ? cause.message : m.profile_import_invalid(),
          );
      }
    };
    new Setting(controls)
      .addButton((value) =>
        value
          .setButtonText(m.profile_import_cancel())
          .onClick(() => this.close()),
      )
      .addButton((value) => {
        button = value;
        button
          .setButtonText(m.profile_import_confirm())
          .setCta()
          .setDisabled(true)
          .onClick(() => current && this.#save(current, button, error));
      });
    void update();
  }
  async #save(
    plan: PreparedProfileImport,
    button: ButtonComponent,
    error: HTMLElement,
  ): Promise<void> {
    if (this.#saving) return;
    this.#saving = true;
    button.setDisabled(true);
    try {
      const profile = await plan.import();
      this.#decision.resolve(profile);
      this.close();
      new BaseNotice(profileImportNotice(profile));
    } catch (cause) {
      logger.error("Failed to write imported Profile", { cause });
      error.setText(
        Error.isError(cause) ? cause.message : m.notice_profile_action_failed(),
      );
      this.#saving = false;
      button.setDisabled(false);
    }
  }
  override onClose(): void {
    this.#closed = true;
    this.#decision.resolve(undefined);
    this.contentEl.empty();
  }
}

export function profileImportNotice(
  profile: Pick<LiteratureNoteProfile, "label">,
): string {
  return m.notice_profile_imported({ label: profile.label });
}
