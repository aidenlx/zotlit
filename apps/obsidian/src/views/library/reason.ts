import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import type { QueryViewValue } from "@/services/item-query/query-view";
import type { Use } from "@/services/use-ledger/service";

export const RECENT_REASON_FIELDS = [
  "dateAdded",
  "lastRead",
  "notes[].dateModified",
  "annotations[].dateModified",
] as const;

type Message = (inputs: { time: string }) => string;

let relativeTime:
  | { locale: string; formatter: Intl.RelativeTimeFormat }
  | undefined;

function timeFormatter(): Intl.RelativeTimeFormat {
  const locale = runtime.getLocale();
  if (relativeTime?.locale !== locale)
    relativeTime = {
      locale,
      formatter: new Intl.RelativeTimeFormat(locale, { numeric: "always" }),
    };
  return relativeTime.formatter;
}

/** The newest activity, using the same signals as Last Activity. */
export function recentReason(
  values: Readonly<Record<string, QueryViewValue>>,
  use: Use | undefined,
): string | null {
  let instant = -Infinity;
  let message: Message | undefined;
  const consider = (value: QueryViewValue | undefined, candidate: Message) => {
    const dates = Array.isArray(value) ? value : [value];
    for (const date of dates) {
      if (typeof date !== "string") continue;
      let timestamp: number;
      try {
        timestamp = Temporal.Instant.from(date).epochMilliseconds;
      } catch {
        continue;
      }
      if (timestamp > instant) {
        instant = timestamp;
        message = candidate;
      }
    }
  };
  // A Zotero-only tie keeps the read, then the note edit, then the addition.
  consider(values.lastRead, m.library_recent_read_zotero);
  consider(values["notes[].dateModified"], m.library_recent_notes_edited);
  consider(values["annotations[].dateModified"], m.library_recent_notes_edited);
  consider(values.dateAdded, m.library_recent_added);
  if (use && use.instant.epochMilliseconds >= instant) {
    instant = use.instant.epochMilliseconds;
    message = {
      opened: m.library_recent_opened,
      read: m.library_recent_read_obsidian,
      cited: m.library_recent_cited,
    }[use.kind];
  }
  if (!message) return null;
  const seconds = (instant - Temporal.Now.instant().epochMilliseconds) / 1000;
  const magnitude = Math.abs(seconds);
  const [divisor, unit]: [number, Intl.RelativeTimeFormatUnit] =
    magnitude >= 86_400
      ? [86_400, "day"]
      : magnitude >= 3_600
        ? [3_600, "hour"]
        : magnitude >= 60
          ? [60, "minute"]
          : [1, "second"];
  const time = timeFormatter().format(Math.round(seconds / divisor), unit);
  return message({ time });
}
