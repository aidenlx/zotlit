import { formatValue } from "@/lib/l10n";
import { type PluginPrefKey } from "@/types/prefs";

type PrefValue = boolean | string | number;

// `extensions.zotlit.*` keys are fully qualified, so every Zotero.Prefs call
// passes `global: true`. Without it Zotero prepends its own `extensions.zotero.`
// branch and the read/write/observe silently targets the wrong key.
export const prefs = {
  get<T extends PrefValue = PrefValue>(k: PluginPrefKey): T | undefined {
    return Zotero.Prefs.get(k, true) as T | undefined;
  },
  set(k: PluginPrefKey, v: PrefValue): void {
    Zotero.Prefs.set(k, v, true);
  },
  /** @returns Teardown that unregisters the underlying Zotero observer. */
  onChange<T extends PrefValue = PrefValue>(
    k: PluginPrefKey,
    cb: (v: T | undefined) => void,
  ): () => void {
    const id = Zotero.Prefs.registerObserver(
      k,
      () => cb(prefs.get<T>(k)),
      true,
    );
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
