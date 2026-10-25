// The Library View Document as the tab holds it: one value in memory that
// every transition changes and plugin data keeps. The document on screen is
// the one held here; plugin data is read once, as the tab opens, and never
// again while a write waits.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import type { EffectBridge } from "@/lib/effect-bridge";
import type { PluginSettings } from "@/services/settings/service";

import {
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
  withText,
} from "./document";
import type { LibraryViewDocument } from "./document";

const KEY = "library.document";

export class LibraryViewStorage {
  readonly #settings: Pick<
    PluginSettings["Service"],
    "update" | "flush" | "current"
  >;
  readonly #bridge;
  readonly #toolbar: () => string | null;
  #held: LibraryViewDocument = DEFAULT_LIBRARY_VIEW_DOCUMENT;
  /** The toolbar's text that {@link #held} has taken in. */
  #taken: string | null = null;
  /** The write to disk under way. */
  #writing: Promise<void> | null = null;
  /** The write to disk that the saves since {@link #writing} began wait for. */
  #queued: Promise<void> | null = null;

  /**
   * @param toolbar the Query View's text as it stands: a toolbar change
   * shows there at once, before the Query View asks to save it.
   */
  constructor(
    settings: Pick<PluginSettings["Service"], "update" | "flush" | "current">,
    bridge: Pick<EffectBridge, "runSync" | "runPromise">,
    toolbar: () => string | null,
  ) {
    this.#settings = settings;
    this.#bridge = bridge;
    this.#toolbar = toolbar;
  }

  /** Read the document plugin data holds. Call it once plugin data has loaded. */
  load(): void {
    this.#held = parseLibraryViewDocument(
      this.#bridge.runSync(this.#settings.current)[KEY],
    );
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
    // Plugin data takes the document at once. The write to disk starts in
    // the next microtask, so the changes of one task, such as a tree
    // selection and the paper it lets go of, share it; a write asked for
    // while one runs waits for it and then writes the latest document, so
    // the arrow keys moving the selection never queue a write per key.
    this.#bridge.runSync(
      this.#settings.update({
        [KEY]: serializeLibraryViewDocument(this.document()),
      }),
    );
    if (this.#queued) return this.#queued;
    const earlier = this.#writing ?? Promise.resolve();
    const queued = earlier
      .catch(() => {})
      .then(() => {
        this.#queued = null;
        const writing = this.#bridge.runPromise(this.#settings.flush);
        this.#writing = writing;
        writing
          .finally(() => {
            if (this.#writing === writing) this.#writing = null;
          })
          .catch(() => {});
        return writing;
      });
    this.#queued = queued;
    return queued;
  }

  /** {@link set}, then {@link save}. */
  change(
    change: (doc: LibraryViewDocument) => LibraryViewDocument,
  ): Promise<void> {
    this.set(change);
    return this.save();
  }
}
