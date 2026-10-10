/** One step of a Projection Path: an object key, an index, or every element. */
export type PathSegment = string | number | { readonly kind: "each" };

export type ParsedPath =
  | {
      readonly ok: true;
      readonly segments: readonly PathSegment[];
      /** Start of each accessor, including its dot or opening bracket. */
      readonly offsets: readonly number[];
    }
  | { readonly ok: false; readonly message: string };

/**
 * Parse a Projection Path in the template accessor grammar: dotted identifier
 * access (`date.year`), numeric array indexes (`creators[0]`), element projection
 * (`creators[]`), and JSON-quoted
 * brackets for arbitrary keys (`custom["review.status"]`). An identifier is
 * ASCII letters, digits, `_`, and `$`, and does not start with a digit. The
 * path has no whitespace.
 */
export function parseProjectionPath(text: string): ParsedPath {
  const segments: PathSegment[] = [];
  const offsets: number[] = [];
  let at = 0;
  const fail = (message: string): ParsedPath => ({ ok: false, message });

  if (text.length === 0) return fail("The path is empty.");
  while (at < text.length) {
    offsets.push(at);
    const char = text[at]!;
    if (char === "[") {
      const close = bracketEnd(text, at);
      if (close === -1) {
        return fail(`The bracket at position ${at} has no closing "]".`);
      }
      const inner = text.slice(at + 1, close);
      if (inner === "") {
        segments.push({ kind: "each" });
      } else if (isIndex(inner)) {
        segments.push(Number(inner));
      } else if (inner.startsWith('"')) {
        let key: unknown;
        try {
          key = JSON.parse(inner);
        } catch {
          key = undefined;
        }
        if (typeof key !== "string") {
          return fail(
            `The bracket at position ${at} holds ${inner}, which is not a JSON string.`,
          );
        }
        segments.push(key);
      } else {
        return fail(
          `The bracket at position ${at} holds ${inner || "nothing"}; use an array index or a JSON-quoted key.`,
        );
      }
      at = close + 1;
      continue;
    }
    if (segments.length > 0) {
      if (char !== ".") {
        return fail(`Expected "." or "[" at position ${at}.`);
      }
      at += 1;
    }
    const end = identifierEnd(text, at);
    if (end === at) {
      return fail(`Expected a field name at position ${at}.`);
    }
    segments.push(text.slice(at, end));
    at = end;
  }
  return { ok: true, segments, offsets };
}

/** The position of the `]` that closes the bracket at `open`, or -1. */
function bracketEnd(text: string, open: number): number {
  let at = open + 1;
  if (text[at] !== '"') {
    const close = text.indexOf("]", at);
    return close;
  }
  // Skip the JSON string, so that a quoted key can hold "]".
  at += 1;
  while (at < text.length) {
    const char = text[at];
    if (char === "\\") at += 2;
    else if (char === '"') return text[at + 1] === "]" ? at + 1 : -1;
    else at += 1;
  }
  return -1;
}

function isIndex(text: string): boolean {
  if (text.length === 0 || (text.length > 1 && text[0] === "0")) return false;
  for (const char of text) if (char < "0" || char > "9") return false;
  return Number.isSafeInteger(Number(text));
}

function identifierEnd(text: string, start: number): number {
  let at = start;
  while (at < text.length) {
    const char = text[at]!;
    const isLetter =
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      char === "_" ||
      char === "$";
    const isDigit = char >= "0" && char <= "9";
    if (!(isLetter || (isDigit && at > start))) break;
    at += 1;
  }
  return at;
}
