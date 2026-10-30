// One line per Structured Character, naming every field the line grouping
// decides. Both sides of the parity comparison print through this module, so a
// field can never be compared under two different spellings.

/** Six decimals, far below any geometry the line grouping reacts to. */
function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function fingerprint(char) {
  return [
    char.offset,
    char.c,
    char.u,
    char.rect.map(round).join(","),
    char.inlineRect.map(round).join(","),
    char.rotation,
    round(char.baseline),
    round(char.fontSize),
    char.fontName,
    char.spaceAfter ? "S" : "",
    char.wordBreakAfter ? "W" : "",
    char.lineBreakAfter ? "L" : "",
    char.paragraphBreakAfter ? "P" : "",
    char.ignorable ? "I" : "",
  ].join("|");
}
