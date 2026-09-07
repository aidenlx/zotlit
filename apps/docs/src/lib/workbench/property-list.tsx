// The property grid every rendered frontmatter list is read through: the
// sheet's own list and the Properties tab's columns. It parses no Markdown, so
// the tab can read it without the reading view's parser stack.

import { Fragment } from "react";

import type { RenderedProperty } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

/**
 * A property grid — the name beside the value, or beside the reason it has
 * none. The sheet's own frontmatter list and the Properties tab's columns are
 * this one list.
 */
export function PropertyList({
  properties,
  label,
  className = "",
}: {
  properties: readonly RenderedProperty[];
  label?: string;
  className?: string;
}) {
  return (
    <dl
      aria-label={label}
      className={`grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 ${className}`}
    >
      {properties.map((property) => (
        <Fragment key={`${property.position}:${property.key}`}>
          <dt className="truncate font-mono text-fd-muted-foreground">
            {property.key}
          </dt>
          <dd className="break-words">
            <PropertyValue property={property} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** A produced value, or the reason it has none. */
export function PropertyValue({ property }: { property: RenderedProperty }) {
  if (property.missing || property.value == null) {
    return (
      <span className="text-fd-muted-foreground italic">
        {property.missing
          ? m.workbench_property_unset()
          : m.workbench_property_empty()}
      </span>
    );
  }
  return propertyText(property.value);
}

/** One property value as a single line of text, shared by every property list. */
export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(", ");
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
