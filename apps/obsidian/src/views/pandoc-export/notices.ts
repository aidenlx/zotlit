// What the user reads when an export cannot start, or stops.

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import type {
  BibliographySource,
  ExportFailure,
} from "@/services/pandoc/export";

/** The engine is the one prerequisite the command cannot supply itself. */
export function showEngineMissing(openSettings: () => void): void {
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_pandoc_export_engine_missing());
      renderer.addAction((button) => {
        button
          .setButtonText(m.references_engine_open_settings())
          .setCta()
          .onClick(() => {
            notice.hide();
            openSettings();
          });
      });
    }),
    0,
  );
}

/**
 * Everything that stops an export: the conversion's own failures, the note's
 * own unusable style, which stops the run before the engine sees it, plus the
 * destination write, which happens after the engine has already answered.
 */
export type ExportProblem =
  | ExportFailure
  | { kind: "document-style-invalid" }
  | { kind: "destination-unwritable"; detail: string };

/** One message per failure arm, each naming the situation and its fix. */
export function showExportFailure(failure: ExportProblem): void {
  new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_pandoc_export_failed());
      switch (failure.kind) {
        case "citation-intent":
          renderer.addList(
            m.pandoc_export_error_citation_intent(),
            failure.linkpaths,
          );
          break;
        case "database-unavailable":
          renderer.addText(
            m.pandoc_export_error_database({ dataDir: failure.dataDir }),
          );
          break;
        case "items-missing":
          renderer.addList(
            m.pandoc_export_error_items_missing(),
            failure.linkpaths,
          );
          break;
        case "citation-keys-missing":
          renderer.addList(
            m.pandoc_export_error_citation_keys_missing(),
            failure.linkpaths,
          );
          break;
        case "zotero-not-running":
          renderer.addText(
            m.pandoc_export_error_zotero_closed({ port: failure.port }),
          );
          break;
        case "local-api-disabled":
          renderer.addText(
            m.pandoc_export_error_local_api({ pref: failure.pref }),
          );
          break;
        case "source-failed":
          renderer.addText(
            m.pandoc_export_error_source({
              source: sourceName(failure.source),
              detail: failure.detail,
            }),
          );
          break;
        case "engine":
          renderer.addText(
            m.pandoc_export_error_engine({ detail: failure.detail }),
          );
          break;
        case "document-style-invalid":
          renderer.addText(m.pandoc_export_error_document_style());
          break;
        case "destination-unwritable":
          renderer.addText(
            m.pandoc_export_error_destination({ detail: failure.detail }),
          );
          break;
      }
    }),
    0,
  );
}

function sourceName(source: BibliographySource): string {
  return source === "better-bibtex"
    ? m.pandoc_export_source_better_bibtex()
    : m.pandoc_export_source_local_api();
}
