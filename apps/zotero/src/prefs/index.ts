// Keep `PrefsMap` in sync with `addon/prefs.js` and `addon/prefs.xhtml` by hand.

import { formatValue } from "@/lib/l10n.js";

const PREFIX = "extensions.zotlit." as const;

interface PrefsMap {
  notify: boolean;
  "notify-url": string;
  "log.console-level": string;
}

type PrefKey = keyof PrefsMap;

function fullKey<K extends PrefKey>(k: K): string {
  return `${PREFIX}${k}`;
}

export const prefs = {
  get<K extends PrefKey>(k: K): PrefsMap[K] {
    return Zotero.Prefs.get(fullKey(k)) as PrefsMap[K];
  },
  set<K extends PrefKey>(k: K, v: PrefsMap[K]): void {
    Zotero.Prefs.set(fullKey(k), v as string | number | boolean);
  },
  /** @returns Teardown that unregisters the underlying Zotero observer. */
  onChange<K extends PrefKey>(k: K, cb: (v: PrefsMap[K]) => void): () => void {
    const id = Zotero.Prefs.registerObserver(fullKey(k), () =>
      cb(prefs.get(k)),
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
