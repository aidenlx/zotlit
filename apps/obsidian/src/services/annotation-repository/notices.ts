// The one place the user is told why editing is blocked: the imperative shell
// over `capability-notices.ts`, which decides what is said and how often.
//
// @see apps/obsidian/policies/ui-seams.md
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { Service } from "@/services/service-base";
import type { ZoteroLocalApiClient } from "@/services/zotero-local-api/service";

import {
  allowEditingNotice,
  CapabilityNoticeLedger,
} from "./capability-notices";
import type { CapabilityNotice } from "./capability-notices";
import type { AnnotationRepository } from "./service";

const logger = getLogger("annotation-repository");

/** How long a notice the user need not answer stays on screen. */
const NOTICE_DURATION = Temporal.Duration.from({ seconds: 10 });

/**
 * Renders one {@link CapabilityNotice}. Separate from the triggers above it so
 * `/obsidian-debug` can put any of them on screen without first arranging the
 * state that would raise it.
 *
 * @param runAction what the notice's one action runs — the "Zotero editing"
 *   settings row for a capability notice, the card itself for a conflict.
 */
export function showCapabilityNotice(
  { title, lines, sticky, action }: CapabilityNotice,
  runAction: () => void,
): BaseNotice {
  const notice = new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(title);
      for (const line of lines) renderer.addText(line);
      if (action === null) return;
      renderer.addAction((button) => {
        button
          .setButtonText(action)
          .setCta()
          .onClick(() => {
            notice.hide();
            runAction();
          });
      });
    }),
    sticky ? 0 : NOTICE_DURATION.total("milliseconds"),
  );
  return notice;
}

export interface CapabilityNoticesDeps {
  /**
   * The Editing Capability, per Attachment, the probe a gesture runs, and what
   * a write left on one Annotation — which is where a Write Conflict is heard.
   */
  capabilities: Pick<
    AnnotationRepository,
    "capabilityFor" | "mutationFor" | "on" | "probe"
  >;
  /**
   * What a refused write, a swapped database and a retired mark are heard on,
   * and the one request Allow editing sends.
   */
  writes: Pick<ZoteroLocalApiClient, "authorize" | "on">;
  /** Reveals the "Zotero editing" settings row. */
  openEditingSettings: () => void;
  /** Whether an Annotation View on screen already shows this card. */
  cardShown: (annotationKey: string) => boolean;
  /** Opens the Annotation View and brings one Annotation's card forward. */
  revealAnnotation: (annotationKey: string) => void;
  now?: () => Temporal.Instant;
  /**
   * Puts one notice on screen.
   *
   * @default showCapabilityNotice
   */
  showNotice?: (notice: CapabilityNotice, runAction: () => void) => void;
}

/**
 * The Editing Capability's UI seam: the two gestures both of its renderers
 * hand over, and the notices a blocked gesture or a refused write earns. Every
 * "once per …" rule lives in the ledger, so this holds no state of its own
 * beyond the ledger it renders.
 *
 * @see https://github.com/aidenlx/zotlit/issues/1147
 */
export class CapabilityNotices extends Service<void> {
  readonly #capabilities;
  readonly #writes;
  readonly #openEditingSettings;
  readonly #cardShown;
  readonly #revealAnnotation;
  readonly #ledger;
  readonly #showNotice;

  ready: Promise<void>;

  constructor({
    capabilities,
    writes,
    openEditingSettings,
    cardShown,
    revealAnnotation,
    now = () => Temporal.Now.instant(),
    showNotice = showCapabilityNotice,
  }: CapabilityNoticesDeps) {
    super();
    this.#capabilities = capabilities;
    this.#writes = writes;
    this.#openEditingSettings = openEditingSettings;
    this.#cardShown = cardShown;
    this.#revealAnnotation = revealAnnotation;
    this.#ledger = new CapabilityNoticeLedger(now);
    this.#showNotice = showNotice;
    this.ready = this.#load();
  }

  /**
   * Allow editing, from every entry that offers it: ask Zotero once, then say
   * what its answer left. An Allow's notice offers this same gesture again;
   * nothing here asks a second time on its own.
   *
   * @returns when Zotero has answered and its notice, if any, is on screen.
   * @see apps/obsidian/docs/adr/0038-write-authorization-starts-only-from-a-user-gesture.md
   */
  async allowEditing(): Promise<void> {
    const result = await this.#writes.authorize();
    const notice = allowEditingNotice(result);
    if (!notice) return;
    this.#showNotice(notice, () => void this.allowEditing());
  }

  /**
   * The reader's held-draft Allow editing: re-check Zotero, then open the
   * "Zotero editing" settings row, which both explains the state and offers the
   * gestures that change it — rendering the same enum from the same copy table.
   *
   * @returns when the row is open, so a caller need not count microtasks to
   *   know the gesture is done. The reader ignores it.
   */
  async showEditingCapability(): Promise<void> {
    await this.#capabilities.probe();
    this.#openEditingSettings();
  }

  /**
   * An edit gesture met a block on this Attachment, with a fresh Capability
   * Probe already behind it.
   *
   * @param attachmentKey the Attachment's Indexed Key.
   */
  reportBlockedGesture(attachmentKey: string): void {
    const capability = this.#capabilities.capabilityFor(attachmentKey);
    const notice = this.#ledger.blockedGesture(attachmentKey, capability);
    if (!notice) return;
    logger.debug("An edit gesture met a block", { attachmentKey, capability });
    this.#showNotice(notice, this.#openEditingSettings);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(
      this.#capabilities.on("capability-changed", () => {
        this.#ledger.refresh((attachmentKey) =>
          this.#capabilities.capabilityFor(attachmentKey),
        );
      }),
    );
    // A conflict the user cannot see is a change lost in silence, so the one
    // notice that answers it is the way to the card.
    stack.defer(
      this.#capabilities.on("write-conflict", (annotationKey) => {
        this.#conflicted(annotationKey);
      }),
    );
    // A card that settled back to any other state has no conflict standing on
    // it, so the next one is news rather than the same one twice.
    stack.defer(
      this.#capabilities.on("mutation-changed", (annotationKey) => {
        if (this.#capabilities.mutationFor(annotationKey).kind === "conflict") {
          return;
        }
        this.#ledger.conflictResolved(annotationKey);
      }),
    );
    stack.defer(
      this.#writes.on("write-refused", (failure, library) => {
        this.#show(this.#ledger.writeRefused(failure, library));
      }),
    );
    stack.defer(
      this.#writes.on("server-changed", (serverID) => {
        this.#show(this.#ledger.serverChanged(serverID));
      }),
    );
    stack.defer(
      this.#writes.on("write-refusals-retired", () => {
        this.#ledger.writeRefusalsRetired();
      }),
    );
    this.commit(stack.move());
  }

  /**
   * One Write Conflict, where no Annotation View is showing its card. A view
   * that already shows it says everything this notice would, in the place the
   * user resolves it.
   */
  #conflicted(annotationKey: string): void {
    if (this.#cardShown(annotationKey)) return;
    const notice = this.#ledger.conflictOffScreen(annotationKey);
    if (!notice) return;
    logger.debug("A write conflict stands on a card no view shows", {
      annotationKey,
    });
    this.#showNotice(notice, () => this.#revealAnnotation(annotationKey));
  }

  #show(notice: CapabilityNotice | null): void {
    if (notice) this.#showNotice(notice, this.#openEditingSettings);
  }
}
