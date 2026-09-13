// A ZotLit-owned UI Label in docs prose — a setting, option, menu item,
// button, tooltip, or quoted notice. The component owns the emphasis.
import { asMarkdown, md } from "fumadocs-core/server";

import type { LocalizedString } from "@/paraglide/runtime.js";

export interface UiLabelProps {
  /** ZotLit UI Label rendered from the product Message catalog. */
  name: LocalizedString;
}

export function UiLabel({ name }: UiLabelProps) {
  if (asMarkdown()) {
    return md`**${name}**`;
  }

  return <strong>{name}</strong>;
}
