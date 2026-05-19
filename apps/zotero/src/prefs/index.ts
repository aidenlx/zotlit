import { formatValue } from "@/lib/l10n.js";
import type { PluginPrefKey } from "@/types/prefs.js";

type PrefValue = boolean | string | number;

export const prefs = {
  get<T extends PrefValue = PrefValue>(k: PluginPrefKey): T | undefined {
    return Zotero.Prefs.get(k) as T | undefined;
  },
  set(k: PluginPrefKey, v: PrefValue): void {
    Zotero.Prefs.set(k, v);
  },
  /** @returns Teardown that unregisters the underlying Zotero observer. */
  onChange<T extends PrefValue = PrefValue>(
    k: PluginPrefKey,
    cb: (v: T | undefined) => void,
  ): () => void {
    const id = Zotero.Prefs.registerObserver(k, () => cb(prefs.get<T>(k)));
    return () => Zotero.Prefs.unregisterObserver(id);
  },
};

export async function registerPrefPane(pluginID: string): Promise<void> {
  const label = await formatValue("zotlit-prefs-pane-label");
  await Zotero.PreferencePanes.register({
    pluginID,
    src: "prefs.xhtml",
    label: label ?? undefined,
  });
}
