// Preview loading, collapse controls, and source navigation for one Cited By Sidebar.
import { Keymap, Menu, TFile } from "obsidian";
import type { App } from "obsidian";
import { createContext, useContext } from "react";
import type { MouseEvent } from "react";

import * as m from "@/lib/i18n/generated/messages";
import { yieldToMain } from "@/lib/yield-to-main";
import type {
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";

import { currentOccurrence, openCitedByOccurrence } from "./navigation";
import {
  citationContext,
  CITED_BY_SORT_GROUPS,
  excerptKey,
  excerptKeyIn,
  excerptRange,
  expandExcerptRange,
  occurrenceID,
  sortCitedByGroups,
  sourceOutline,
} from "./store";
import type {
  CitedByPreview,
  CitedBySortMode,
  CitedByStore,
  ExpandDirection,
  OccurrenceContext,
} from "./store";

/** Source notes previewed between two yields to the host. */
const PREVIEW_CHUNK = 5;

const SORT_LABELS: Record<CitedBySortMode, () => string> = {
  alphabetical: m.cited_by_sort_alphabetical,
  alphabeticalReverse: m.cited_by_sort_alphabetical_reverse,
  byModifiedTime: m.cited_by_sort_modified_time,
  byModifiedTimeReverse: m.cited_by_sort_modified_time_reverse,
  byCreatedTime: m.cited_by_sort_created_time,
  byCreatedTimeReverse: m.cited_by_sort_created_time_reverse,
};

export interface CitedByActions {
  setSearch: (search: string) => void;
  /** Show or hide the search field; hiding also drops the applied query. */
  toggleSearch: () => void;
  /** Switch every excerpt between its compact line and its enclosing block. */
  toggleMoreContext: () => void;
  /** Reveal the logical chunk next to one excerpt on one of its sides. */
  expandExcerpt: (options: {
    group: CitedByGroup;
    occurrence: CitationOccurrence;
    direction: ExpandDirection;
  }) => void;
  /** Offer the six sort modes, with the one in force marked. */
  showSortMenu: (event: MouseEvent) => void;
  /** Order source groups by one mode, reading vault metadata now. */
  sortGroups: (
    groups: readonly CitedByGroup[],
    mode: CitedBySortMode,
  ) => readonly CitedByGroup[];
  /**
   * Stream a preview into every group of the current snapshot, replacing any
   * work still queued for an earlier one.
   */
  loadPreviews: (groups: readonly CitedByGroup[]) => void;
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
      outline: sourceOutline(app.metadataCache.getFileCache(file)),
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
    expandExcerpt({ group, occurrence, direction }) {
      const { expansions, moreContext, previews } = store.getState();
      const preview = previews[group.path];
      if (preview?.status !== "ready") return;
      const context = preview.contexts[occurrenceID(occurrence)];
      if (context?.status !== "ready") return;
      const key = excerptKey(group.path, occurrence);
      const range = expandExcerptRange({
        source: preview.source,
        outline: preview.outline,
        range: excerptRange(context, {
          moreContext,
          expansion: expansions[key],
        }),
        direction,
      });
      store.setState({ expansions: { ...expansions, [key]: range } });
    },
    showSortMenu(event) {
      openSortMenu(event, {
        current: store.getState().sort,
        select: (sort) => store.setState({ sort }),
      });
    },
    sortGroups(groups, mode) {
      return sortCitedByGroups(groups, mode, (path) => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        const { mtime, ctime } = file.stat;
        return { name: file.basename, mtime, ctime };
      });
    },
    loadPreviews(groups) {
      queued = [...groups];
      void drain();
    },
    invalidatePreview(path) {
      generations.set(path, (generations.get(path) ?? 0) + 1);
      store.setState(({ expansions, previews }) => {
        // Every expansion holds offsets into the source that just changed, so
        // this note's excerpts start from their mode range again.
        const kept = Object.entries(expansions).filter(
          ([key]) => !excerptKeyIn(key, path),
        );
        const stale = kept.length !== Object.keys(expansions).length;
        if (!(path in previews) && !stale) return {};
        const next = { ...previews };
        delete next[path];
        return {
          previews: next,
          ...(stale && { expansions: Object.fromEntries(kept) }),
        };
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

/**
 * The sort menu, one section per Backlinks mode pair. A keyboard click carries
 * no pointer position (`detail` of `0`), so the menu takes the button's own
 * corner instead of the window's.
 */
function openSortMenu(
  event: MouseEvent,
  options: {
    current: CitedBySortMode;
    select: (mode: CitedBySortMode) => void;
  },
): void {
  const menu = new Menu().setNoIcon();
  for (const pair of CITED_BY_SORT_GROUPS) {
    for (const mode of pair) {
      menu.addItem((item) =>
        item
          .setTitle(SORT_LABELS[mode]())
          .setChecked(mode === options.current)
          .onClick(() => options.select(mode)),
      );
    }
    menu.addSeparator();
  }

  if (event.detail === 0) {
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: left, y: bottom });
    return;
  }
  menu.showAtMouseEvent(event.nativeEvent);
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
