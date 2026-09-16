// The Zotero Reader as a Reader Session, translated from the companion's pushes.
import { getLogger } from "@/lib/log";
import type {
  LocalServerService,
  ReaderTarget,
} from "@/services/local-server/service";

import { ReaderSessionHost } from "./session";
import type { ReaderSessionTarget } from "./session";

const logger = getLogger("reader-session");

/** What one companion reader push names, in Indexed Keys. */
export interface ZoteroReaderResolution {
  target: ReaderSessionTarget;
  /** Indexed Keys of the Annotations the push reported as selected. */
  selected: readonly string[];
}

export interface ZoteroReaderSessionDeps {
  liveUpdate: Pick<LocalServerService, "readerTarget" | "on">;
  /**
   * Names the Attachment, its parent Item, and the selected Annotations a
   * reader push points at; `null` while the Zotero database cannot answer.
   * The numeric ids the wire carries stop here.
   *
   * @see apps/obsidian/docs/adr/0033-zotero-object-identity-is-the-indexed-key-server-id-is-source-data.md
   */
  resolve: (target: ReaderTarget) => ZoteroReaderResolution | null;
  /** Opens an Annotation in Zotero, which owns every gesture on its own reader. */
  navigate: (annotationKey: string) => void;
}

/**
 * The Zotero Reader, in the same shape as an Obsidian PDF view's session.
 *
 * Zotero drives it one way: the companion pushes what its reader holds and
 * ZotLit translates it. `setSelectedAnnotations` therefore reaches nothing —
 * the companion gains no inbound channel (ADR 0036) — so the session reports
 * only selections Zotero itself announced, rather than claiming one Zotero
 * does not hold.
 */
export class ZoteroReaderSession extends ReaderSessionHost {
  readonly #liveUpdate;
  readonly #resolve;
  readonly #stopTracking: () => void;

  constructor({ liveUpdate, resolve, navigate }: ZoteroReaderSessionDeps) {
    super({
      source: "zotero",
      navigate,
      select: (annotationKeys) =>
        logger.debug("Zotero owns its reader's selection", {
          annotations: annotationKeys.length,
        }),
    });
    this.#liveUpdate = liveUpdate;
    this.#resolve = resolve;
    this.refresh();
    this.#stopTracking = liveUpdate.on("reader/target", (pushed) =>
      this.#track(pushed),
    );
  }

  /**
   * Re-reads the push the listener still holds. A push that arrived before the
   * database could name its keys resolves on the next refresh rather than
   * being lost.
   */
  refresh(): void {
    this.#track(this.#liveUpdate.readerTarget);
  }

  override [Symbol.dispose](): void {
    this.#stopTracking();
    super[Symbol.dispose]();
  }

  #track(pushed: ReaderTarget | null): void {
    const resolution = pushed && this.#resolve(pushed);
    this.setTarget(resolution?.target ?? null);
    this.reportSelection(resolution?.selected ?? []);
  }
}
