import type { ResolvedLiteratureNoteProfileBindings } from "@/services/settings/profile";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

/** Settings keys whose stored value is a string or number. */
type SettingsScalarKey = {
  [K in keyof Settings]: Settings[K] extends string | number ? K : never;
}[keyof Settings];

/** Schema default for a declarative control's `placeholder`. */
export function defaultPlaceholder(key: SettingsScalarKey): string {
  return String(defaults[key]);
}

/** Default Profile binding value for a nested declarative control. */
export function defaultProfileBindingPlaceholder(
  key: keyof ResolvedLiteratureNoteProfileBindings,
): string {
  return String(defaults["note.default-profile"].bindings[key]);
}
