import { prefs } from "@/prefs";

/** Burst-coalescing window for every notify dispatcher. */
export const NOTIFY_DEBOUNCE_MS = 500;

/**
 * Read the `notify` master switch at emit time so toggling it off in prefs
 * stops dispatching immediately without re-registering observers.
 */
export function notifyEnabled(): boolean {
  return prefs.get<boolean>("extensions.zotlit.notify") === true;
}
