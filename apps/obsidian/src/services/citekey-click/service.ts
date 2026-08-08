import { around } from "monkey-around";
import { MarkdownView } from "obsidian";
import type {
  App,
  ClickableToken,
  Editor,
  EditorPosition,
  MarkdownEditView,
  PaneType,
  WorkspaceLeaf,
} from "obsidian";

import { getItemIDByCitekey, getItemsByID, USER_LIBRARY_ID } from "@zotlit/db";
import type { Item } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { DatabaseService } from "@/services/database/service";
import type { NoteFeature } from "@/services/note-feature";
import { createNoteWithToast } from "@/services/note-feature/update-single";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { citationAtOffset } from "./parse";

const logger = getLogger("citekey-click");

/** Marker on a synthetic token telling our patch to create-then-open. */
const CREATE_MARKER = "zotero";

export interface CitekeyClickDeps {
  app: App;
  noteIndex: NoteIndex;
  noteFeature: NoteFeature;
  db: DatabaseService;
  settings: SettingsService;
  install?: () => Promise<(() => void) | null>;
}

interface CitekeyClickEvents {
  "missing-property": (property: string) => void;
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
  readonly #noteFeature;
  readonly #db;
  readonly #settings;
  readonly #install;
  readonly #emitter = createNanoEvents<CitekeyClickEvents>();

  #uninstall: (() => void) | null = null;
  #installing = false;
  #disposed = false;
  #enabled = false;
  #missingProperty: string | null = null;

  ready: Promise<void>;

  constructor(deps: CitekeyClickDeps) {
    super();
    this.#app = deps.app;
    this.#noteIndex = deps.noteIndex;
    this.#noteFeature = deps.noteFeature;
    this.#db = deps.db;
    this.#settings = deps.settings;
    this.#install =
      deps.install ??
      (async () => {
        const view = await firstLoadedMarkdownView(this.#app.workspace);
        return view?.editMode ? this.#patch(view.editor, view.editMode) : null;
      });
    this.ready = this.#load();
  }

  on<K extends keyof CitekeyClickEvents>(
    event: K,
    cb: CitekeyClickEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;
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
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );

    this.commit(stack.move());
  }

  async #tryInstall(): Promise<void> {
    if (!this.#enabled || this.#disposed || this.#uninstall || this.#installing)
      return;
    this.#installing = true;
    try {
      const uninstall = await this.#install();
      if (!uninstall) return;
      if (!this.#enabled || this.#disposed || this.#uninstall) {
        uninstall();
        return;
      }
      this.#uninstall = uninstall;
      logger.info("Citation key links patched");
    } finally {
      this.#installing = false;
    }
  }

  #applySettings(settings: Readonly<Settings>): void {
    const enabled = settings["citation.key-links"];
    const property = settings["citation.key-links-frontmatter-key"];
    const missingProperty =
      enabled &&
      !settings["note.frontmatter-fields"].some(
        (field) => field.key === property,
      )
        ? property
        : null;
    if (missingProperty !== null && missingProperty !== this.#missingProperty) {
      this.#emitter.emit("missing-property", property);
    }
    this.#missingProperty = missingProperty;

    if (enabled === this.#enabled) return;
    this.#enabled = enabled;
    if (enabled) {
      void this.#tryInstall();
      return;
    }
    this.#uninstall?.();
    this.#uninstall = null;
    logger.info("Citation key links unpatched");
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
    await this.#noteIndex.whenIndexed();

    // A note may have appeared between building the token and the click.
    const directMatches = this.#noteIndex.getNotesByCitationKey(citekey);
    if (directMatches.length === 1) {
      const existing = directMatches[0]!;
      await workspace.openLinkText(existing.path, "", newLeaf, {
        active: true,
      });
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

    const authoritative = this.#noteIndex.getNotesByItemKey(item.indexedKey)[0];
    if (authoritative) {
      await workspace.openLinkText(authoritative.path, "", newLeaf, {
        active: true,
      });
      return;
    }

    const file = await createNoteWithToast(this.#noteFeature, item);
    if (!file) return;
    await workspace.openLinkText(file.path, "", true, { active: true });
  }

  /** Resolve the Zotero item for `citekey` in the configured citation library. */
  #resolveItem(citekey: string): Item | null {
    const client = this.#db.client;
    const libraryID =
      this.#settings.current?.["zotero.citation-library"] ?? USER_LIBRARY_ID;
    const itemID = getItemIDByCitekey(client, libraryID, citekey);
    if (itemID == null) return null;
    const [item] = getItemsByID(client, [itemID]);
    return item ?? null;
  }
}

type CreateToken = ClickableToken & { citekey?: string };

/**
 * Build a clickable token for the `@citekey` at `pos`, or `null` when there is
 * none. Exactly one indexed citation-key match resolves straight to its note
 * path; zero or multiple matches carry the {@link CREATE_MARKER} so the click
 * can resolve the Zotero item and authoritative item-key index.
 */
export function findCitekeyToken(
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
  const matches = noteIndex.getNotesByCitationKey(token.citekey);
  if (matches.length === 1) {
    const existing = matches[0]!;
    return { type: "internal-link", text: existing.path, ...range };
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
