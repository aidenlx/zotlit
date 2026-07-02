import {
  type App,
  TFile,
  type MarkdownFileInfo,
  type MarkdownView,
  type Menu,
  type Plugin,
} from "obsidian";

import { confirm } from "@/lib/confirm";
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import {
  childImportToast,
  reimportNoteByKey,
  runChildImportByKey,
  type NoteImportContext,
  type ReimportResult,
} from "@/services/note-import/batch-import";
import {
  isLiteratureNote,
  itemKeyFromFrontmatter,
  noteKeyFromFrontmatter,
} from "@/services/note-index/service";

import { type NoteFeatureContext } from "./context";
import { overwriteNote, updateNote, type UpdateScope } from "./operations";
import { updateNoteToast } from "./update-single";

interface NoteFeatureActionDeps {
  noteFeatures: NoteFeatureContext;
  noteImportCtx: NoteImportContext;
}

export function addNoteFeatureActions(
  plugin: Pick<Plugin, "addCommand" | "registerEvent"> & { app: Plugin["app"] },
  deps: NoteFeatureActionDeps,
): void {
  addUpdateCommand(plugin, deps, {
    id: "update-note",
    name: m.command_update_note_name(),
    scope: "full",
  });
  addUpdateCommand(plugin, deps, {
    id: "update-note-metadata",
    name: m.command_update_note_metadata_name(),
    scope: "metadata",
  });

  plugin.addCommand({
    id: "overwrite-note",
    name: m.command_overwrite_note_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        void handleOverwriteNote(deps, file, { app: plugin.app, itemKey });
      });
    },
  });

  plugin.addCommand({
    id: "import-child-notes",
    name: m.command_import_child_notes_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (_file, itemKey) => {
        void handleChildImport(deps, itemKey);
      });
    },
  });

  plugin.addCommand({
    id: "reimport-note",
    name: m.command_reimport_note_name(),
    editorCheckCallback(checking, _editor, ctx) {
      return withImportedNote(plugin, { ctx, checking }, (file, noteKey) => {
        void reimportNote(deps, file, noteKey);
      });
    },
  });

  registerFileMenu(plugin, deps);
}

function registerFileMenu(
  plugin: Pick<Plugin, "registerEvent" | "app">,
  deps: NoteFeatureActionDeps,
): void {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file, source) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      if (source === "files-menu") return;
      buildFileMenu(menu, { file, app: plugin.app }, deps);
    }),
  );
}

function buildFileMenu(
  menu: Menu,
  { file, app }: { file: TFile; app: App },
  deps: NoteFeatureActionDeps,
): void {
  const cache = app.metadataCache.getFileCache(file);
  const itemKey = itemKeyFromFrontmatter(cache);
  const noteKey = noteKeyFromFrontmatter(cache);

  if (itemKey) {
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.command_update_note_name())
        .setIcon("refresh-cw")
        .onClick(() => {
          void handleUpdateNote(deps, file, { itemKey, scope: "full" });
        }),
    );
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.command_update_note_metadata_name())
        .setIcon("file-text")
        .onClick(() => {
          void handleUpdateNote(deps, file, { itemKey, scope: "metadata" });
        }),
    );
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.command_overwrite_note_name())
        .setIcon("file-x")
        .onClick(() => {
          void handleOverwriteNote(deps, file, { app, itemKey });
        }),
    );
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.command_import_child_notes_name())
        .setIcon("download")
        .onClick(() => {
          void handleChildImport(deps, itemKey);
        }),
    );
  } else if (noteKey) {
    menu.addItem((item) =>
      item
        .setSection("zotlit")
        .setTitle(m.command_reimport_note_name())
        .setIcon("refresh-cw")
        .onClick(() => {
          void reimportNote(deps, file, noteKey);
        }),
    );
  }
}

