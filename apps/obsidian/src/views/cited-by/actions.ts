// Preview loading, collapse controls, and source navigation for one Cited By Sidebar.
import { Keymap, TFile } from "obsidian";
import type { App } from "obsidian";
import { createContext, useContext } from "react";
import type { MouseEvent } from "react";

import { yieldToMain } from "@/lib/yield-to-main";
import type {
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";

import { currentOccurrence, openCitedByOccurrence } from "./navigation";
import { citationContext, occurrenceID } from "./store";
import type { CitedByPreview, CitedByStore, OccurrenceContext } from "./store";

/** Source notes previewed between two yields to the host. */
const PREVIEW_CHUNK = 5;

export interface CitedByActions {
  setSearch: (search: string) => void;
  /** Show or hide the search field; hiding also drops the applied query. */
  toggleSearch: () => void;
  /** Switch every excerpt between its compact line and its enclosing block. */
  toggleMoreContext: () => void;
  /**
   * Stream a preview into every group of the current snapshot, replacing any
   * work still queued for an earlier one.
   */
  loadPreviews: (groups: readonly CitedByGroup[]) => void;
  invalidatePreview: (path: string) => void;
  toggleGroup: (path: string) => void;
  toggleSection: () => void;
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
  let queued: CitedByGroup[] = [];
  let draining = false;

  const setPreview = (path: string, preview: CitedByPreview): void => {
    store.setState(({ previews }) => ({
      previews: { ...previews, [path]: preview },
    }));
  };

  const loadPreview = async (group: CitedByGroup): Promise<void> => {
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
    let source: string;
    try {
      source = await app.vault.cachedRead(file);
    } catch {
      if (generations.get(group.path) === generation) {
        setPreview(group.path, { status: "unavailable", mtime });
      }
      return;
    }
    if (generations.get(group.path) !== generation || file.stat.mtime !== mtime)
      return;
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
  };

  /** One read at a time, yielding to the host between short batches. */
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      let loaded = 0;
      for (let group = queued.shift(); group; group = queued.shift()) {
        await loadPreview(group);
        if ((loaded += 1) % PREVIEW_CHUNK === 0) await yieldToMain();
      }
    } finally {
      draining = false;
    }
  };

  return {
    setSearch(search) {
      store.setState({ search });
    },
    toggleSearch() {
      store.setState(({ searchVisible }) =>
        searchVisible
          ? { searchVisible: false, search: "" }
          : { searchVisible: true },
      );
    },
    toggleMoreContext() {
      store.setState(({ moreContext }) => ({ moreContext: !moreContext }));
    },
    loadPreviews(groups) {
      queued = [...groups];
      void drain();
    },
    invalidatePreview(path) {
      generations.set(path, (generations.get(path) ?? 0) + 1);
      store.setState(({ previews }) => {
        if (!(path in previews)) return {};
        const next = { ...previews };
        delete next[path];
        return { previews: next };
      });
      const group = store
        .getState()
        .snapshot.groups.find((candidate) => candidate.path === path);
      if (!group) return;
      queued.push(group);
      void drain();
    },
    toggleGroup(path) {
      store.setState(({ collapsed }) => ({
        collapsed: collapsed.includes(path)
          ? collapsed.filter((item) => item !== path)
          : [...collapsed, path],
      }));
    },
    toggleSection() {
      store.setState(({ sectionCollapsed }) => ({
        sectionCollapsed: !sectionCollapsed,
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
  const cache = app.metadataCache.getFileCache(file);
  return Object.fromEntries(
    occurrences.map((occurrence) => [
      occurrenceID(occurrence),
      citationContext(
        source,
        currentOccurrence({ app, file, source, occurrence }),
        cache,
      ),
    ]),
  );
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
