// Source selection opens one consent sheet for a fresh or held Profile ID.
import {
  DropdownComponent,
  Modal,
  SuggestModal,
  TextComponent,
  ToggleComponent,
} from "obsidian";
import type { App, ButtonComponent } from "obsidian";

import { citationStyleLabel } from "@/lib/citation-style";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { ProfileNoteDraft } from "@/services/note-feature/service";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import { describeMatch } from "@/services/profile-selection";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type {
  LiteratureNoteProfile,
  PreparedProfileImport,
  ProfileImportOptions,
} from "@/services/profile/service";

import {
  DialogClosed,
  NOTE_CLASS,
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  note,
  previewPanel,
  twoColumns,
} from "./profile-dialog";

const logger = getLogger(["setting-tab", "profile-import"]);
export type ImportSource = "clipboard" | "file";
export type ImportProfile = (options?: {
  indexedKey?: string;
  source?: ImportSource;
}) => Promise<LiteratureNoteProfile | undefined>;

/** What the import dialog reads and runs while it is open. */
export interface ImportProfileDeps {
  app: App;
  /** The default Profile, whose values the fields fall back to. */
  base: ResolvedProfile;
  prepareImport(
    source: string,
    options: ProfileImportOptions,
  ): Promise<PreparedProfileImport>;
  /**
   * The note `profile` would create from the document `source`; absent when
   * no item supplies preview data.
   */
  previewNote?(
    profile: ResolvedProfile,
    source: string,
  ): Promise<ProfileNoteDraft>;
}

/**
 * The source picker: it answers the source the user picks, or `undefined`
 * when the user dismisses it.
 */
