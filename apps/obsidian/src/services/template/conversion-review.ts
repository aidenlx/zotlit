import { Modal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { openTemplateWorkbench } from "@/views/template-workbench/register";
import { TemplateWorkbenchView } from "@/views/template-workbench/view";

import { ConversionRepairError } from "./conversion-copy";
import type {
  ConversionRepairDiagnostic,
  ConversionRepairReview,
  ConversionComparison,
} from "./conversion-copy";
import type {
  LiteratureNoteTemplateConversionReview,
  LiteratureNoteTemplateMigrationResult,
  LiteratureNoteTemplateMigrationDiagnostic,
  LiteratureNoteTemplateMigrationService,
} from "./migration";

/** Native review keeps preparation visible until the user accepts conversion. */
export class TemplateConversionReviewModal extends Modal {
  readonly #migration;
  readonly #completed;
  #closed = false;
  readonly #footer = this.contentEl.ownerDocument.createElement("div");

  constructor(
    app: App,
    options: {
      migration: Pick<
        LiteratureNoteTemplateMigrationService,
        | "prepare"
        | "activate"
        | "startRepair"
        | "resumeRepair"
        | "reviewRepair"
        | "acceptRepair"
        | "discardRepair"
        | "refreshRepairOriginals"
      >;
      completed: (result: LiteratureNoteTemplateMigrationResult) => void;
    },
  ) {
    super(app);
    this.#migration = options.migration;
    this.#completed = options.completed;
    this.setTitle(m.conversion_review_title());
    this.#footer.classList.add("modal-button-container", "zt-root");
  }

  override onOpen(): void {
    this.modalEl.classList.add("mod-scrollable-content");
    this.contentEl.classList.add("zt-root");
    this.modalEl.append(this.#footer);
    void this.#prepare();
  }

  override onClose(): void {
    this.#closed = true;
    this.#footer.remove();
    this.contentEl.replaceChildren();
  }

  async #prepare(): Promise<void> {
    this.contentEl.replaceChildren();
    this.#footer.replaceChildren();
    this.#button(m.conversion_review_later(), () => this.close());
    this.#text("p", m.conversion_review_checking());
    try {
      if (await this.#migration.resumeRepair()) {
        const repair = await this.#migration.reviewRepair();
        if (!this.#closed) this.#renderRepair(repair);
        return;
      }
      const review = await this.#migration.prepare();
      if (!this.#closed) this.#render(review);
    } catch (error) {
      if (!this.#closed) this.#error(error);
    }
  }

  #render(review: LiteratureNoteTemplateConversionReview): void {
    this.contentEl.replaceChildren();
    this.#footer.replaceChildren();
    const hasProfile = review.inputs.some(({ kind }) => kind === "profile");
    this.#text("p", m.conversion_review_inactive());
    this.#text("h3", m.conversion_review_inputs());
    for (const input of review.inputs) {
      const details = this.#text("details", "");
      this.#text(
        "summary",
        input.destination === null
          ? m.conversion_review_retained_file({ path: input.path })
          : `${input.path} → ${input.destination}`,
        details,
      );
      this.#text("pre", input.source, details);
    }
    if (review.kept.length > 0)
      this.#text("p", m.conversion_review_retained_citation());
    if (hasProfile) {
      this.#text("h3", m.conversion_review_fields());
      this.#text("pre", JSON.stringify(review.fields, null, 2));
    }
    this.#text("h3", m.conversion_review_verification());
    this.#text("p", m.conversion_review_scope());
    if (review.selected) {
      this.#text("p", m.conversion_review_item({ item: review.selected.item }));
      if (review.inputs.some(({ kind }) => kind === "citation"))
        this.#text(
          "p",
          m.conversion_review_citation({
            citation: review.selected.citation.join(", "),
          }),
        );
      if (review.annotation && review.selected.annotation)
        this.#text(
          "p",
          m.conversion_review_selected_annotation({
            annotation: review.selected.annotation,
          }),
        );
    }
    if (hasProfile) this.#text("p", m.conversion_review_profile_scope());
    this.#text(
      "p",
      review.annotation
        ? m.conversion_review_annotation()
        : m.conversion_review_no_annotation(),
    );
    if (hasProfile) this.#text("p", m.conversion_review_frontmatter_scope());
    const preparation = review.preparation;
    if (preparation.outcome === "refused") {
      this.#text("h3", m.conversion_review_refused());
      this.#diagnostic(preparation.diagnostic);
      if ("difference" in preparation.diagnostic)
        this.#text("pre", preparation.diagnostic.difference);

      if (
        preparation.diagnostic.code === "legacy-frontmatter-evaluation" ||
        preparation.diagnostic.code === "legacy-frontmatter-inert"
      ) {
        const field = preparation.diagnostic.fields[0];
        this.#button(m.conversion_repair_field(), () =>
          this.#openRepair(field),
        );
      }
      this.#button(m.conversion_review_retry(), () => void this.#prepare());
    } else {
      this.#text("p", m.conversion_review_matching());
      for (const document of preparation.documents) {
        const details = this.#text("details", "");
        this.#text("summary", document.path, details);
        this.#text("pre", document.source, details);
      }
      this.#text("p", m.conversion_review_cleanup());
      this.#button(m.conversion_review_activate(), async (button) => {
        button.disabled = true;
        try {
          const result = await this.#migration.activate(review);
          if (this.#closed) return;
          if (result.outcome === "converted") {
            this.#completed(result);
            this.close();
          } else {
            this.#diagnostic(result.diagnostic);
            this.#button(
              m.conversion_review_retry(),
              () => void this.#prepare(),
            );
          }
        } catch (error) {
          this.#error(error);
        }
      }).classList.add("mod-cta");
    }
    this.#button(m.conversion_review_later(), () => this.close());
  }

  async #openRepair(field?: string): Promise<void> {
    try {
      const copy = await this.#migration.startRepair();
      const file = copy.profilePath
        ? this.app.vault.getFileByPath(copy.profilePath)
        : null;
      if (!file) {
        this.#text(
          "p",
          copy.diagnostic
            ? repairDiagnostic(copy.diagnostic)
            : m.conversion_repair_no_document(),
        );
        return;
      }
      await openTemplateWorkbench(this.app, file, {
        tab: "properties",
        itemIndexedKey: copy.itemKey,
        explainUnsupported: false,
      });
      const position =
        copy.originalSettings["note.frontmatter-fields"].findIndex(
          (entry) => entry.key === field,
        ) + 1;
      for (const leaf of this.app.workspace.getLeavesOfType(
        "zotlit-template-workbench",
      )) {
        if (
          leaf.view instanceof TemplateWorkbenchView &&
          leaf.view.file?.path === file.path
        ) {
          if (position > 0) leaf.view.revealSlice(`entry:${position}`);
          leaf.view.showProblem(null, false);
        }
      }
      this.close();
    } catch (error) {
      this.#error(error);
    }
  }

  #renderRepair(review: ConversionRepairReview): void {
    this.contentEl.replaceChildren();
    this.#footer.replaceChildren();
    this.#text("p", m.conversion_repair_saved());
    this.#text("p", m.conversion_review_inactive());
    this.#text("p", m.conversion_review_scope());
    this.#text("p", m.conversion_review_frontmatter_scope());
    if (review.itemKey)
      this.#text("p", m.conversion_review_item({ item: review.itemKey }));
    if (review.comparisons.some(({ output }) => output === "create"))
      this.#text("p", m.conversion_review_profile_scope());
    if (review.annotationKey)
      this.#text(
        "p",
        m.conversion_review_selected_annotation({
          annotation: review.annotationKey,
        }),
      );
    if (
      review.citation &&
      review.comparisons.some(({ output }) => output === "main-citation")
    )
      this.#text(
        "p",
        m.conversion_review_citation({ citation: review.citation.join(", ") }),
      );
    for (const comparison of review.comparisons) {
      const details = this.#text("details", "");
      this.#text(
        "summary",
        `${comparisonLabel(comparison.output)}: ${comparisonOutcome(comparison.outcome)}`,
        details,
      );
      if (comparison.original !== null) {
        this.#text("p", m.conversion_repair_original(), details);
        this.#text("pre", comparison.original, details);
      }
      if (comparison.candidate !== null) {
        this.#text("p", m.conversion_repair_candidate(), details);
        this.#text("pre", comparison.candidate, details);
      }
      if (comparison.error)
        this.#text("pre", repairDiagnostic(comparison.error), details);
    }
    if (review.diagnostic) this.#text("p", repairDiagnostic(review.diagnostic));
    if (review.valid) {
      this.#button(
        review.requiresAcceptance
          ? m.conversion_repair_accept_changes()
          : m.conversion_review_activate(),
        async (button) => {
          button.disabled = true;
          try {
            const result = await this.#migration.acceptRepair(
              review,
              review.requiresAcceptance ? "reviewed-changes" : "matching",
            );
            if (result.outcome === "converted") {
              this.#completed(result);
              this.close();
            } else {
              this.#diagnostic(result.diagnostic);
              this.#button(
                m.conversion_review_retry(),
                () => void this.#prepare(),
              );
            }
          } catch (error) {
            this.#error(error);
          }
        },
      ).classList.add("mod-cta");
    }
    if (review.diagnostic?.code === "originals-changed")
      this.#button(m.conversion_repair_refresh_originals(), async () =>
        this.#renderRepair(await this.#migration.refreshRepairOriginals()),
      );
    this.#button(m.conversion_repair_resume(), () => this.#openRepair());
    this.#button(m.conversion_repair_discard(), async () => {
      await this.#migration.discardRepair();
      await this.#prepare();
    });
    this.#button(m.conversion_review_retry(), () => void this.#prepare());
    this.#button(m.conversion_review_later(), () => this.close());
  }

  #diagnostic(diagnostic: LiteratureNoteTemplateMigrationDiagnostic): void {
    this.#text(
      "p",
      diagnostic.code === "originals-changed"
        ? m.conversion_review_originals_changed()
        : diagnostic.message,
    );
    this.#text(
      "p",
      diagnostic.code === "originals-changed"
        ? m.conversion_review_originals_changed_hint()
        : diagnostic.hint,
    );
  }

  #error(error: unknown): void {
    this.#text("p", m.conversion_review_failed());
    this.#text(
      "pre",
      error instanceof ConversionRepairError
        ? repairDiagnostic(error.diagnostic)
        : error instanceof Error
          ? error.message
          : String(error),
    );
    this.#button(m.conversion_review_retry(), () => void this.#prepare());
  }

  #text<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text: string,
    parent = this.contentEl,
  ): HTMLElementTagNameMap[K] {
    const element = this.contentEl.ownerDocument.createElement(tag);
    element.textContent = text;
    parent.append(element);
    return element;
  }

  #button(
    label: string,
    action: (button: HTMLButtonElement) => void | Promise<void>,
  ): HTMLButtonElement {
    const button = this.#text("button", label, this.#footer);
    button.type = "button";
    button.addEventListener("click", () => {
      void Promise.resolve()
        .then(() => action(button))
        .catch((error) => this.#error(error));
    });
    return button;
  }
}

