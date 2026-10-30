// One sentence per conversion outcome, shared by the transient notice and the
// Welcome banner so a refusal the notice named stays readable in the view.
import * as m from "@/lib/i18n/generated/messages";
import type { LiteratureNoteTemplateMigrationResult } from "@/services/template/migration";

export function templateMigrationNotice(
  result: LiteratureNoteTemplateMigrationResult,
): string {
  if (result.outcome === "converted") {
    if (result.pendingCleanup.length > 0)
      return m.notice_literature_note_template_conversion_pending_cleanup({
        files: result.pendingCleanup.join(", "),
      });
    return result.kept.length > 0
      ? m.notice_literature_note_template_conversion_kept({
          files: result.kept.join(", "),
        })
      : m.notice_literature_note_template_conversion_success();
  }
  switch (result.diagnostic.code) {
    case "legacy-render-mismatch":
      return m.notice_literature_note_template_conversion_mismatch({
        difference: result.diagnostic.difference,
        files: result.diagnostic.files.join(", "),
      });
    case "unsupported-legacy-template":
      return m.notice_literature_note_template_conversion_unsupported({
        files: result.diagnostic.files.join(", "),
      });
    case "legacy-frontmatter-inert":
      return m.notice_literature_note_template_conversion_frontmatter_inert({
        fields: result.diagnostic.fields.join(", "),
      });
    case "legacy-frontmatter-evaluation":
      return m.notice_literature_note_template_conversion_frontmatter_evaluation(
        { fields: result.diagnostic.fields.join(", ") },
      );
    case "no-verification-item":
      return m.notice_literature_note_template_conversion_no_item();
    case "no-verification-annotation":
      return m.notice_literature_note_template_conversion_no_annotation();
    case "converted-document-exists":
      return m.notice_literature_note_template_conversion_exists();
    case "no-legacy-templates":
      return m.notice_literature_note_template_conversion_none();
  }
}
