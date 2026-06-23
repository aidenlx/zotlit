import { regex } from "arkregex";

/**
 * Sentinel emitted by the `suffix()` filename helper. The host fills it with
 * `prepend + <random> + append` only when the rendered name collides with an
 * existing note; absent a collision it drops to "". The requested length and
 * the literal affixes ride along in the marker so resolution stays a pure
 * string pass with no extra plumbing.
 *
 * Fields are `:`-delimited and affixes may not contain `:` or `%`, so the
 * marker round-trips unambiguously. `%` is left untouched by Obsidian filename
 * normalization, so a stray marker (e.g. `suffix()` misused outside a filename
 * template) degrades to readable text rather than control characters.
 */
const MARKER_RE = regex(
  "%zt-suffix:(?<length>\\d+):(?<prepend>[^:%]*):(?<append>[^:%]*)%",
  "g",
);

/**
 * Even the default 6 is generous for collision disambiguation; the cap stops
 * `suffix(1e8)` from allocating a huge string at fill time.
 */
const MAX_SUFFIX_LENGTH = 64;

/** Resolved instructions a suffix marker carries to its fill callback. */
export interface SuffixSpec {
  /** Number of random characters to generate. */
  length: number;
  /** Literal text placed before the random string. */
  prepend: string;
  /** Literal text placed after the random string. */
  append: string;
}

/**
 * Returns a sentinel that the host replaces with
 * `prepend + <random length-char string> + append` when the rendered filename
 * already exists, or with "" when it is free — so the suffix appears only on a
 * real collision.
 *
 * @param length number of random characters to generate on collision
 * @default length 6
 * @default prepend "_"
 * @default append ""
 * @throws when `length` is not an integer in `1..64`, or an affix contains `:` or `%`
 */
export function filenameSuffix(length = 6, prepend = "_", append = ""): string {
  if (!Number.isInteger(length) || length < 1 || length > MAX_SUFFIX_LENGTH) {
    throw new Error(
      `suffix() length must be an integer in 1..${MAX_SUFFIX_LENGTH}, got ${length}`,
    );
  }
  for (const [name, value] of [
    ["prepend", prepend],
    ["append", append],
  ] as const) {
    if (/[:%]/.test(value)) {
      throw new Error(
        `suffix() ${name} must not contain ':' or '%', got ${JSON.stringify(value)}`,
      );
    }
  }
  return `%zt-suffix:${length}:${prepend}:${append}%`;
}

/**
 * Mirrors {@link MARKER_RE} exactly (not a loose substring scan), so malformed
 * marker-like text degrades to a literal and never triggers a fruitless
 * collision-resolution loop.
 */
export function hasSuffixMarker(rendered: string): boolean {
  return rendered.search(MARKER_RE) !== -1;
}

/** Pass `() => ""` to drop markers entirely. */
export function replaceSuffixMarkers(
  rendered: string,
  fill: (spec: SuffixSpec) => string,
): string {
  MARKER_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  for (
    let match = MARKER_RE.exec(rendered);
    match;
    match = MARKER_RE.exec(rendered)
  ) {
    const { length, prepend, append } = match.groups;
    out +=
      rendered.slice(last, match.index) +
      fill({ length: Number(length), prepend, append });
    last = match.index + match[0].length;
  }
  return out + rendered.slice(last);
}
