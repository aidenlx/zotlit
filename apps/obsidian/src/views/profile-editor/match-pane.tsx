// Match reads the selected Item independently of preview rendering mode.
import { useEffect, useState } from "react";

import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { MatchItemFacts } from "@zotlit/workbench/match";
import { MatchPane, useWorkbenchStore } from "@zotlit/workbench/ui";

import type { DatabaseService } from "@/services/database/service";

import { loadMatchFacts } from "./match-data";

export function NativeMatchPane({
  controller,
  db,
}: {
  controller: WorkbenchDocumentController;
  db: Pick<DatabaseService, "acquireRead" | "on">;
}) {
  const [vocabularyRevision, setVocabularyRevision] = useState(0);
  const item = useWorkbenchStore((state) => state.item);
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
      void loadMatchFacts(db, item.id).then(
        (facts) => {
          if (active && generation === current)
            setSelected({ id: item.id, facts });
        },
        () => {
          if (active && generation === current)
            setSelected({ id: item.id, facts: null });
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
  }, [db, item]);
  return (
    <MatchPane
      controller={controller}
      vocabularyRevision={vocabularyRevision}
      facts={selected?.id === item?.id ? (selected?.facts ?? null) : null}
    />
  );
}
