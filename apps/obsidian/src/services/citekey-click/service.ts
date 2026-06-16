import { around } from "monkey-around";
import {
  MarkdownView,
  type App,
  type ClickableToken,
  type Editor,
  type EditorPosition,
  type MarkdownEditView,
  type PaneType,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";

import {
  getItemIDByCitekey,
  getItemsByID,
  USER_LIBRARY_ID,
  type Item,
} from "@zotlit/db";

import { registerEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import { type DatabaseService } from "@/services/database/service";
import { type NoteFeatures } from "@/services/note-feature/service";
import { type NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import { type SettingsService } from "@/services/settings/service";

import { citationAtOffset } from "./parse";

const logger = getLogger("citekey-click");

/** Marker on a synthetic token telling our patch to create-then-open. */
const CREATE_MARKER = "zotero";

export interface CitekeyClickDeps {
  app: App;
  noteIndex: NoteIndex;
  noteFeatures: NoteFeatures;
  db: DatabaseService;
  settings: SettingsService;
}

/**
 * Makes `@citekey` text clickable in the editor. Obsidian's native
 * `getClickableTokenAt` ignores Pandoc citation keys, so this service wraps it
 * (and `triggerClickableToken`) on the live `Editor` / `MarkdownEditView`
 * prototypes: a key that already has a literature note opens it, otherwise the
 * click creates the note from the matching Zotero item.
 */
export class CitekeyClick extends Service<void> {
  readonly #app;
  readonly #noteIndex;
  readonly #noteFeatures;
  readonly #db;
  readonly #settings;

  #uninstall: (() => void) | null = null;
  #installing = false;
  #disposed = false;

  ready: Promise<void>;

  constructor(deps: CitekeyClickDeps) {
    super();
    this.#app = deps.app;
    this.#noteIndex = deps.noteIndex;
    this.#noteFeatures = deps.noteFeatures;
    this.#db = deps.db;
    this.#settings = deps.settings;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const { workspace } = this.#app;

    stack.defer(() => {
      this.#disposed = true;
      this.#uninstall?.();
      this.#uninstall = null;
    });

    // The prototypes only exist once a markdown editor has loaded. Keep trying
    // on layout changes until one is available; the patch installs once.
    stack.use(
      registerEvent(
        workspace.on("layout-change", () => void this.#tryInstall()),
      ),
    );
    workspace.onLayoutReady(() => void this.#tryInstall());

    this.commit(stack.move());
  }

  async #tryInstall(): Promise<void> {
    if (this.#disposed || this.#uninstall || this.#installing) return;
    this.#installing = true;
    try {
      const view = await firstLoadedMarkdownView(this.#app.workspace);
      if (!view?.editMode || this.#disposed || this.#uninstall) return;
      this.#uninstall = this.#patch(view.editor, view.editMode);
      logger.info("Citekey click patched");
    } finally {
      this.#installing = false;
    }
  }

  /** Wrap both prototype methods; returns a combined uninstaller. */
  #patch(editor: Editor, editMode: MarkdownEditView): () => void {
    const noteIndex = this.#noteIndex;
    const createAndOpen = (text: string, newLeaf: boolean | PaneType) =>
      this.#createAndOpen(text, newLeaf);

    const restoreEditor = around(Object.getPrototypeOf(editor) as Editor, {
      getClickableTokenAt: (next) =>
        function (this: Editor, pos: EditorPosition): ClickableToken | null {
          return next.call(this, pos) ?? findCitekeyToken(this, pos, noteIndex);
        },
    });
    const restoreEditMode = around(
      Object.getPrototypeOf(editMode) as MarkdownEditView,
      {
        triggerClickableToken: (next) =>
          function (
            this: MarkdownEditView,
            token: ClickableToken,
            newLeaf: boolean | PaneType,
          ): void {
            if ((token as CreateToken).citekey === CREATE_MARKER) {
              void createAndOpen(token.text, newLeaf);
              return;
            }
            next.call(this, token, newLeaf);
          },
      },
    );

    return () => {
      restoreEditor();
      restoreEditMode();
    };
  }

  async #createAndOpen(
    citekey: string,
    newLeaf: boolean | PaneType,
  ): Promise<void> {
    const { workspace } = this.#app;

    // A note may have appeared between building the token and the click.
    const existing = this.#noteIndex.getNotesByCitekey(citekey).sort()[0];
    if (existing) {
      await workspace.openLinkText(existing, "", newLeaf, { active: true });
      return;
    }

    if (this.#db.state !== "ready") {
      new BaseNotice(m.notice_citekey_db_unavailable({ citekey }));
      return;
    }
    const item = this.#resolveItem(citekey);
    if (!item) {
      new BaseNotice(m.notice_citekey_not_found({ citekey }));
      return;
    }

    let file: TFile;
    try {
      file = await toast.promise(this.#noteFeatures.create(item), {
        loading: m.notice_creating_note(),
        success: m.notice_created_note(),
        error: m.notice_create_note_failed(),
        swallowError: false,
      });
    } catch {
      // toast.promise already surfaced the failure to the user.
      return;
    }
    await workspace.openLinkText(file.path, "", true, { active: true });
  }

  /** Resolve the Zotero item for `citekey` in the configured citation library. */
  #resolveItem(citekey: string): Item | null {
    const client = this.#db.client;
    const libraryID =
      this.#settings.current?.["zotero.citation-library"] ?? USER_LIBRARY_ID;
    const itemID = getItemIDByCitekey(client, libraryID, citekey);
    if (itemID == null) return null;
    const [item] = getItemsByID(client, libraryID, [itemID]);
    return item ?? null;
  }
}

type CreateToken = ClickableToken & { citekey?: string };

/**
 * Build a clickable token for the `@citekey` at `pos`, or `null` when there is
 * none. An indexed citekey resolves straight to its note path; an unindexed one
 * carries the {@link CREATE_MARKER} so the trigger patch creates the note.
 */
function findCitekeyToken(
  editor: Editor,
  pos: EditorPosition,
  noteIndex: NoteIndex,
): ClickableToken | null {
  const token = citationAtOffset(editor.getLine(pos.line), pos.ch);
  if (!token) return null;

  const range = {
    start: { line: pos.line, ch: token.start },
    end: { line: pos.line, ch: token.end },
  };
  const existing = noteIndex.getNotesByCitekey(token.citekey).sort()[0];
  if (existing) {
    return { type: "internal-link", text: existing, ...range };
  }
  const createToken: CreateToken = {
    type: "internal-link",
    text: token.citekey,
    citekey: CREATE_MARKER,
    ...range,
  };
  return createToken;
}

async function firstLoadedMarkdownView(
  workspace: App["workspace"],
): Promise<MarkdownView | null> {
  for (const leaf of workspace.getLeavesOfType("markdown")) {
    const view = await ensureMarkdownView(leaf);
    if (view?.editMode) return view;
  }
  return null;
}

async function ensureMarkdownView(
  leaf: WorkspaceLeaf,
): Promise<MarkdownView | null> {
  if (!(leaf.view instanceof MarkdownView)) await leaf.loadIfDeferred();
  return leaf.view instanceof MarkdownView ? leaf.view : null;
}