function comparisonLabel(output: ConversionComparison["output"]): string {
  switch (output) {
    case "create":
      return m.conversion_repair_create();
    case "update":
      return m.conversion_repair_update();
    case "filename":
      return m.conversion_repair_filename();
    case "annotation":
      return m.conversion_repair_annotation();
    case "main-citation":
      return m.conversion_repair_main_citation();
    case "alternate-citation":
      return m.conversion_repair_alt_citation();
    case "frontmatter":
      return m.conversion_review_fields();
  }
}
function comparisonOutcome(outcome: ConversionComparison["outcome"]): string {
  switch (outcome) {
    case "matching":
      return m.conversion_repair_matching();
    case "changed":
      return m.conversion_repair_changed();
    case "original-unavailable":
      return m.conversion_repair_unavailable();
    case "candidate-failed":
      return m.conversion_repair_failed();
  }
}

function repairDiagnostic(diagnostic: ConversionRepairDiagnostic): string {
  let message: string;
  switch (diagnostic.code) {
    case "originals-changed":
      message = m.conversion_review_originals_changed();
      break;
    case "no-verification-item":
      message = m.notice_literature_note_template_conversion_no_item();
      break;
    case "no-verification-annotation":
      message = m.conversion_repair_no_annotation();
      break;
    case "copy-missing":
      message = m.conversion_repair_copy_missing();
      break;
    case "copy-invalid":
      message = m.conversion_repair_copy_invalid();
      break;
    case "copy-document-missing":
      message = m.conversion_repair_document_missing();
      break;
    case "copy-loading":
      message = m.conversion_repair_loading();
      break;
    case "baseline-changed":
      message = m.conversion_repair_baseline_changed();
      break;
    case "managed-block-missing":
      message = m.conversion_repair_managed_block_missing();
      break;
    case "javascript-required":
      message = m.conversion_repair_javascript_required({
        fields: diagnostic.fields?.join(", ") ?? "",
      });
      break;
    case "evaluation-failed":
      message = m.conversion_repair_evaluation_failed();
      break;
  }
  return diagnostic.detail ? `${message}\n${diagnostic.detail}` : message;
}
