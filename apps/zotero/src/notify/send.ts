import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import type { NotifyEvent } from "@zotlit/protocol";

import { logger as appLogger } from "@/lib/logger";

import { notifyEnabled, notifyUrl } from "./shared";
import { sourceDebugDirs, sourceId } from "./source";

const logger = appLogger.getChild(["notify", "send"]);

/** Distributes `Omit` over a discriminated union, preserving each member. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A {@link NotifyEvent} as built by producers, before {@link createSender} stamps the debug dirs. */
export type NotifyEventInput = DistributiveOmit<
  NotifyEvent,
  "profilePath" | "dataPath"
>;

/**
 * POST a {@link NotifyEvent} to the configured Obsidian listener.
 *
 * The source identity travels in the {@link SOURCE_ID_HEADER} header (see
 * {@link sourceId}) so the listener can discard events from a Zotero install it
 * isn't reading.
 *
 * Gated on the `notify` pref (read at send time, so toggling it off stops
 * pushes immediately). `notify-url` is the listener base URL for
 * `POST {base}/notify`. Errors are logged, never thrown — a notification
 * failing must not break the Zotero event that triggered it.
 */
export type Send = (event: NotifyEventInput) => Promise<void>;

export function createSender(): Send {
  return async function send(event) {
    if (!notifyEnabled()) return;

    const base = notifyUrl();
    if (!base) return;

    logger.info("dispatching notify event", { event: event.event, base });
    const body = JSON.stringify({
      ...event,
      ...sourceDebugDirs(),
    } satisfies NotifyEvent);
    try {
      await fetch(new URL("/notify", base), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
          [SOURCE_ID_HEADER]: sourceId(),
        },
        body,
      });
      logger.debug("notified listener", { event: event.event, base });
    } catch (error) {
      logger.warn("failed to notify listener", {
        event: event.event,
        base,
        error,
      });
    }
  };
}
