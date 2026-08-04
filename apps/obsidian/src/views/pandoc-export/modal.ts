// The built-in export's one dialog: output format, CSL style, and destination.

import { extname } from "node:path";
import { Modal, Setting, type App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { requireDialog } from "@/lib/require";
import { type DocumentFormat } from "@/services/pandoc/engine";
import {
  listInstalledStyles,
  type InstalledCslStyle,
} from "@/services/pandoc/styles";
import { referencesStyleOptions, STYLE_DEFAULT } from "@/setting-tab/citations";

const logger = getLogger(["views", "pandoc-export"]);

/** The formats the WASM engine writes; PDF needs an external engine. */
const FORMATS: readonly DocumentFormat[] = ["docx", "html"];

/** Extensions the destination stem drops, so the format always names the file. */
const KNOWN_EXTENSIONS = new Set([".md", ".docx", ".html"]);

export interface PandocExportChoices {
  format: DocumentFormat;
  /** CSL style ID, or `null` for the engine's embedded default style. */
  styleId: string | null;
  /** Absolute path the converted document is written to. */
  destination: string;
}

export interface PandocExportModalOptions {
  /** Zotero data directory the installed styles are listed from. */
  dataDir: string;
  /** References style ID — where the style picker starts. */
  referencesStyleId: string | null;
  /** Absolute path of the note being exported; seeds the destination. */
  notePath: string;
}

/**
 * Collect the three choices one export needs.
 *
 * The destination is held as a stem, so the chosen format always names the
 * file and the two can never disagree.
 *
 * @returns the choices, or `null` when the user dismissed the dialog.
 */
export function openPandocExportModal(
  app: App,
  { dataDir, referencesStyleId, notePath }: PandocExportModalOptions,
): Promise<PandocExportChoices | null> {
  const { promise, resolve } =
    Promise.withResolvers<PandocExportChoices | null>();

  let format: DocumentFormat = "docx";
  let styleId = referencesStyleId ?? STYLE_DEFAULT;
  let stem = stemOf(notePath);
  const destination = (): string => `${stem}.${format}`;

  const modal = new Modal(app);
  modal.setTitle(m.pandoc_export_title());
  modal.contentEl.addClass("zt-root");

  new Setting(modal.contentEl)
    .setName(m.pandoc_export_format_name())
    .setDesc(m.pandoc_export_format_desc())
    .addDropdown((dropdown) => {
      for (const value of FORMATS)
        dropdown.addOption(value, formatLabel(value));
      dropdown.setValue(format);
      dropdown.onChange((value) => {
        format = value as DocumentFormat;
        showDestination();
      });
    });

  new Setting(modal.contentEl)
    .setName(m.pandoc_export_style_name())
    .setDesc(m.pandoc_export_style_desc())
    .addDropdown((dropdown) => {
      let styles: readonly InstalledCslStyle[] = [];
      const repopulate = (): void => {
        dropdown.selectEl.replaceChildren();
        for (const { value, label } of referencesStyleOptions(
          styles,
          styleId,
        )) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(styleId);
      };
      repopulate();
      dropdown.onChange((value) => {
        styleId = value;
      });
      // The listing outlives the dropdown only until the modal closes, and a
      // detached dropdown simply repopulates a detached element.
      void listInstalledStyles(dataDir).then((installed) => {
        styles = installed;
        repopulate();
      });
    });

  const destinationSetting = new Setting(modal.contentEl)
    .setName(m.pandoc_export_destination_name())
    .addButton((button) =>
      button
        .setButtonText(m.pandoc_export_destination_browse())
        .onClick(() => void browse()),
    );
  const showDestination = (): void => {
    destinationSetting.setDesc(destination());
  };
  showDestination();

  new Setting(modal.contentEl)
    .addButton((button) =>
      button.setButtonText(m.modal_cancel()).onClick(() => modal.close()),
    )
    .addButton((button) =>
      button
        .setButtonText(m.pandoc_export_confirm())
        .setCta()
        .onClick(() => {
          resolve({
            format,
            styleId: styleId === STYLE_DEFAULT ? null : styleId,
            destination: destination(),
          });
          modal.close();
        }),
    );

  modal.setCloseCallback(() => resolve(null));
  modal.open();
  return promise;

  async function browse(): Promise<void> {
    try {
      const picked = await requireDialog().showSaveDialog({
        title: m.pandoc_export_destination_title(),
        defaultPath: destination(),
        filters: [{ name: formatLabel(format), extensions: [format] }],
      });
      if (picked.canceled || !picked.filePath) return;
      stem = stemOf(picked.filePath);
      showDestination();
    } catch (error) {
      logger.error("Failed to open the export destination dialog", { error });
    }
  }
}

function formatLabel(format: DocumentFormat): string {
  return format === "docx"
    ? m.pandoc_export_format_docx()
    : m.pandoc_export_format_html();
}

function stemOf(path: string): string {
  const ext = extname(path).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? path.slice(0, -ext.length) : path;
}
