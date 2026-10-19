// The Library View Document as the tab holds it: one value in memory that
// every transition changes and plugin data keeps. The document on screen is
// the one held here; plugin data is read once, as the tab opens, and never
// again while a write waits.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import type { SettingsService } from "@/services/settings/service";

import {
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
  withText,
} from "./document";
import type { LibraryViewDocument } from "./document";

const KEY = "library.document";

export class LibraryViewStorage {
  readonly #settings: Pick<SettingsService, "update" | "flush" | "current">;
  readonly #toolbar: () => string | null;
  #held: LibraryViewDocument = DEFAULT_LIBRARY_VIEW_DOCUMENT;
  /** The toolbar's text that {@link #held} has taken in. */
  #taken: string | null = null;
  /** The write to disk that the saves of this task wait for. */
  #write: Promise<void> | null = null;

  /**
   * @param toolbar the Query View's text as it stands: a toolbar change
   * shows there at once, before the Query View asks to save it.
   */
  constructor(
    settings: Pick<SettingsService, "update" | "flush" | "current">,
    toolbar: () => string | null,
  ) {
    this.#settings = settings;
    this.#toolbar = toolbar;
  }

  /** Read the document plugin data holds. Call it once plugin data has loaded. */
  load(): void {
    this.#held = parseLibraryViewDocument(this.#settings.current?.[KEY]);
    this.#taken = this.#toolbar();
  }

  /** The document on screen, with the toolbar's last change in it. */
  document(): LibraryViewDocument {
    const text = this.#toolbar();
    if (text !== null && text !== this.#taken) {
      this.#held = withText(this.#held, text);
      this.#taken = text;
    }
    return this.#held;
  }

  /** Change the document on screen; {@link save} keeps it. */
  set(change: (doc: LibraryViewDocument) => LibraryViewDocument): void {
    this.#held = change(this.document());
  }

  /**
   * Keep the document on screen in plugin data. Settles once `data.json`
   * holds it; rejects where the write failed, so the toolbar says the
   * change is not saved.
   */
  save(): Promise<void> {
    // Plugin data takes the document at once, so the write that unloading
    // the plugin starts holds it; changes made in one task, such as a tree
    // selection and the paper it lets go of, share one write to disk.
    this.#settings.update({
      [KEY]: serializeLibraryViewDocument(this.document()),
    });
    this.#write ??= Promise.resolve().then(() => {
      this.#write = null;
      return this.#settings.flush();
    });
    return this.#write;
  }

  /**
   * {@link set}, and hand the document to plugin data, which writes it to
   * disk once changes pause, or as the plugin unloads: for a change that
   * comes many to a second, such as the arrow keys moving the selection.
   */
  keep(change: (doc: LibraryViewDocument) => LibraryViewDocument): void {
    this.set(change);
    this.#settings.update({
      [KEY]: serializeLibraryViewDocument(this.document()),
    });
  }

  /** {@link set}, then {@link save}. */
  change(
    change: (doc: LibraryViewDocument) => LibraryViewDocument,
  ): Promise<void> {
    this.set(change);
    return this.save();
  }
}
