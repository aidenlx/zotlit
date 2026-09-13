// Eta host adapter for the shared template input rules.
import type { Extension } from "@codemirror/state";

import { templatePairing } from "./pairing";

export function etaAutoPair(): Extension {
  return templatePairing(() => ({ language: "eta" }));
}
