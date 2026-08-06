import { type Extension } from "@codemirror/state";
import { type App, type PaneType, type Plugin } from "obsidian";

import {
  getItemIDByCitekey,
  getItemsByID,
  USER_LIBRARY_ID,
  type Item,
} from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { type DatabaseService } from "@/services/database/service";
import { type NoteFeature } from "@/services/note-feature";
import { createNoteWithToast } from "@/services/note-feature/update-single";
import { type NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import { citekeyEditorExtension } from "./extension";

const logger = getLogger("citekey-editor");

export interface CitekeyEditorDeps {
  app: App;
  plugin: Pick<Plugin, "registerEditorExtension">;
  noteIndex: NoteIndex;
  noteFeature: NoteFeature;
  db: DatabaseService;
  settings: SettingsService;
}

interface CitekeyEditorEvents {
  "missing-property": (property: string) => void;
}

/**
 * The citekey editor treatment: literal Pandoc `@citekey` text is marked in the
 * editor and opens its Literature Note on click — the note the Citation Key
 * Property points at, or a note created from the matching Zotero Item.
 *
 * The CodeMirror extension is registered once as a mutable array, so the
 * setting toggles it by rewriting that array and asking Obsidian to
 * reconfigure — the mechanism `registerEditorExtension` documents.
 */
export class CitekeyEditor extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #noteIndex;
  readonly #noteFeature;
  readonly #db;
  readonly #settings;
  readonly #emitter = createNanoEvents<CitekeyEditorEvents>();
  readonly #extension: Extension;

  /** Registered once; its contents are the on/off switch. */
  readonly #extensions: Extension[] = [];

  #enabled = false;
  #missingProperty: string | null = null;

  ready: Promise<void>;

  constructor(deps: CitekeyEditorDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#noteIndex = deps.noteIndex;
    this.#noteFeature = deps.noteFeature;
    this.#db = deps.db;
    this.#settings = deps.settings;
    this.#extension = citekeyEditorExtension((citekey, newLeaf) => {
      void this.#openCitekey(citekey, newLeaf);
    });
    this.ready = this.#load();
  }

  on<K extends keyof CitekeyEditorEvents>(
    event: K,
    cb: CitekeyEditorEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    this.#plugin.registerEditorExtension(this.#extensions);
    stack.defer(() => {
      this.#extensions.length = 0;
      this.#app.workspace.updateOptions();
    });
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );

    this.commit(stack.move());
  }

  #applySettings(settings: Readonly<Settings>): void {
    const enabled = settings["citation.citekey-editor"];
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
    this.#extensions.length = 0;
    if (enabled) this.#extensions.push(this.#extension);
    this.#app.workspace.updateOptions();
    logger.info(enabled ? "Citekey editor enabled" : "Citekey editor disabled");
  }

  /**
   * A citekey with exactly one indexed Literature Note opens it directly.
   * Otherwise the Zotero Item decides: an existing note for its Indexed Key
   * wins, and only a key with no note at all creates one.
   */
  async #openCitekey(
    citekey: string,
    newLeaf: boolean | PaneType,
  ): Promise<void> {
    const { workspace } = this.#app;
    await this.#noteIndex.whenIndexed();

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
