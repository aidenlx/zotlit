import type { LastActivitySource } from "@zotlit/item-query";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import type { QueryViewValue } from "@/services/item-query/query-view";
import type { UseKind } from "@/services/use-ledger/service";

interface Use {
  readonly kind: UseKind;
  readonly instant: { readonly epochMilliseconds: number };
}

export const RECENT_REASON_FIELDS = [
  "lastActivity",
  "lastActivitySource",
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

const ZOTERO_MESSAGES: Readonly<
  Record<Exclude<LastActivitySource, "use">, Message>
> = {
  read: m.library_recent_read_zotero,
  note: m.library_recent_notes_edited,
  annotation: m.library_recent_notes_edited,
  added: m.library_recent_added,
};

const USE_MESSAGES: Readonly<Record<UseKind, Message>> = {
  opened: m.library_recent_opened,
  read: m.library_recent_read_obsidian,
  cited: m.library_recent_cited,
};

/**
 * The Last Activity of a row, worded. Item Query picks the signal; the
 * ledger only names the kind of a Use, and only when it is the one the query
 * saw.
 */
export function recentReason(
  values: Readonly<Record<string, QueryViewValue>>,
  use: Use | undefined,
): string | null {
  const { lastActivity, lastActivitySource: source } = values;
  if (typeof lastActivity !== "string" || typeof source !== "string")
    return null;
  let instant: number;
  try {
    instant = Temporal.Instant.from(lastActivity).epochMilliseconds;
  } catch {
    return null;
  }
  // A Use the ledger replaced since the query ran waits for the rerun the
  // change starts.
  const message =
    source === "use"
      ? use?.instant.epochMilliseconds === instant
        ? USE_MESSAGES[use.kind]
        : undefined
      : ZOTERO_MESSAGES[source as Exclude<LastActivitySource, "use">];
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
