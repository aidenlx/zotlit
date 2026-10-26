// PROTOTYPE (proto/view-reactivity) — throwaway. The one presentational panel
// every tab renders, so the tabs differ only in how they hold state.
import { useRef, useSyncExternalStore } from "react";

import type { CitedBySnapshot } from "@/services/citation-index/service";

import { labProbe } from "./source";
import type { ActiveNote } from "./source";

export interface PanelProps {
  readonly flavor: string;
  readonly note: ActiveNote | null;
  /** `null` while the first snapshot is loading. */
  readonly snapshot: CitedBySnapshot | null;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggleGroup: (path: string) => void;
  readonly atTrigger: boolean | null;
  readonly togglePending: boolean;
  readonly onToggleAtTrigger: () => void;
  readonly once: string;
  readonly onReadOnce: () => void;
  readonly onOpen: (path: string) => void;
}

const box = {
  border: "1px solid var(--background-modifier-border)",
  borderRadius: 6,
  padding: 8,
  marginBottom: 8,
} as const;

export function Panel(props: PanelProps) {
  const renders = useRef(0);
  renders.current += 1;
  const groups = (props.snapshot?.groups ?? []).filter((group) =>
    group.path.toLowerCase().includes(props.search.toLowerCase()),
  );
  return (
    <div>
      <div style={box}>
        <b>{props.flavor}</b> · panel renders: {renders.current}
        <div>
          active: {props.note?.path ?? "—"} · key: {props.note?.key ?? "—"}
        </div>
      </div>
      <div style={box}>
        <b>Setting</b> citation.at-trigger ={" "}
        {props.atTrigger === null ? "…" : String(props.atTrigger)}{" "}
        <button
          disabled={props.togglePending}
          onClick={props.onToggleAtTrigger}
        >
          {props.togglePending ? "Saving…" : "Toggle"}
        </button>
      </div>
      <div style={box}>
        <b>One-shot read</b>{" "}
        <button disabled={!props.note?.key} onClick={props.onReadOnce}>
          Read cited by
        </button>{" "}
        {props.once}
      </div>
      <div style={box}>
        <b>Cited by</b>{" "}
        {props.snapshot === null
          ? "loading…"
          : `${props.snapshot.groups.length} notes · ${props.snapshot.coverage}`}
        <div>
          <input
            type="search"
            placeholder="Filter"
            value={props.search}
            onInput={(e) => props.onSearch(e.currentTarget.value)}
          />
        </div>
        <ul>
          {groups.map((group) => (
            <li key={group.path}>
              <a onClick={() => props.onToggleGroup(group.path)}>
                {props.collapsed.has(group.path) ? "▸" : "▾"}
              </a>{" "}
              <a onClick={() => props.onOpen(group.path)}>{group.path}</a>
              {!props.collapsed.has(group.path) &&
                ` (${group.occurrences.length})`}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The probe, rendered the same way in every tab. */
export function DebugStrip() {
  const state = useSyncExternalStore(labProbe.subscribe, labProbe.get);
  return (
    <div style={{ ...box, fontFamily: "var(--font-monospace)", fontSize: 11 }}>
      live citedBy subscriptions: <b>{state.live}</b> · opened total:{" "}
      {state.opened} · late callbacks: <b>{state.lateCallbacks}</b>
      <pre style={{ margin: 0 }}>{state.log.join("\n")}</pre>
    </div>
  );
}

export function toggled(set: ReadonlySet<string>, path: string) {
  const next = new Set(set);
  if (!next.delete(path)) next.add(path);
  return next;
}