async function reimportNote(
  deps: NoteFeatureActionDeps,
  file: TFile,
  noteKey: string,
): Promise<void> {
  const yes = await confirm(
    {
      title: m.modal_reimport_note_title(),
      content: m.modal_reimport_note_desc(),
      action: m.modal_reimport_note_confirm(),
      destructive: true,
    },
    deps.noteFeatures.app,
  );
  if (!yes) return;

  await toast.promise(
    reimportNoteByKey(deps.noteImportCtx, noteKey, file),
    reimportNoteToast(),
  );
}

function reimportNoteToast(): {
  loading: string;
  success: (result: ReimportResult) => string | undefined;
  error: string;
} {
  return {
    loading: m.notice_reimporting_note(),
    success: reimportNoteNotice,
    error: m.notice_reimport_note_failed(),
  };
}

function reimportNoteNotice(result: ReimportResult): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "not-found":
      return m.notice_protocol_item_not_found();
    case "created":
    case "overwritten":
      return m.notice_reimported_note();
    case "skipped":
      return m.notice_reimport_note_skipped();
    default:
      return undefined;
  }
}

/**
 * Register an editor command that updates the active literature note at the
 * given {@link UpdateScope}.
 */
function addUpdateCommand(
  plugin: Pick<Plugin, "addCommand"> & { app: Plugin["app"] },
  deps: NoteFeatureActionDeps,
  command: { id: string; name: string; scope: UpdateScope },
): void {
  plugin.addCommand({
    id: command.id,
    name: command.name,
    editorCheckCallback(checking, _editor, ctx) {
      return withLiteratureNote(plugin, { ctx, checking }, (file, itemKey) => {
        void handleUpdateNote(deps, file, { itemKey, scope: command.scope });
      });
    },
  });
}

function handleUpdateNote(
  deps: NoteFeatureActionDeps,
  file: TFile,
  opts: { itemKey: string; scope: UpdateScope },
): Promise<void> {
  return toast.promise(
    updateNote(deps.noteFeatures, file, {
      indexedKey: opts.itemKey,
      scope: opts.scope,
    }),
    updateNoteToast(opts.scope),
  );
}

async function handleOverwriteNote(
  deps: NoteFeatureActionDeps,
  file: TFile,
  opts: { app: App; itemKey: string },
): Promise<void> {
  const yes = await confirm(
    {
      title: m.modal_overwrite_note_title(),
      content: m.modal_overwrite_note_desc(),
      action: m.modal_overwrite_note_confirm(),
      destructive: true,
    },
    opts.app,
  );
  if (!yes) return;
  await toast.promise(overwriteNote(deps.noteFeatures, file, opts.itemKey), {
    loading: m.notice_overwriting_note(),
    success: m.notice_overwrote_note(),
    error: m.notice_overwrite_note_failed(),
  });
}

function handleChildImport(
  deps: NoteFeatureActionDeps,
  itemKey: string,
): Promise<void> {
  return toast.promise(
    runChildImportByKey(deps.noteImportCtx, itemKey),
    childImportToast(),
  );
}

function withLiteratureNote(
  plugin: Pick<Plugin, "app">,
  options: { ctx: MarkdownView | MarkdownFileInfo; checking: boolean },
  run: (file: TFile, itemKey: string) => void,
): boolean {
  const file = options.ctx.file;
  if (!(file instanceof TFile) || !isLiteratureNote(file, plugin.app)) {
    return false;
  }
  const itemKey = itemKeyFromFrontmatter(
    plugin.app.metadataCache.getFileCache(file),
  );
  if (!itemKey) return false;
  if (!options.checking) run(file, itemKey);
  return true;
}

function withImportedNote(
  plugin: Pick<Plugin, "app">,
  options: { ctx: MarkdownView | MarkdownFileInfo; checking: boolean },
  run: (file: TFile, noteKey: string) => void,
): boolean {
  const file = options.ctx.file;
  if (!(file instanceof TFile)) return false;
  const noteKey = noteKeyFromFrontmatter(
    plugin.app.metadataCache.getFileCache(file),
  );
  if (!noteKey) return false;
  if (!options.checking) run(file, noteKey);
  return true;
}
