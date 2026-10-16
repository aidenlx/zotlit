// "Save as query file…" in the sidebar's More options menu: a dialog asks the
// name, the folder, and which records the file shows, then writes the
// sidebar's view as a new Query File and opens it in a tab.
//
// @see apps/obsidian/docs/adr/0069-the-annotation-view-is-the-annotations-layout-of-the-query-view.md
import {
  AbstractInputSuggest,
  Modal,
  normalizePath,
  prepareSimpleSearch,
  TextComponent,
} from "obsidian";
import type { App, TFolder } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import {
  dialogFooter,
  field,
  footerButton,
  frameDialog,
  note,
  NOTE_CLASS,
} from "@/setting-tab/profile-dialog";
import {
  QUERY_FILE_EXTENSION,
  untitledName,
} from "@/views/query-view/query-file";

import { savedQueryFileText } from "./sidebar-query";
import type { SaveQueryFileInput, SavedRecords } from "./sidebar-query";

const logger = getLogger(["views", "annot-view", "save-query-file"]);

/** The characters a file name cannot hold on every desktop system. */
const FORBIDDEN = /[*"\\/<>:|?]/;

/** What the dialog gives back: where the file goes, and what it shows. */
interface SaveChoice {
  readonly path: string;
  readonly records: SavedRecords;
}

/** The vault's folders, as the folder field suggests them. */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
  override getSuggestions(query: string): TFolder[] {
    const search = prepareSimpleSearch(query);
    return this.app.vault
      .getAllFolders(true)
      .filter((folder) => search(folder.path) !== null);
  }

  override renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.isRoot() ? "/" : folder.path);
  }
}

function filePath(folder: string, name: string): string {
  const parent = normalizePath(folder.trim());
  return normalizePath(
    `${parent === "/" ? "" : `${parent}/`}${name.trim()}.${QUERY_FILE_EXTENSION}`,
  );
}

class SaveQueryFileModal extends Modal {
  readonly #folder: string;
  readonly #decision = Promise.withResolvers<SaveChoice | null>();
  readonly result = this.#decision.promise;
  #saved = false;

  constructor(app: App, folder: string) {
    super(app);
    this.#folder = folder;
  }

  override onOpen(): void {
    frameDialog(this);
    this.modalEl.addClass("zt-save-query-file-modal");
    this.setTitle(m.annot_view_save_title());
    const body = this.contentEl.createDiv({
      cls: "zt:flex zt:flex-col zt:gap-4",
    });
    // The first `Untitled`, `Untitled 1`, … free in the folder.
    let name = untitledName(
      m.query_file_untitled(),
      (candidate) =>
        this.app.vault.getAbstractFileByPath(
          filePath(this.#folder, candidate),
        ) !== null,
    );
    let folder = this.#folder;
    let records: SavedRecords = "this-item";

    const nameInput = new TextComponent(
      field(body, m.annot_view_save_name_label()),
    );
    nameInput.inputEl.setAttr("data-save-field", "name");
    const folderInput = new TextComponent(
      field(body, m.annot_view_save_folder_label()),
    );
    folderInput.inputEl.setAttr("data-save-field", "folder");
    new FolderSuggest(this.app, folderInput.inputEl).onSelect((chosen) => {
      folderInput.setValue(chosen.isRoot() ? "/" : chosen.path);
      folder = folderInput.getValue();
      update();
    });

    const group = body.createEl("fieldset", {
      cls: "zt:flex zt:flex-col zt:gap-2",
    });
    group.createEl("legend", {
      text: m.annot_view_save_records_label(),
      cls: "zt:mb-2 zt:text-sm zt:leading-(--line-height-tight)",
    });
    const choices: [SavedRecords, string, string?][] = [
      ["this-item", m.annot_view_save_records_this_item()],
      [
        "note-item",
        m.annot_view_save_records_note_item(),
        m.annot_view_save_records_note_item_hint(),
      ],
    ];
    for (const [value, label, hint] of choices) {
      const row = group.createEl("label", {
        cls: "zt:flex zt:items-start zt:gap-2",
      });
      const radio = row.createEl("input", {
        type: "radio",
        value,
        attr: { name: "zotlit-save-query-records", "data-save-records": value },
      });
      radio.checked = value === records;
      radio.addEventListener("change", () => {
        if (radio.checked) records = value;
      });
      const text = row.createDiv({ cls: "zt:min-w-0 zt:flex zt:flex-col" });
      text.createSpan({ text: label, cls: "zt:text-sm" });
      if (hint) text.createSpan({ text: hint, cls: NOTE_CLASS });
    }

    const status = note(body, { status: true });
    const refusal = (): string | null => {
      if (name.trim() === "") return "";
      if (FORBIDDEN.test(name)) return m.annot_view_save_name_characters();
      const path = filePath(folder, name);
      if (this.app.vault.getAbstractFileByPath(path))
        return m.annot_view_save_name_taken({ file: path });
      return null;
    };
    const submit = () => {
      if (refusal() !== null) return;
      this.#saved = true;
      this.#decision.resolve({ path: filePath(folder, name), records });
      this.close();
    };
    const footer = dialogFooter(this);
    const save = footerButton(
      footer,
      m.annot_view_save_action(),
      submit,
    ).setCta();
    footerButton(footer, m.modal_cancel(), () => this.close());
    const update = () => {
      const refused = refusal();
      if (refused === null)
        status.set(m.annot_view_save_file({ file: filePath(folder, name) }));
      else status.set(refused, refused === "" ? "muted" : "error");
      save.setDisabled(refused !== null);
    };
    nameInput.onChange((typed) => {
      name = typed;
      update();
    });
    folderInput.onChange((typed) => {
      folder = typed;
      update();
    });
    for (const input of [nameInput, folderInput])
      input.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) submit();
      });
    nameInput.setValue(name);
    folderInput.setValue(folder);
    update();
    nameInput.inputEl.focus();
    nameInput.inputEl.select();
  }

  override onClose(): void {
    if (!this.#saved) this.#decision.resolve(null);
    this.contentEl.empty();
  }
}

/**
 * Ask where to save the sidebar's view and which records it shows, write the
 * Query File, and open it in a tab.
 */
export async function saveSidebarAsQueryFile(
  app: App,
  input: Omit<SaveQueryFileInput, "records">,
): Promise<void> {
  const parent = app.fileManager.getNewFileParent(
    app.workspace.getActiveFile()?.path ?? "",
  );
  const modal = new SaveQueryFileModal(
    app,
    parent.isRoot() ? "/" : parent.path,
  );
  modal.open();
  const choice = await modal.result;
  if (!choice) return;
  try {
    const folder = choice.path.includes("/")
      ? choice.path.slice(0, choice.path.lastIndexOf("/"))
      : "";
    if (folder && !app.vault.getFolderByPath(folder))
      await app.vault.createFolder(folder);
    const file = await app.vault.create(
      choice.path,
      savedQueryFileText({ ...input, records: choice.records }),
    );
    await app.workspace.getLeaf("tab").openFile(file, { active: true });
  } catch (error) {
    logger.error("Failed to save the sidebar as a Query File", {
      path: choice.path,
      error,
    });
    new BaseNotice(m.annot_view_save_failed());
  }
}
