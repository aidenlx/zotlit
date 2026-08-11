// Preview loading, collapse controls, and source navigation for one Cited By Sidebar.
import { Keymap, TFile } from "obsidian";
import type { App } from "obsidian";
import { createContext, useContext } from "react";
import type { MouseEvent } from "react";

import type {
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";

import { currentOccurrence, openCitedByOccurrence } from "./navigation";
import { occurrenceID } from "./store";
import type { CitedByPreview, CitedByStore, OccurrenceContext } from "./store";

export interface CitedByActions {
  setSearch: (search: string) => void;
  requestPreview: (group: CitedByGroup) => void;
  invalidatePreview: (path: string) => void;
  toggleGroup: (path: string) => void;
  expandAll: (paths?: readonly string[]) => void;
  collapseAll: (paths?: readonly string[]) => void;
  openSource: (path: string, event: MouseEvent) => void;
  openOccurrence: (
    group: CitedByGroup,
    occurrence: CitationOccurrence,
    event: MouseEvent,
  ) => void;
}

export function createCitedByActions(options: {
  app: App;
  store: CitedByStore;
}): CitedByActions {
  const { app, store } = options;
  const generations = new Map<string, number>();

  const setPreview = (path: string, preview: CitedByPreview): void => {
    store.setState(({ previews }) => ({
      previews: { ...previews, [path]: preview },
    }));
  };

  return {
    setSearch(search) {
      store.setState({ search });
    },
    requestPreview(group) {
      const file = app.vault.getAbstractFileByPath(group.path);
      const current = store.getState().previews[group.path];
      if (!(file instanceof TFile)) {
        if (current?.status === "unavailable" && current.mtime === -1) return;
        setPreview(group.path, { status: "unavailable", mtime: -1 });
        return;
      }
      const mtime = file.stat.mtime;
      if (current?.mtime === mtime) {
        if (current.status !== "ready") return;
        const missing = group.occurrences.filter(
          (occurrence) => !(occurrenceID(occurrence) in current.contexts),
        );
        if (missing.length === 0) return;
        setPreview(group.path, {
          ...current,
          contexts: {
            ...current.contexts,
            ...contextsFrom({
              app,
              file,
              source: current.source,
              occurrences: missing,
            }),
          },
        });
        return;
      }

      const generation = (generations.get(group.path) ?? 0) + 1;
      generations.set(group.path, generation);
      setPreview(group.path, { status: "loading", mtime });
      void app.vault.cachedRead(file).then(
        (source) => {
          if (
            generations.get(group.path) !== generation ||
            file.stat.mtime !== mtime
          ) {
            return;
          }
          setPreview(group.path, {
            status: "ready",
            mtime,
            source,
            contexts: contextsFrom({
              app,
              file,
              source,
              occurrences: group.occurrences,
            }),
          });
        },
        () => {
          if (generations.get(group.path) !== generation) return;
          setPreview(group.path, { status: "unavailable", mtime });
        },
      );
    },
    invalidatePreview(path) {
      generations.set(path, (generations.get(path) ?? 0) + 1);
      store.setState(({ previews }) => {
        if (!(path in previews)) return {};
        const next = { ...previews };
        delete next[path];
        return { previews: next };
      });
    },
    toggleGroup(path) {
      store.setState(({ collapsed }) => ({
        collapsed: collapsed.includes(path)
          ? collapsed.filter((item) => item !== path)
          : [...collapsed, path],
      }));
    },
    expandAll(paths) {
      if (!paths) {
        store.setState({ collapsed: [] });
        return;
      }
      store.setState(({ collapsed }) => ({
        collapsed: collapsed.filter((path) => !paths.includes(path)),
      }));
    },
    collapseAll(paths) {
      store.setState(({ collapsed, snapshot }) => ({
        collapsed: [
          ...new Set([
            ...collapsed,
            ...(paths ?? snapshot.groups.map(({ path }) => path)),
          ]),
        ],
      }));
    },
    openSource(path, event) {
      void app.workspace.openLinkText(
        path,
        "",
        Keymap.isModEvent(event.nativeEvent),
      );
    },
    openOccurrence(group, occurrence, event) {
      void openCitedByOccurrence(app, { group, occurrence, event });
    },
  };
}

function contextsFrom(options: {
  app: App;
  file: TFile;
  source: string;
  occurrences: readonly CitationOccurrence[];
}): Record<string, OccurrenceContext> {
  const { app, file, source, occurrences } = options;
  return Object.fromEntries(
    occurrences.map((occurrence) => [
      occurrenceID(occurrence),
      contextLine(source, currentOccurrence({ app, file, source, occurrence })),
    ]),
  );
}

function contextLine(
  source: string,
  occurrence: CitationOccurrence | null,
): OccurrenceContext {
  if (!occurrence) return { status: "unavailable" };
  const { start, end } = occurrence.position;
  const lineStart = source.lastIndexOf("\n", Math.max(0, start.offset - 1)) + 1;
  const nextBreak = source.indexOf("\n", end.offset);
  const lineEnd = nextBreak === -1 ? source.length : nextBreak;
  return {
    status: "ready",
    before: source.slice(lineStart, start.offset),
    token: source.slice(start.offset, end.offset),
    after: source.slice(end.offset, lineEnd),
  };
}

export const CitedByActionsContext = createContext<CitedByActions | null>(null);

export function useCitedByActions(): CitedByActions {
  const actions = useContext(CitedByActionsContext);
  if (!actions) {
    throw new Error(
      "useCitedByActions must be used within CitedByActionsContext",
    );
  }
  return actions;
}
