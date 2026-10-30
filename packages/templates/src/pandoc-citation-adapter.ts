// Runtime mapping from template Citation Items to the Pandoc Citation Source Module.

import { mapCitationItems } from "./citation-items";
import { formatPandocCitation, PandocCitationError } from "./pandoc-citation";
import type { PandocCitationForm } from "./pandoc-citation";

export function formatTemplatePandocCitation(
  value: unknown,
  form: unknown = "normal",
): string {
  const items = mapCitationItems(
    value,
    "pandoc_cite",
    (message, itemIndex) =>
      new PandocCitationError("invalid-input", message, {
        itemIndex,
        property: "items",
      }),
  );
  return formatPandocCitation(items, form as PandocCitationForm);
}
