/**
 * Normalize rendered cite-template output to its inline form. A citation is a
 * single-line in-text token, but template files end with a newline and a
 * custom template may span lines: every whitespace run containing a line
 * break collapses to one space, and the ends are trimmed. Runs of plain
 * spaces inside the output stay as authored.
 */
export function inlineCitation(rendered: string): string {
  return rendered.replaceAll(/\s*\n\s*/g, " ").trim();
}
