import type { LogLevel, LogRecord } from "@logtape/logtape";

const LEVEL_STYLES: Record<LogLevel, string> = {
  trace: "background:#9CA3AF;color:white;padding:1px 4px;border-radius:2px;",
  debug: "background:#5A7FFF;color:white;padding:1px 4px;border-radius:2px;",
  info: "background:#2CC773;color:white;padding:1px 4px;border-radius:2px;",
  warning: "background:#FFA500;color:black;padding:1px 4px;border-radius:2px;",
  error: "background:#DC3545;color:white;padding:1px 4px;border-radius:2px;",
  fatal: "background:#8B0000;color:white;padding:1px 4px;border-radius:2px;",
};

const LEVEL_ABBREVIATIONS: Record<LogLevel, string> = {
  trace: "TRC",
  debug: "DBG",
  info: "INF",
  warning: "WRN",
  error: "ERR",
  fatal: "FTL",
};

function formatTimestamp(epochMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: "millisecond" });
}

function escapeFormat(s: string): string {
  return s.replaceAll("%", "%%");
}

/**
 * DevTools formatter for `getConsoleSink({ formatter })`. Emits a `%c`-styled
 * single line `HH:mm:ss.sss LVL category msg` with structured properties (if
 * any) appended as a trailing `%o`. User-controlled segments (category and
 * message template parts) have `%` doubled so a `%c` / `%o` inside them does
 * not consume our style/value arguments.
 */
export function devToolsFormatter(record: LogRecord): readonly unknown[] {
  const timestamp = formatTimestamp(record.timestamp);
  const levelAbbr = LEVEL_ABBREVIATIONS[record.level] ?? record.level;
  const category = escapeFormat(record.category.join("/"));

  let msg = "";
  const values: unknown[] = [];
  for (let i = 0; i < record.message.length; i++) {
    if (i % 2 === 0) {
      msg += escapeFormat(record.message[i] as string);
    } else {
      msg += "%o";
      values.push(record.message[i]);
    }
  }

  const hasProperties = Object.keys(record.properties).length > 0;

  const formatString = hasProperties
    ? `%c${timestamp}%c %c${levelAbbr}%c %c${category}%c ${msg} %o`
    : `%c${timestamp}%c %c${levelAbbr}%c %c${category}%c ${msg}`;

  const styles = [
    "color:#888;",
    "",
    LEVEL_STYLES[record.level] ?? "",
    "",
    "color:#666;",
    "",
  ];

  if (hasProperties) {
    return [formatString, ...styles, ...values, record.properties];
  }
  return [formatString, ...styles, ...values];
}
