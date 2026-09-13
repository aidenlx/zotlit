import { Modal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";

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
        "prepare" | "activate"
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
    this.#text("pre", error instanceof Error ? error.message : String(error));
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
    button.addEventListener("click", () => void action(button));
    return button;
  }
}
