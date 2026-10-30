// Runtime mapping from template Citation Items to the LaTeX Citation Source Module.

import { mapCitationItems } from "./citation-items";
import { formatTexCitation, TexCitationError } from "./tex-citation";

export function formatTemplateTexCitation(
  value: unknown,
  command: unknown = "cite",
): string {
  const items = mapCitationItems(
    value,
    "tex_cite",
    (message, itemIndex) =>
      new TexCitationError("invalid-input", message, {
        itemIndex,
        property: "items",
      }),
  );
  if (typeof command !== "string") {
    throw new TexCitationError(
      "invalid-input",
      "tex_cite requires a command name",
      { property: "command" },
    );
  }
  return formatTexCitation(items, command);
}
