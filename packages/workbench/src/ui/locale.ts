// Hosts with an app-owned language bind the shared messages at startup.
import {
  baseLocale,
  isLocale,
  overwriteGetLocale,
} from "./paraglide/runtime.js";

/** Use the host's resolved locale; other hosts retain the generated default. */
export function setWorkbenchLocale(locale: string): void {
  const resolved = isLocale(locale) ? locale : baseLocale;
  overwriteGetLocale(() => resolved);
}
