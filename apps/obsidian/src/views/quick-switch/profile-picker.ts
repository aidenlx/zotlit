import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type {
  CreationProfileSelection,
  ProfilePreview,
} from "@/services/note-feature";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type { LiteratureNoteProfile } from "@/services/profile/service";

const logger = getLogger(["profile-picker"]);

export interface LiteratureNoteProfileChoice {
  id: ProfileSelector;
  label: string;
  detail?: string;
  path?: string;
  unavailable?: string;
  preselected?: boolean;
  current?: boolean;
  candidate?: "item" | "batch";
  source?: CreationProfileSelection["source"];
  /** Why the match selected this Profile. */
  reason?: string;
  /** Why automatic selection stopped, shown above the preselected choice. */
  problem?: string;
}

type ProfilePickerRow =
  | LiteratureNoteProfileChoice
  | { action: "new"; label: string };

interface ProfilePickerOptions {
  preselected?: ProfileSelector;
  candidates?: readonly ProfileSelector[];
  matchContext?: "item" | "batch";
  current?: ProfileSelector;
  source?: CreationProfileSelection["source"];
  reason?: string;
  problem?: string;
  previews?: readonly ProfilePreview[];
  styles?: readonly InstalledCslStyle[];
  onNew?: () => Promise<LiteratureNoteProfileChoice | undefined>;
  onImport?: () => Promise<void>;
}

const PROFILE_BADGE_CLASS =
  "zt:rounded-sm zt:bg-muted zt:px-1.5 zt:py-0.5 zt:text-xs zt:leading-tight zt:whitespace-nowrap zt:text-muted-foreground";

/** Secondary line under a Profile label; the color comes from the caller. */
const PROFILE_NOTE_CLASS = "zt:text-xs zt:leading-tight";

export function chooseLiteratureNoteProfile(
  app: App,
  profilesOrOptions:
    | readonly LiteratureNoteProfile[]
    | (ProfilePickerOptions & {
        previews: readonly ProfilePreview[];
      }),
  options: ProfilePickerOptions = {},
): Promise<LiteratureNoteProfileChoice | undefined> {
  const profiles = "previews" in profilesOrOptions ? [] : profilesOrOptions;
  const selectedOptions =
    "previews" in profilesOrOptions ? profilesOrOptions : options;
  return new Promise((resolve) => {
    new LiteratureNoteProfileModal(app, profiles, {
      resolve,
      ...selectedOptions,
      preselected: selectedOptions.preselected ?? DEFAULT_PROFILE,
    }).open();
  });
}

class LiteratureNoteProfileModal extends SuggestModal<ProfilePickerRow> {
  readonly #choices: LiteratureNoteProfileChoice[];
  readonly #resolve: (choice: LiteratureNoteProfileChoice | undefined) => void;
  readonly #onNew: ProfilePickerOptions["onNew"];
  readonly #onImport: ProfilePickerOptions["onImport"];
  #settled = false;

  constructor(
    app: App,
    profiles: readonly LiteratureNoteProfile[],
    options: ProfilePickerOptions & {
      resolve: (choice: LiteratureNoteProfileChoice | undefined) => void;
      preselected: ProfileSelector;
    },
  ) {
    super(app);
    this.#onNew = options.onNew;
    this.#onImport = options.onImport;
    this.#choices = options.previews
      ? options.previews.map((preview) =>
          profilePreviewChoice(preview, { styles: options.styles }),
        )
      : [
          { id: DEFAULT_PROFILE, label: m.settings_profile_default_name() },
          ...profiles.map(({ id, label, document, bindings }) => ({
            id,
            label:
              profiles.filter((profile) => profile.label === label).length > 1
                ? `${label} (${document})`
                : label,
            detail: m.settings_profile_display({
              folder:
                bindings["note.literature-folder"] ??
                m.settings_profile_inherit(),
              style:
                bindings["citation.references-style"] === null
                  ? m.settings_profile_citation_style_none()
                  : (bindings["citation.references-style"] ??
                    m.settings_profile_inherit()),
              document,
            }),
          })),
        ];
    for (const choice of this.#choices) {
      choice.candidate = options.candidates?.includes(choice.id)
        ? (options.matchContext ?? "item")
        : undefined;
      choice.preselected = options.candidates?.length
        ? choice.candidate !== undefined
        : choice.id === options.preselected;
      choice.current = choice.id === options.current;
      choice.source = choice.preselected ? options.source : undefined;
      choice.reason = choice.preselected ? options.reason : undefined;
      choice.problem = choice.preselected ? options.problem : undefined;
    }
    this.#choices.sort((a, b) => Number(b.preselected) - Number(a.preselected));
    // A SuggestModal empties `modalEl`, so `contentEl` never reaches the
    // screen; the status line sits between the input and the results.
    if (
      options.problem &&
      !this.#choices.some(({ preselected }) => preselected)
    )
      this.resultContainerEl.before(
        this.modalEl.createDiv({
          text: options.problem,
          cls: "zt:px-6 zt:py-2 zt:text-sm zt:text-(--text-warning)",
          attr: { role: "status" },
        }),
      );
    this.#resolve = options.resolve;
    this.setPlaceholder(
      options.candidates?.length
        ? m.modal_profile_overlap_placeholder()
        : m.modal_profile_choose_placeholder(),
    );
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getSuggestions(query: string): ProfilePickerRow[] {
    const normalized = query.trim().toLocaleLowerCase();
    const profiles = normalized
      ? this.#choices.filter(({ label }) =>
          label.toLocaleLowerCase().includes(normalized),
        )
      : this.#choices;
    return [...profiles, { action: "new", label: m.modal_profile_new() }];
  }