export class ImportSourceModal extends SuggestModal<ImportSource> {
  readonly #decision = Promise.withResolvers<ImportSource | undefined>();
  readonly result = this.#decision.promise;
  constructor(app: App) {
    super(app);
    this.setPlaceholder(m.command_import_profile_name());
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }
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

export class ImportProfileModal extends Modal {
  readonly #deps: ImportProfileDeps;
  readonly #source: string;
  readonly #plan: PreparedProfileImport;
  readonly #styles: readonly InstalledCslStyle[];
  readonly #decision = Promise.withResolvers<
    LiteratureNoteProfile | undefined
  >();
  readonly result = this.#decision.promise;
  readonly #options: ProfileImportOptions = { includeMatch: true };
  /** The conflicting partials the reader chose to replace; the rest stay. */
  readonly #replacePartials = new Set<string>();
  #closed = false;
  #saving = false;
  #revision = 0;
  constructor(
    deps: ImportProfileDeps,
    options: {
      source: string;
      plan: PreparedProfileImport;
      styles: readonly InstalledCslStyle[];
    },
  ) {
    super(deps.app);
    this.#deps = deps;
    this.#source = options.source;
    this.#plan = options.plan;
    this.#styles = options.styles;
  }
  override onOpen(): void {
    this.setTitle(m.command_import_profile_name());
    if (this.#plan.kind === "replace") this.#replace(this.#plan);
    else this.#fresh(this.#source, this.#plan);
  }
  #replace(plan: Extract<PreparedProfileImport, { kind: "replace" }>): void {
    frameDialog(this, { wide: false });
    this.contentEl.empty();
    this.contentEl.addClass("zt:flex", "zt:flex-col", "zt:gap-4");
    this.setTitle(m.profile_import_replace_title({ label: plan.held.label }));
    this.contentEl.createEl("p", {
      cls: "zt:text-pretty",
      text: m.profile_import_replace_effects({
        version: plan.held.version,
        literature: plan.held.literatureNotes,
        imported: plan.held.importedNotes,
      }),
    });
    this.#match(this.contentEl);
    this.#partials(this.contentEl);
    const error = note(this.contentEl, { status: true });
    const footer = dialogFooter(this);
    const button = footerButton(footer, m.profile_import_replace(), () =>
      this.#save(plan, button, error),
    ).setWarning();
    footerButton(footer, m.profile_import_cancel(), () => this.close());
  }
  #fresh(source: string, initial: PreparedProfileImport): void {
    frameDialog(this, { wide: true });
    this.contentEl.empty();
    const { controls, preview } = twoColumns(this.contentEl);
    const header = controls.createDiv({ cls: "zt:flex zt:flex-col zt:gap-1" });
    header.createDiv({
      text: initial.manifest.name,
      cls: "zt:text-base zt:leading-(--line-height-tight) zt:font-semibold",
      attr: { role: "heading", "aria-level": "3" },
    });
    header.createDiv({
      cls: NOTE_CLASS,
      text: [initial.manifest.version, initial.manifest.author]
        .filter(Boolean)
        .join(" · "),
    });
    if (initial.manifest.description)
      header.createEl("p", {
        cls: "zt:text-sm zt:leading-(--line-height-tight) zt:text-pretty",
        text: initial.manifest.description,
      });
    const base = this.#deps.base;
    const options = this.#options;
    const incomingStyle = initial.profile.bindings["citation.references-style"];
    const missingStyle =
      incomingStyle !== null &&
      !this.#styles.some(({ id }) => id === incomingStyle)
        ? incomingStyle
        : undefined;
    if (missingStyle) options.citationStyle = null;
    this.#match(controls, () => void update());
    new TextComponent(field(controls, m.settings_profile_folder_name()))
      .setValue(initial.manifest.folder ?? "")
      .setPlaceholder(
        m.settings_profile_same_as_default({
          value: base.bindings["note.literature-folder"] || "/",
        }),
      )
      .onChange((value) => {
        options.folder = value || null;
        void update();
      });
    const styleField = field(
      controls,
      m.settings_profile_citation_style_name(),
    );
    const style = new DropdownComponent(styleField);
    const baseStyle = citationStyleLabel(
      base.bindings["citation.references-style"],
      this.#styles,
    );
    style.addOption(
      "inherit",
      m.settings_profile_same_as_default({ value: baseStyle }),
    );
    style.addOption("none", citationStyleLabel());
    for (const item of this.#styles) style.addOption(item.id, item.title);
    style
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
    if (missingStyle)
      note(controls, {
        text: m.profile_import_missing_style({ style: missingStyle }),
      }).set(m.profile_import_missing_style({ style: missingStyle }), "error");
    const facts = controls.createDiv({ cls: "zt:flex zt:flex-col zt:gap-1" });
    facts.createEl("p", {
      cls: NOTE_CLASS,
      text: m.profile_import_contents({ path: initial.path }),
    });
    facts.createEl("p", {
      cls: NOTE_CLASS,
      text: m.profile_import_none_changed(),
    });
    this.#partials(controls, () => void update());
    const error = note(controls, { status: true });
    const panel = previewPanel(preview, {
      path: m.settings_profile_preview_path(),
      properties: m.settings_profile_preview_properties(),
      body: m.settings_profile_preview_body(),
    });
    let current: PreparedProfileImport | undefined;
    const footer = dialogFooter(this);
    const button = footerButton(footer, m.profile_import_confirm(), () => {
      if (current) void this.#save(current, button, error);
    })
      .setCta()
      .setDisabled(true);
    footerButton(footer, m.profile_import_cancel(), () => this.close());
    const update = async () => {
      const revision = ++this.#revision;
      current = undefined;
      button.setDisabled(true);
      panel.set(undefined);
      try {
        const plan = await this.#deps.prepareImport(source, options);
        if (this.#closed || revision !== this.#revision) return;
        if (plan.kind === "replace") {
          this.#replace(plan);
          return;
        }
        if (!this.#deps.previewNote)
          throw new Error(m.settings_profile_preview_unavailable());
        const preview = await this.#deps.previewNote(
          plan.profile,
          plan.previewSource({
            replacePartials: [...this.#replacePartials],
          }),
        );
        if (this.#closed || revision !== this.#revision) return;
        panel.set(preview);
        current = plan;
        error.set("");
        button.setDisabled(this.#saving);
      } catch (cause) {
        logger.debug("Refused Profile import preview", { cause });
        if (revision === this.#revision && !this.#closed)
          error.set(
            Error.isError(cause) ? cause.message : m.profile_import_invalid(),
            "error",
          );
      }
    };
    void update();
  }
  #match(container: HTMLElement, onChange?: () => void): void {
    const match = this.#plan.manifest.match;
    const group = container.createDiv({ cls: "zt:flex zt:flex-col zt:gap-2" });
    group.createEl("p", {
      cls: NOTE_CLASS,
      text:
        match === undefined ? m.profile_match_absent() : describeMatch(match),
    });
    if (match === undefined) return;
    const row = group.createDiv({
      cls: "zt:flex zt:items-center zt:justify-between zt:gap-3",
    });
    row.createSpan({
      text: m.profile_import_include_match(),
      cls: "zt:text-sm zt:leading-(--line-height-tight)",
    });
    new ToggleComponent(row)
      .setValue(this.#options.includeMatch!)
      .onChange((value) => {
        this.#options.includeMatch = value;
        onChange?.();
      });
  }
  /**
   * What the bundled partials do to the template folder, and the one choice
   * they can raise: a document already holding other text under the same name
   * is kept unless the reader says to replace it, so no file of theirs goes
   * without their word.
   */
  #partials(container: HTMLElement, onChange?: () => void): void {
    const plan = this.#plan.partials;
    if (plan.length === 0) return;
    const group = container.createDiv({ cls: "zt:flex zt:flex-col zt:gap-2" });
    // A name a document of this vault's own already answers — identical text,
    // or a reserved name another Template carries — reaches no file and needs
    // no word here: nothing in the template folder changes for it.
    const unpacked = plan
      .filter(({ verdict }) => verdict === "write")
      .map(({ name }) => name);
    if (unpacked.length > 0)
      group.createEl("p", {
        cls: NOTE_CLASS,
        text: m.profile_import_partials({ names: unpacked.join(", ") }),
      });
    // A name the Shared Partial name rule refuses reaches no file either, and
    // it does need a word: the profile keeps carrying its copy.
    const refused = plan
      .filter(({ verdict }) => verdict === "refused")
      .map(({ name }) => name);
    if (refused.length > 0)
      group.createEl("p", {
        cls: NOTE_CLASS,
        text: m.profile_import_partials_refused({ names: refused.join(", ") }),
      });
    // A well-formed name the folder already answers in another case reaches no
    // file of its own: one file answers both spellings, so the profile keeps
    // carrying this copy too — for a reason of its own.
    const otherCase = plan
      .filter(({ verdict }) => verdict === "other-case")
      .map(({ name }) => name);
    if (otherCase.length > 0)
      group.createEl("p", {
        cls: NOTE_CLASS,
        text: m.profile_import_partials_other_case({
          names: otherCase.join(", "),
        }),
      });
    for (const { name } of plan.filter(
      ({ verdict }) => verdict === "conflict",
    )) {
      const row = group.createDiv({
        cls: "zt:flex zt:items-center zt:justify-between zt:gap-3",
      });
      row.createSpan({
        text: m.profile_import_partial_replace({ name }),
        cls: "zt:text-sm zt:leading-(--line-height-tight)",
      });
      new ToggleComponent(row)
        .setValue(this.#replacePartials.has(name))
        .onChange((value) => {
          if (value) this.#replacePartials.add(name);
          else this.#replacePartials.delete(name);
          onChange?.();
        });
    }
  }

  async #save(
    plan: PreparedProfileImport,
    button: ButtonComponent,
    error: { set(text: string, tone?: "muted" | "error"): void },
  ): Promise<void> {
    if (this.#saving) return;
    this.#saving = true;
    button.setDisabled(true);
    try {
      const profile = await plan.import({
        includeMatch: this.#options.includeMatch,
        replacePartials: [...this.#replacePartials],
      });
      this.#decision.resolve(profile);
      this.close();
      new BaseNotice(profileImportNotice(profile));
    } catch (cause) {
      if (cause instanceof DialogClosed) return;
      logger.error("Failed to write imported Profile", { cause });
      error.set(
        Error.isError(cause) ? cause.message : m.notice_profile_action_failed(),
        "error",
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
