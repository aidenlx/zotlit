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
  async save(): Promise<void> {
    this.#settings.update({
      [KEY]: serializeLibraryViewDocument(this.document()),
    });
    await this.#settings.flush();
  }

  /** {@link set}, then {@link save}. */
  change(
    change: (doc: LibraryViewDocument) => LibraryViewDocument,
  ): Promise<void> {
    this.set(change);
    return this.save();
  }
}
