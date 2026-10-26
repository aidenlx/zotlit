// Preview loading, collapse controls, and source navigation for one Cited By Sidebar.
import { Keymap, Menu, TFile } from "obsidian";
import type { App } from "obsidian";
import { createContext, useContext } from "react";
import type { MouseEvent } from "react";

import * as m from "@/lib/i18n/generated/messages";
import { showMenuAtButton } from "@/lib/menu";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { yieldToMain } from "@/lib/yield-to-main";
import { activeCitedByAtom } from "@/services/citation-index/atoms";
import type { ParsedNote } from "@/services/citation-index/parsed-note";
import type { PlainCitationIndex } from "@/services/citation-index/plain";
import type {
  CitedByGroup,
  CitationOccurrence,
} from "@/services/citation-index/service";

import type { CitedByModel } from "./model";
import { openCitedByOccurrence } from "./navigation";
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
  showSortMenu: (event: MouseEvent<HTMLElement>) => void;
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
  citationIndex: Pick<PlainCitationIndex, "getParsedNote">;
  registry: ViewRegistryHandle;
  model: CitedByModel;
}): CitedByActions {
  const { app, citationIndex, registry, model } = options;
  /** The source groups of the followed note's Cited By. */
  const shownGroups = () => registry.get(activeCitedByAtom)?.groups ?? [];
  const generations = new Map<string, number>();
  let queued: CitedByGroup[] = [];
  let draining = false;

  const setPreview = (path: string, preview: CitedByPreview): void => {
    registry.update(model.previews, (previews) => ({
      ...previews,
      [path]: preview,
    }));
  };

  const loadPreview = async (group: CitedByGroup): Promise<void> => {
    const file = app.vault.getAbstractFileByPath(group.path);
    const current = registry.get(model.previews)[group.path];
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
      const facts = current.facts;
      setPreview(group.path, {
        ...current,
        contexts: {
          ...current.contexts,
          ...contextsFrom({
            facts,
            app,
            file,
            source: facts.source,
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
    let facts: ParsedNote;
    try {
      facts = await citationIndex.getParsedNote(file);
      source = facts.source;
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
      facts,
      mtime,
      source,
      outline: sourceOutline(app.metadataCache.getFileCache(file)),
      contexts: contextsFrom({
        facts,
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
      registry.update(model.layout, (layout) => ({ ...layout, search }));
    },
    toggleSearch() {
      registry.update(model.layout, (layout) =>
        layout.searchVisible
          ? { ...layout, searchVisible: false, search: "" }
          : { ...layout, searchVisible: true },
      );
    },
    toggleMoreContext() {
      registry.update(model.layout, (layout) => ({
        ...layout,
        moreContext: !layout.moreContext,
      }));
    },
    expandExcerpt({ group, occurrence, direction }) {
      const { moreContext } = registry.get(model.layout);
      const { expansions } = registry.get(model.note);
      const preview = registry.get(model.previews)[group.path];
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
      registry.update(model.note, (note) => ({
        ...note,
        expansions: { ...note.expansions, [key]: range },
      }));
    },
    showSortMenu(event) {
      openSortMenu(event, {
        current: registry.get(model.layout).sort,
        select: (sort) =>
          registry.update(model.layout, (layout) => ({ ...layout, sort })),
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
      // Every expansion holds offsets into the source that just changed, so
      // this note's excerpts start from their mode range again.
      const { expansions } = registry.get(model.note);
      const kept = Object.entries(expansions).filter(
        ([key]) => !excerptKeyIn(key, path),
      );
      if (kept.length !== Object.keys(expansions).length) {
        registry.update(model.note, (note) => ({
          ...note,
          expansions: Object.fromEntries(kept),
        }));
      }
      if (path in registry.get(model.previews)) {
        registry.update(model.previews, (previews) => {
          const next = { ...previews };
          delete next[path];
          return next;
        });
      }
      const group = shownGroups().find((candidate) => candidate.path === path);
      if (!group) return;
      queued.push(group);
      void drain();
    },
    toggleGroup(path) {
      registry.update(model.note, (note) => ({
        ...note,
        collapsed: note.collapsed.includes(path)
          ? note.collapsed.filter((item) => item !== path)
          : [...note.collapsed, path],
      }));
    },
    expandAll(paths) {
      registry.update(model.note, (note) => ({
        ...note,
        collapsed: paths
          ? note.collapsed.filter((path) => !paths.includes(path))
          : [],
      }));
    },
    collapseAll(paths) {
      registry.update(model.note, (note) => ({
        ...note,
        collapsed: [
          ...new Set([
            ...note.collapsed,
            ...(paths ?? shownGroups().map(({ path }) => path)),
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
      void openCitedByOccurrence(app, {
        citationIndex,
        group,
        occurrence,
        event,
      });
    },
  };
}

/**
 * The sort menu, one section per Backlinks mode pair, anchored under the button
 * that opened it.
 */
function openSortMenu(
  event: MouseEvent<HTMLElement>,
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

  showMenuAtButton(menu, event.currentTarget);
}

function contextsFrom(options: {
  app: App;
  facts: ParsedNote;
  file: TFile;
  source: string;
  occurrences: readonly CitationOccurrence[];
}): Record<string, OccurrenceContext> {
  const { app, facts, file, source, occurrences } = options;
  const cache = app.metadataCache.getFileCache(file);
  return Object.fromEntries(
    occurrences.map((occurrence) => [
      occurrenceID(occurrence),
      citationContext(source, facts.currentOccurrence(occurrence), cache),
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
