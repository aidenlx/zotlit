// The property grid every rendered frontmatter list is read through: the
// sheet's own list and the Properties tab's columns. It parses no Markdown, so
// the tab can read it without the reading view's parser stack.

import type { RenderedProperty } from "#/render/result";
import { regex } from "arkregex";

import { useWorkbenchMessages } from "./messages";
import { useIcon, useParts } from "./theme";

/** The property types Obsidian's own Properties editor tells apart. */
export type PropertyType =
  | "text"
  | "list"
  | "tags"
  | "aliases"
  | "number"
  | "checkbox"
  | "date"
  | "datetime";

const DATE = regex("^\\d{4}-[01]\\d-[0-3]\\d$");
const DATETIME = regex("^\\d{4}-[01]\\d-[0-3]\\dT[0-2]\\d:[0-5]\\d");

/**
 * The type a property reads as, inferred from its key and value the way
 * Obsidian infers a property it has no recorded type for.
 */
export function propertyType(property: RenderedProperty): PropertyType {
  if (property.key === "tags") return "tags";
  if (property.key === "aliases") return "aliases";
  const { value } = property;
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string") {
    if (DATE.test(value)) return "date";
    if (DATETIME.test(value)) return "datetime";
  }
  return "text";
}

/**
 * A property grid — the name beside the value, or beside the reason it has
 * none. The sheet's own frontmatter list and the Properties tab's columns are
 * this one list. Each row and its value state the property's type, and the key
 * carries that type's icon.
 */
export function PropertyList({
  properties,
  label,
  variant = "list",
}: {
  properties: readonly RenderedProperty[];
  label?: string;
  variant?: "list" | "note" | "spread";
}) {
  const part = useParts("propertyList");
  const icon = useIcon();
  return (
    <dl aria-label={label} {...part(variant)}>
      {properties.map((property) => {
        const type = propertyType(property);
        return (
          <div
            key={`${property.position}:${property.key}`}
            {...part("row", type)}
          >
            <dt {...part("key")}>
              <span aria-hidden="true" {...part("icon")}>
                {icon(`property-${type}`)}
              </span>
              <span {...part("label")}>{property.key}</span>
            </dt>
            <dd {...part("value", type)}>
              <PropertyValue property={property} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A produced value, or the reason it has none. */
export function PropertyValue({ property }: { property: RenderedProperty }) {
  const m = useWorkbenchMessages();
  const part = useParts("propertyList");
  const { value } = property;
  if (
    property.missing ||
    value == null ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return (
      <span {...part("empty")}>
        {property.missing
          ? m.workbench_property_unset()
          : m.workbench_property_empty()}
      </span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div {...part("pills")}>
        {value.map((item, index) => (
          <div key={index} {...part("pill")}>
            <span {...part("pill-text")}>{propertyText(item)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value}
        readOnly
        aria-readonly="true"
        tabIndex={-1}
        onClick={(event) => event.preventDefault()}
        {...part("checkbox")}
      />
    );
  }
  return <span {...part("text")}>{propertyText(value)}</span>;
}

/** One property value as a single line of text, shared by every property list. */
export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
