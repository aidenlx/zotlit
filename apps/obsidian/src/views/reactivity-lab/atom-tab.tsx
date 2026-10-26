// PROTOTYPE (proto/view-reactivity) — throwaway. Candidate A: Effect's own
// reactivity (effect/reactivity Atom + @effect/atom-react) behind the seam in
// `edge.ts`. The component knows atoms and two hooks; lifecycle, switching,
// pending and failure live behind them. View state comes from the ItemView's
// model, so the class and React write the same atoms.
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { CitedBySnapshot } from "@/services/citation-index/service";

import {
  activeNoteAtom,
  atTriggerAtom,
  citedByActiveAtom,
  openNoteCommand,
  readCitedByOnceCommand,
  toggleAtTriggerCommand,
} from "./atoms";
import { ViewRegistry } from "./edge";
import { Panel, toggled } from "./panel";
import { useLabViewModel } from "./view-model";
import type { LabSort } from "./view-model";

export function AtomTab(props: {
  readonly registry: AtomRegistry.AtomRegistry;
}) {
  return (
    <ViewRegistry registry={props.registry}>
      <AtomPanel />
    </ViewRegistry>
  );
}

function sorted(
  snapshot: CitedBySnapshot | null,
  sort: LabSort,
): CitedBySnapshot | null {
  if (!snapshot || sort === "path") return snapshot;
  const groups = [...snapshot.groups].sort(
    (a, b) => b.occurrences.length - a.occurrences.length,
  );
  return { ...snapshot, groups };
}

function AtomPanel() {
  const model = useLabViewModel();
  const note = useAtomValue(activeNoteAtom);
  const snapshot = useAtomValue(citedByActiveAtom);
  const atTrigger = useAtomValue(atTriggerAtom);
  const toggle = useAtomValue(toggleAtTriggerCommand);
  const once = useAtomValue(readCitedByOnceCommand);
  const [layout, setLayout] = useAtom(model.layout);
  const [collapsed, setCollapsed] = useAtom(model.collapsed);
  const runToggle = useAtomSet(toggleAtTriggerCommand);
  const readOnce = useAtomSet(readCitedByOnceCommand);
  const open = useAtomSet(openNoteCommand);
  return (
    <Panel
      flavor={`Effect Atom · sort: ${layout.sort}`}
      note={note}
      snapshot={sorted(snapshot, layout.sort)}
      search={layout.search}
      onSearch={(search) => setLayout((l) => ({ ...l, search }))}
      collapsed={collapsed}
      onToggleGroup={(path) => setCollapsed((set) => toggled(set, path))}
      atTrigger={atTrigger}
      togglePending={toggle.waiting}
      onToggleAtTrigger={() => runToggle()}
      once={AsyncResult.match(once, {
        onInitial: (r) => (r.waiting ? "loading…" : ""),
        onSuccess: (r) => (r.waiting ? "loading…" : r.value),
        onFailure: () => "failed",
      })}
      onReadOnce={() => note?.key && readOnce(note.key)}
      onOpen={open}
    />
  );
}
