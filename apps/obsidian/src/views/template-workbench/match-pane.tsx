// The Match tab of the Template Workbench View: it tests the selected Item
// independently of preview rendering mode.
import { useAtomValue } from "@effect/atom-react";

import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { MatchPane, WorkbenchThemeProvider } from "@zotlit/workbench/ui";

import { Select } from "@/components/select";
import { useObsidianApp } from "@/lib/app-context";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";

import { onKeymap, templateWorkbenchTheme } from "./theme";

/**
 * The Workbench theme with the plugin's own Select for the Match editor's
 * selects, a popup with a search field as Bases picks a property or an
 * operator. The other selects of the Workbench keep Obsidian's dropdown.
 */
export const matchTheme = {
  ...templateWorkbenchTheme,
  matchSelect: Select,
  classes: {
    ...templateWorkbenchTheme.classes,
    select: {
      wrapper: "zt:min-w-0 zt:max-w-full",
      select: "dropdown zt:max-w-full",
      icon: "zt:hidden",
    },
  },
};

export function NativeMatchPane({
  controller,
  onChooseItem,
}: {
  controller: WorkbenchDocumentController;
  onChooseItem?: () => void;
}) {
  const app = useObsidianApp();
  const vocabularyRevision = useAtomValue(zoteroRevisionAtom);
  return (
    <WorkbenchThemeProvider theme={onKeymap(matchTheme, app)}>
      <MatchPane
        onChooseItem={onChooseItem}
        controller={controller}
        vocabularyRevision={vocabularyRevision}
      />
    </WorkbenchThemeProvider>
  );
}
