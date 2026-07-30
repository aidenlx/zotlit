// Formats Template data paths for display, snippets, and serialized references.

import { regex } from "arkregex";

export type TemplatePathSegment = string | number;

const IDENTIFIER = regex("^[A-Za-z_$][A-Za-z0-9_$]*$");

export function isAccessorIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

/**
 * Format a Template data accessor. Numeric segments use brackets, identifier
 * segments use dot notation, and all other strings use JSON-quoted brackets.
 */
export function formatAccessorPath(
  segments: readonly TemplatePathSegment[],
  rootAlias?: string,
): string {
  let out = rootAlias ?? "";
  for (const segment of segments) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (isAccessorIdentifier(segment)) {
      out += out ? `.${segment}` : segment;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}
