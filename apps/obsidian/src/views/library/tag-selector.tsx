// The Tag Selector at the foot of the Library Tree: the tags of the Items the
// selected node lists, as chips beside the Reading State facets, with a box
// that filters the names it shows. A chip selects its tag; the tree hands the
// selection to the host, which makes it filters of the list.
//
// @see apps/obsidian/docs/adr/0078-the-tag-selector-writes-tag-filters.md
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useStore } from "zustand";

import { useUniqueId } from "@zotlit/ui";

import * as m from "@/lib/i18n/generated/messages";

import { FILTER_CHIP_CLASS } from "./chip";
import type { LibraryTree } from "./library-tree";

/**
 * The tag names to show out of `names`: those that hold `filter`, whatever
 * the case, and every selected one, so a selection never hides.
 */
export function shownTags(
  names: readonly string[],
  selected: readonly string[],
  filter: string,
): string[] {
  const needle = filter.trim().toLocaleLowerCase();
  return names.filter(
    (name) =>
      selected.includes(name) || name.toLocaleLowerCase().includes(needle),
  );
}

/** The keys that move between the chips, as the tree's arrows move between rows. */
const STEPS: Readonly<Record<string, (at: number, last: number) => number>> = {
  ArrowRight: (at, last) => Math.min(at + 1, last),
  ArrowDown: (at, last) => Math.min(at + 1, last),
  ArrowLeft: (at) => Math.max(at - 1, 0),
  ArrowUp: (at) => Math.max(at - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function TagSelector({ tree }: { tree: LibraryTree }) {
  const names = useStore(tree.store, (s) => s.tagList);
  const selected = useStore(tree.store, (s) => s.tags);
  const filter = useStore(tree.store, (s) => s.tagFilter);
  const headingId = useUniqueId();
  const filterLabel = useUniqueId();
  // The chip Tab lands on: the last one the keyboard reached, else the first.
  const [current, setCurrent] = useState<string | null>(null);
  const shown = shownTags(names ?? selected, selected, filter);
  const stop = current !== null && shown.includes(current) ? current : shown[0];

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const name = shown[index]!;
    const step = STEPS[event.key];
    if (event.key === "Enter" || event.key === " ") tree.toggleTag(name);
    else if (event.key === "Escape" && tree.store.getState().open)
      tree.setOpen(false);
    else if (step) {
      const to = step(index, shown.length - 1);
      setCurrent(shown[to]!);
      event.currentTarget.parentElement
        ?.querySelectorAll<HTMLElement>("[data-library-tag]")
        [to]?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    // Named by its heading on screen: an `aria-label` would show a tooltip.
    <div
      role="group"
      aria-labelledby={headingId}
      data-library-tags=""
      className="zt:flex zt:flex-col zt:gap-(--size-2-2) zt:border-t-(length:--border-width) zt:border-(--background-modifier-border) zt:pt-(--size-4-2)"
    >
      <div className="zt:flex zt:items-baseline zt:justify-between zt:gap-(--size-2-2) zt:px-(--size-4-2)">
        {/* The group goes by this name alone, not as text of its own. */}
        <div
          id={headingId}
          aria-hidden="true"
          className="zt:text-(length:--font-ui-smaller) zt:font-(--font-semibold) zt:text-muted-foreground"
        >
          {m.library_view_tags_label()}
        </div>
        {selected.length > 0 && (
          <div
            role="button"
            tabIndex={0}
            data-library-tags-clear=""
            className="zt:cursor-(--cursor) zt:rounded-(--radius-s) zt:text-(length:--font-ui-smaller) zt:text-muted-foreground zt:outline-hidden zt:hover:text-(--text-normal) zt:focus-visible:shadow-[0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]"
            onClick={() => tree.clearTags()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              tree.clearTags();
            }}
          >
            {m.library_view_tags_clear()}
          </div>
        )}
      </div>
      {/* Hundreds of tags scroll here, so the tree above stays in reach. The
          padding keeps each chip's focus ring inside the scroll box. */}
      <div className="zt:flex zt:max-h-56 zt:flex-wrap zt:content-start zt:gap-(--size-2-2) zt:overflow-y-auto zt:p-(--size-2-1) zt:px-(--size-4-2)">
        {shown.map((name, index) => (
          <div
            key={name}
            role="button"
            tabIndex={name === stop ? 0 : -1}
            data-library-tag={name}
            aria-pressed={selected.includes(name)}
            className={`${FILTER_CHIP_CLASS} zt:max-w-full zt:[overflow-wrap:anywhere]`}
            onClick={() => {
              setCurrent(name);
              tree.toggleTag(name);
            }}
            onFocus={() => setCurrent(name)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {name}
          </div>
        ))}
        {names !== null && shown.length === 0 && (
          <span
            data-library-tags-empty=""
            className="zt:text-(length:--font-ui-smaller) zt:text-muted-foreground"
          >
            {filter.trim() === ""
              ? m.library_view_tags_none()
              : m.library_view_tags_no_match()}
          </span>
        )}
      </div>
      <div className="zt:px-(--size-4-2)">
        <span id={filterLabel} className="zt:sr-only">
          {m.library_view_tags_filter()}
        </span>
        <input
          type="text"
          data-library-tags-filter=""
          aria-labelledby={filterLabel}
          placeholder={m.library_view_tags_filter()}
          value={filter}
          className="zt:w-full"
          onChange={(event) => tree.setTagFilter(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (filter !== "") tree.setTagFilter("");
            else if (tree.store.getState().open) tree.setOpen(false);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </div>
    </div>
  );
}
