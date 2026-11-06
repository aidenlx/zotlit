// The page's view of the Workbench Connection: its state and the reader's
// connection actions, each a command of the page.

import { useAtomSet, useAtomValue } from "@effect/atom-react";

import type { WebPage } from "./page-model";

export function useWorkbenchConnection(page: WebPage) {
  const state = useAtomValue(page.connection);
  const reconnect = useAtomSet(page.reconnect);
  const reload = useAtomSet(page.reload);
  const disconnect = useAtomSet(page.disconnect);
  return {
    connection: state.connection,
    saveTarget: state.saveTarget,
    resources: state.resources,
    citationStyles: state.citationStyles,
    connectionBusy: state.connectionBusy,
    resumable: state.resumable,
    itemBusy: state.itemBusy,
    saveBusy: state.saveBusy,
    message: state.message,
    reconnect: () => reconnect(),
    disconnect: () => disconnect(),
    reloadProfile: () => reload(),
  };
}
