// The same web adapter used by the page, for independently mounted panes.
import type { ReactNode } from "react";

import { SAMPLE_ITEMS } from "@zotlit/workbench/render";
import {
  WorkbenchHostProvider,
  WorkbenchThemeProvider,
} from "@zotlit/workbench/ui";

import { useWebHost } from "./host";
import { WEB_THEME } from "./theme";

export function WebTestHost({ children }: { children: ReactNode }) {
  const { host, overlays } = useWebHost({
    snapshot: SAMPLE_ITEMS[0]!,
    notice() {},
    insertTarget: () => null,
  });
  return (
    <WorkbenchThemeProvider theme={WEB_THEME}>
      <WorkbenchHostProvider host={host}>
        {children}
        {overlays}
      </WorkbenchHostProvider>
    </WorkbenchThemeProvider>
  );
}
