// The page's view of the Workbench Connection: its state, the Profile each
// hydration opens, and the reader's actions, each a command of the page.

import {
  RegistryContext,
  useAtomSet,
  useAtomSubscribe,
  useAtomValue,
} from "@effect/atom-react";
import { useCallback, useContext, useLayoutEffect, useRef } from "react";

import { toast } from "@/components/ui/toast";
import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import type { WebPage } from "./page-model";
import type {
  ProfileHydration,
  SavedProfile,
  SaveTarget,
} from "./workbench-connection";

interface UseWorkbenchConnectionOptions {
  readonly page: WebPage;
  readonly onHydrate: (hydration: ProfileHydration) => void;
  readonly onItemLoaded: (snapshot: SampleItem) => void;
  readonly onSaved: (profile: SavedProfile) => void;
}

export function useWorkbenchConnection({
  page,
  onHydrate,
  onItemLoaded,
  onSaved,
}: UseWorkbenchConnectionOptions) {
  const state = useAtomValue(page.connection);
  // Handlers reach the page's latest callbacks without resubscribing.
  const latest = useRef({ onHydrate, onItemLoaded, onSaved });
  useLayoutEffect(() => {
    latest.current = { onHydrate, onItemLoaded, onSaved };
  });
  // The commands mount before the hydration subscription below, so opening
  // a hydration that stands at mount can already run them.
  const reconnect = useAtomSet(page.reconnect);
  const reload = useAtomSet(page.reload);
  const disconnect = useAtomSet(page.disconnect);
  const loadItem = useAtomSet(page.loadItem);
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
    disconnect: () =>
      disconnect({
        done: () =>
          toast.add({
            title: m.workbench_connection_disconnect_complete(),
            type: "info",
          }),
      }),
    reloadProfile: () => reload(),
    loadSelectedItem: () =>
      loadItem({
        loaded: (snapshot) => latest.current.onItemLoaded(snapshot),
      }),
    save: (draft: string) =>
      save({
        source: draft,
        saved: (saved) => {
          latest.current.onSaved(saved);
          toast.add({
            title: m.workbench_save_complete({ vault: saved.vault }),
            type: "success",
          });
        },
      }),
  };
}
