// The page's view of the Workbench Connection: its state, the draft it follows,
// and the reader's actions, each run through the page bridge.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { useFork } from "@zotlit/workbench/ui";

import { toast } from "@/components/ui/toast";
import { m } from "@/paraglide/messages.js";

import type { SampleItem } from "./fields";
import { usePageBridge } from "./runtime";
import { WorkbenchConnection } from "./workbench-connection";
import type {
  ProfileHydration,
  SavedProfile,
  SaveTarget,
} from "./workbench-connection";

interface UseWorkbenchConnectionOptions {
  readonly controller: WorkbenchDocumentController;
  readonly onHydrate: (hydration: ProfileHydration) => void;
  readonly onItemLoaded: (snapshot: SampleItem) => void;
  readonly onSaved: (profile: SavedProfile) => void;
}

export function useWorkbenchConnection({
  controller,
  onHydrate,
  onItemLoaded,
  onSaved,
}: UseWorkbenchConnectionOptions) {
  const bridge = usePageBridge();
  const [service] = useState(() => bridge.runSync(WorkbenchConnection));
  const [state, setState] = useState(() => bridge.runSync(service.current));
  const fork = useFork(bridge.run);
  // Handlers reach the page's latest callbacks without resubscribing.
  const latest = useRef({ onHydrate, onItemLoaded, onSaved });
  useLayoutEffect(() => {
    latest.current = { onHydrate, onItemLoaded, onSaved };
  });
  // The hydration this page has opened. The state replays it to a new
  // subscription, which must not open it twice.
  const opened = useRef(state.hydration);

  useEffect(
    () =>
      bridge.subscribe(service.changes, (next) => {
        setState(next);
        if (next.hydration === opened.current) return;
        opened.current = next.hydration;
        if (next.hydration) latest.current.onHydrate(next.hydration);
      }),
    [bridge, service],
  );
  // The page's lifetime, not this mount's, owns the launch: a StrictMode
  // replay neither stops it nor starts another.
  useEffect(() => void bridge.run(service.start), [bridge, service]);

  // The partials the draft calls right now. A bundle is read again only when
  // this list changes, so typing never queries the vault.
  const names = controller.dependencies.join("\u0000");
  const source = controller.source;
  const { connection, resources } = state;
  useEffect(
    () => void bridge.run(service.followDependencies({ source, names })),
    [bridge, service, connection, resources, names, source],
  );

  const inheritedStyleId =
    connection.state === "connected"
      ? connection.profileDefaults.citationStyle
      : null;
  // The style the preview renders under: the Profile's own binding, and the
  // vault's where it binds none, which is the value Name and folder shows.
  const styleId = controller.document
    ? (controller.document.manifest.citationStyle ?? inheritedStyleId)
    : undefined;
  useEffect(
    () => void bridge.run(service.followCitationStyle(styleId)),
    [bridge, service, connection, resources, styleId],
  );

  return {
    connection,
    saveTarget: state.saveTarget,
    resources,
    /** True while the held bundle answers a draft other than the one on screen. */
    resourcesStale: state.resourcesStale,
    citationStyles: state.citationStyles,
    // Forked, not run in place: hydration calls this while its own state
    // update is still delivering.
    saveAgainst: (expected: SaveTarget["expected"]) =>
      void bridge.run(service.saveAgainst(expected)),
    connectionBusy: state.connectionBusy,
    resumable: state.resumable,
    itemBusy: state.itemBusy,
    saveBusy: state.saveBusy,
    message: state.message,
    reconnect: () => fork(service.reconnect, {}),
    disconnect: () =>
      fork(service.disconnect, {
        onSuccess: (ended) => {
          if (ended)
            toast.add({
              title: m.workbench_connection_disconnect_complete(),
              type: "info",
            });
        },
      }),
    reloadProfile: () => fork(service.reload, {}),
    loadSelectedItem: () =>
      fork(service.loadSelectedItem, {
        onSuccess: (snapshot) => {
          if (snapshot) latest.current.onItemLoaded(snapshot);
        },
      }),
    save: (draft: string) =>
      fork(service.save(draft), {
        onSuccess: (saved) => {
          if (!saved) return;
          latest.current.onSaved(saved);
          toast.add({
            title: m.workbench_save_complete({ vault: saved.vault }),
            type: "success",
          });
        },
      }),
  };
}
