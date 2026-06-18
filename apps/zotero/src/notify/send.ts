import { type NotifyEvent } from "@zotlit/protocol";

import { logger as appLogger } from "@/lib/logger";
import { prefs } from "@/prefs";

import { notifyEnabled } from "./shared";
import { currentSource } from "./source";

const logger = appLogger.getChild(["notify", "send"]);

/** Distributes `Omit` over a discriminated union, preserving each member. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A {@link NotifyEvent} as built by producers, before {@link createSender} stamps `sourceId`. */
export type NotifyEventInput = DistributiveOmit<NotifyEvent, "sourceId">;

/**
 * POST a {@link NotifyEvent} to every configured Obsidian listener.
 *
 * The event's source identity is stamped here (see {@link currentSource}) so
 * the listener can discard events from a Zotero install it isn't reading.
 *
 * Gated on the `notify` pref (read at send time, so toggling it off stops
 * pushes immediately). `notify-url` is a `;`-separated list of base URLs;
 * each receives the same JSON body at `POST {base}/notify`. Broadcast errors
 * are logged, never thrown — a notification failing must not break the Zotero
 * event that triggered it.
 */
export type Send = (event: NotifyEventInput) => Promise<void>;

export function createSender(): Send {
  return async function send(event) {
    if (!notifyEnabled()) return;

    const raw = prefs.get<string>("extensions.zotlit.notify-url") ?? "";
    const targets = raw
      .split(";")
      .map((url) => url.trim())
      .filter((url) => url.length > 0);
    if (targets.length === 0) return;

    logger.info("dispatching notify event", {
      event: event.event,
      targets: targets.length,
    });
    const body = JSON.stringify({
      ...event,
      ...currentSource(),
    } satisfies NotifyEvent);
    await Promise.all(
      targets.map(async (base) => {
        try {
          await fetch(new URL("/notify", base), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          logger.debug("notified target", { event: event.event, base });
        } catch (error) {
          logger.warn("failed to notify target", {
            event: event.event,
            base,
            error,
          });
        }
      }),
    );
  };
}
