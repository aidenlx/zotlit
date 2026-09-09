// Match reads the selected Item independently of preview rendering mode.
import { useEffect, useState } from "react";

import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { MatchItemFacts } from "@zotlit/workbench/match";
import {
  MatchPane,
  WorkbenchThemeProvider,
  useWorkbenchStore,
} from "@zotlit/workbench/ui";
import type { WorkbenchIcon } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";

import { loadMatchFacts } from "./match-data";
import { profileEditorTheme } from "./theme";

const matchTheme = {
  ...profileEditorTheme,
  icon: (name: WorkbenchIcon) =>
    name === "remove" ? <Icon name="x" /> : profileEditorTheme.icon?.(name),
  classes: {
    ...profileEditorTheme.classes,
    select: {
      wrapper: "zt:min-w-0 zt:max-w-full",
      select: "dropdown zt:max-w-full",
      icon: "zt:hidden",
    },
  },
};

const logger = getLogger(["views", "profile-editor", "match"]);

export function NativeMatchPane({
  controller,
  db,
}: {
  controller: WorkbenchDocumentController;
  db: Pick<DatabaseService, "acquireRead" | "on">;
}) {
  const [vocabularyRevision, setVocabularyRevision] = useState(0);
  const item = useWorkbenchStore((state) => state.item);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{
    id: string;
    facts: MatchItemFacts | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    function refresh() {
      const current = ++generation;
      if (!item) return;
      setLoading(true);
      setFailed(false);
      logger.trace("Refreshing Match facts", {
        indexedKey: item.id,
        generation: current,
      });
      void loadMatchFacts(db, item.id).then(
        (facts) => {
          const applied = active && generation === current;
          logger.trace("Match facts completed", {
            indexedKey: item.id,
            generation: current,
            applied,
            available: facts !== null,
          });
          if (applied) {
            setSelected({ id: item.id, facts });
            setLoading(false);
          }
        },
        (error: unknown) => {
          const applied = active && generation === current;
          logger.warn("Failed to load Match facts for {indexedKey}", {
            indexedKey: item.id,
            error,
            generation: current,
            applied,
          });
          if (applied) {
            setSelected({ id: item.id, facts: null });
            setFailed(true);
            setLoading(false);
          }
        },
      );
    }
    refresh();
    const unsubscribe = db.on("changed", () => {
      setVocabularyRevision((value) => value + 1);
      refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [db, item, retry]);
  return (
    <WorkbenchThemeProvider theme={matchTheme}>
      <MatchPane
        controller={controller}
        exampleMessage={
          !item
            ? m.workbench_example_select_item()
            : loading || selected?.id !== item.id
              ? m.workbench_loading_item()
              : failed
                ? m.workbench_example_failed()
                : selected.facts === null
                  ? m.workbench_example_missing_item()
                  : null
        }
        onRetry={failed ? () => setRetry((value) => value + 1) : undefined}
        vocabularyRevision={vocabularyRevision}
        facts={selected?.id === item?.id ? (selected?.facts ?? null) : null}
      />
    </WorkbenchThemeProvider>
  );
}
