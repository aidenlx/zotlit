// The Match tab of the Template Workbench View: it tests the selected Item
// independently of preview rendering mode.
import { useEffect, useState } from "react";

import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import { MatchPane, WorkbenchThemeProvider } from "@zotlit/workbench/ui";

import { Select } from "@/components/select";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { templateWorkbenchTheme } from "./theme";

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
  db,
  onChooseItem,
}: {
  controller: WorkbenchDocumentController;
  db: Pick<ZoteroReadsService, "on">;
  onChooseItem?: () => void;
}) {
  // A database change can bring new Tags and Collections, and a new answer.
  const [vocabularyRevision, setVocabularyRevision] = useState(0);
  useEffect(
    () => db.on("changed", () => setVocabularyRevision((value) => value + 1)),
    [db],
  );
  return (
    <WorkbenchThemeProvider theme={matchTheme}>
      <MatchPane
        onChooseItem={onChooseItem}
        controller={controller}
        vocabularyRevision={vocabularyRevision}
      />
    </WorkbenchThemeProvider>
  );
}
