// Formats Template data paths for display, snippets, and serialized references.

export type TemplatePathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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
    } else if (!out && isAccessorIdentifier(segment)) {
      out = segment;
    } else {
      out += memberAccessor(segment);
    }
  }
  return out;
}

/** The step that reads property `name` off a value: `.name`, or `["name"]` for a name that is not an identifier. */
export function memberAccessor(name: string): string {
  return isAccessorIdentifier(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}
