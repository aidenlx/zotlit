// The page's view of the Workbench Connection: its state, the Profile each
// hydration opens, and the reader's actions, each a command of the page.

import {
  RegistryContext,
  useAtomSet,
  useAtomSubscribe,
  useAtomValue,
} from "@effect/atom-react";
import { useCallback, useContext, useLayoutEffect, useRef } from "react";

import type { WebPage } from "./page-model";
import type {
  ProfileHydration,
  SavedProfile,
  SaveTarget,
} from "./workbench-connection";

interface UseWorkbenchConnectionOptions {
  readonly page: WebPage;
  readonly onHydrate: (hydration: ProfileHydration) => void;
  readonly onSaved: (profile: SavedProfile) => void;
}

export function useWorkbenchConnection({
  page,
  onHydrate,
  onSaved,
}: UseWorkbenchConnectionOptions) {
  const state = useAtomValue(page.connection);
  // Handlers reach the page's latest callbacks without resubscribing.
  const latest = useRef({ onHydrate, onSaved });
  useLayoutEffect(() => {
    latest.current = { onHydrate, onSaved };
  });
  // The commands mount before the hydration subscription below, so opening
  // a hydration that stands at mount can already run them.
  const reconnect = useAtomSet(page.reconnect);
  const reload = useAtomSet(page.reload);
  const disconnect = useAtomSet(page.disconnect);
  const save = useAtomSet(page.save);
  const saveAgainst = useAtomSet(page.saveAgainst);
  // A new subscription is handed the hydration that stands, which the page
  // must not open twice. Once it is open, the reads that follow the draft on
  // screen resume.
  const registry = useContext(RegistryContext);
  const hydrated = useCallback(
    (hydration: ProfileHydration | null) => {
      if (hydration === registry.get(page.opened)) return;
      if (hydration) latest.current.onHydrate(hydration);
      registry.set(page.opened, hydration);
    },
    [registry, page],
  );
  useAtomSubscribe(page.hydration, hydrated, { immediate: true });

  return {
    connection: state.connection,
    saveTarget: state.saveTarget,
    resources: state.resources,
    /** True while the held bundle answers a draft other than the one on screen. */
    resourcesStale: state.resourcesStale,
    citationStyles: state.citationStyles,
    saveAgainst: (expected: SaveTarget["expected"]) => saveAgainst(expected),
    connectionBusy: state.connectionBusy,
    resumable: state.resumable,
    itemBusy: state.itemBusy,
    saveBusy: state.saveBusy,
    message: state.message,
    reconnect: () => reconnect(),
    disconnect: () => disconnect(),
    reloadProfile: () => reload(),
    save: (draft: string) =>
      save({
        source: draft,
        saved: (saved) => latest.current.onSaved(saved),
      }),
  };
}
