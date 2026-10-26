// PROTOTYPE (proto/view-reactivity) — throwaway. Candidate A: Effect's own
// reactivity (effect/reactivity Atom + @effect/atom-react) behind the seam in
// `edge.ts`. The component knows atoms and two hooks; lifecycle, switching,
// pending and failure live behind them.
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import {
  LabUi,
  activeNoteAtom,
  atTriggerAtom,
  citedByActiveAtom,
  openNoteCommand,
  readCitedByOnceCommand,
  toggleAtTriggerCommand,
} from "./atoms";
import { ViewRegistry } from "./edge";
import { Panel, toggled } from "./panel";

export function AtomTab(props: {
  readonly registry: AtomRegistry.AtomRegistry;
}) {
  return (
    <ViewRegistry registry={props.registry}>
      <LabUi.Provider>
        <AtomPanel />
      </LabUi.Provider>
    </ViewRegistry>
  );
}

function AtomPanel() {
  const note = useAtomValue(activeNoteAtom);
  const toggle = useAtomValue(toggleAtTriggerCommand);
  const once = useAtomValue(readCitedByOnceCommand);
  const [ui, setUi] = useAtom(LabUi.use());
  const runToggle = useAtomSet(toggleAtTriggerCommand);
  const readOnce = useAtomSet(readCitedByOnceCommand);
  const open = useAtomSet(openNoteCommand);
  return (
    <Panel
      flavor="Effect Atom"
      note={note}
      snapshot={useAtomValue(citedByActiveAtom)}
      search={ui.search}
      onSearch={(search) => setUi((s) => ({ ...s, search }))}
      collapsed={ui.collapsed}
      onToggleGroup={(path) =>
        setUi((s) => ({ ...s, collapsed: toggled(s.collapsed, path) }))
      }
      atTrigger={useAtomValue(atTriggerAtom)}
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