  override renderSuggestion(choice: ProfilePickerRow, el: HTMLElement): void {
    if ("action" in choice) {
      el.addClass("mod-complex");
      el.createDiv({
        text: choice.label,
        cls: "suggestion-content zt:min-w-0",
      });
      if (this.#onImport) {
        const button = el.createDiv("suggestion-aux").createEl("button", {
          text: m.profile_import_from_text_file(),
        });
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ")
            event.stopPropagation();
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.#settled = true;
          this.close();
          void this.#onImport!().then(
            () => this.#resolve(undefined),
            (error) => {
              logger.error("Failed to open Profile import", { error });
              new BaseNotice(m.notice_profile_action_failed());
              this.#resolve(undefined);
            },
          );
        });
      }
    } else renderProfileChoice(choice, el);
  }

  override onChooseSuggestion(choice: ProfilePickerRow): void {
    this.#settled = true;
    if ("action" in choice)
      void this.#onNew?.().then(this.#resolve, (error) => {
        logger.error("Failed to open Profile creation", { error });
        new BaseNotice(m.notice_profile_action_failed());
        this.#resolve(undefined);
      });
    else this.#resolve(choice.unavailable ? undefined : choice);
    if ("action" in choice && !this.#onNew) this.#resolve(undefined);
  }

  override onClose(): void {
    // Obsidian closes the modal before delivering the selected suggestion.
    queueMicrotask(() => {
      if (!this.#settled) this.#resolve(undefined);
    });
  }
}

/** The same effective Profile details feed picker and embedded target rows. */
export function profilePreviewChoice(
  preview: ProfilePreview,
  options: { styles?: readonly InstalledCslStyle[] } = {},
): LiteratureNoteProfileChoice {
  return {
    id: preview.selector,
    label: preview.label ?? m.settings_profile_default_name(),
    detail: m.settings_profile_display({
      folder: preview.folder || m.modal_profile_root_folder(),
      style:
        options.styles?.find(({ id }) => id === preview.citationStyle)?.title ??
        preview.citationStyle ??
        m.settings_citation_references_style_default(),
      document: preview.document ?? m.settings_profile_document_builtin(),
    }),
    path: preview.path,
    unavailable: preview.unavailable,
  };
}

export function renderProfileChoice(
  choice: LiteratureNoteProfileChoice,
  el: HTMLElement,
): void {
  el.classList.add("zt:flex", "zt:flex-col", "zt:gap-0.5");
  const label = el.createDiv({
    text: choice.label,
    cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1",
  });
  if (choice.preselected)
    label.createSpan({
      text: choice.candidate
        ? choice.candidate === "batch"
          ? m.modal_profile_match_batch_candidate()
          : m.modal_profile_match_candidate()
        : choice.current
          ? m.modal_profile_current()
          : m.modal_profile_preselected(),
      cls: PROFILE_BADGE_CLASS,
    });
  if (choice.source === "headless")
    label.createSpan({
      text: m.modal_profile_source_link(),
      cls: PROFILE_BADGE_CLASS,
    });
  if (choice.source === "match" && choice.reason)
    label.createSpan({
      text: choice.reason,
      cls: PROFILE_BADGE_CLASS,
    });
  if (choice.problem)
    el.createDiv({
      text: choice.problem,
      cls: `${PROFILE_NOTE_CLASS} zt:text-(--text-warning)`,
    });
  if (choice.detail)
    el.createDiv({
      text: choice.detail,
      cls: `${PROFILE_NOTE_CLASS} zt:text-muted-foreground`,
    });
  if (choice.path)
    el.createDiv({
      text: choice.path,
      cls: `${PROFILE_NOTE_CLASS} zt:font-mono zt:whitespace-pre-line zt:text-muted-foreground`,
    });
  if (choice.unavailable) {
    el.setAttribute("aria-disabled", "true");
    el.addClass("mod-downranked");
    el.createDiv({
      text: choice.unavailable,
      cls: `${PROFILE_NOTE_CLASS} zt:text-destructive`,
    });
  }
}
