// How a vault cell reads a value of the frontmatter, as a Bases cell shows
// it: a value that is one whole link shows as that link, and a tag without
// its `#`. A date shows, and edits, in a native date field, in the system's
// form; the fields take and give the forms the Properties panel writes:
// `YYYY-MM-DD`, and `YYYY-MM-DDTHH:mm:ss`.
//
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { regex } from "arkregex";

/** A value that is one whole link: to a note, or out of the vault. */
export interface VaultLink {
  readonly kind: "internal" | "external";
  /** The link text of a note, or the address. */
  readonly target: string;
  /** What the link shows. */
  readonly text: string;
}

const WIKILINK = regex(
  "^\\[\\[(?<target>[^\\[\\]|]+)(?:\\|(?<alias>[^\\[\\]]+))?\\]\\]$",
);
const MARKDOWN_LINK = regex(
  "^\\[(?<text>[^\\[\\]]*)\\]\\((?<target>[^()\\s]+)\\)$",
);
const URL = regex("^[a-z][a-z0-9+.-]*://\\S+$", "i");
const EMAIL = regex("^[^\\s@:/]+@[^\\s@:/]+\\.[^\\s@:/]+$");

/** The link a value is, where the whole of it is one; else `null`. */
export function linkOf(value: string): VaultLink | null {
  const text = value.trim();
  const wiki = WIKILINK.exec(text);
  if (wiki) {
    const target = wiki.groups.target.trim();
    return {
      kind: "internal",
      target,
      text: wiki.groups.alias?.trim() || target,
    };
  }
  const markdown = MARKDOWN_LINK.exec(text);
  if (markdown) {
    const { target } = markdown.groups;
    const external = URL.test(target);
    return {
      kind: external ? "external" : "internal",
      target: external ? target : safeDecode(target),
      text: markdown.groups.text || target,
    };
  }
  if (URL.test(text)) return { kind: "external", target: text, text };
  if (EMAIL.test(text))
    return { kind: "external", target: `mailto:${text}`, text };
  return null;
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

/** The date types, which show and edit in a native field. */
export type DateType = "date" | "datetime";

const DATE = regex(
  "^(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})(?:[T ](?<hour>\\d{2}):(?<minute>\\d{2})(?::(?<second>\\d{2}))?)?$",
);

/** The parts of a stored date, or a date and time; `null` for other text. */
function partsOf(type: DateType, value: string) {
  const match = DATE.exec(value.trim());
  if (!match) return null;
  const { year, month, day, hour, minute, second } = match.groups;
  if (type === "datetime" && hour === undefined) return null;
  try {
    const plain = Temporal.PlainDateTime.from(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour ?? 0),
        minute: Number(minute ?? 0),
        second: Number(second ?? 0),
      },
      { overflow: "reject" },
    );
    return { plain, year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

/** The value a native date field takes for a stored one; empty for no date. */
export function dateInputValue(type: DateType, value: string): string {
  const parts = partsOf(type, value);
  if (!parts) return "";
  const { year, month, day, hour, minute, second } = parts;
  const date = `${year}-${month}-${day}`;
  return type === "date" ? date : `${date}T${hour}:${minute}:${second ?? "00"}`;
}

/**
 * The value a native date field writes, as the Properties panel writes it;
 * `null` for a cleared field, and `undefined` for one that holds no date.
 */
export function dateValue(
  type: DateType,
  field: string,
): string | null | undefined {
  if (field === "") return null;
  return partsOf(type, field) ? dateInputValue(type, field) : undefined;
}

/** A tag as a cell shows it: without its `#`. */
export function tagText(tag: string): string {
  return tag.replace(/^#/, "");
}
