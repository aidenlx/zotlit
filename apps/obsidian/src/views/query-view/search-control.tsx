// The toolbar's Search: a button that opens a field which finds text in the
// rows on screen. It filters the cards the query gave; it runs no query. As
// in Bases, the field opens in a row of its own under the toolbar, and the
// button shows in the accent ink while the row stands.
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import { useAnnotStore, useSetFilterQuery } from "@/views/annot-view/store";

import { datasetSpec } from "./datasets";
import { useQueryViewState } from "./model";
import { ToolbarButton } from "./toolbar-button";
import type { QueryView } from "./view";

/** Whether the search row stands, and how the button and the row change it. */
export interface SearchBar {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  toggle: () => void;
  /** Close the row, clear the search, and give the focus back to the button. */
  close: () => void;
}

export function useSearchBar(): SearchBar {
  const setQuery = useSetFilterQuery();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setQuery("");
    setOpen(false);
    buttonRef.current?.focus();
  };
  return {
    open,
    buttonRef,
    toggle: () => (open ? close() : setOpen(true)),
    close,
  };
}

export function SearchButton({ bar }: { bar: SearchBar }) {
  return (
    <ToolbarButton
      ref={bar.buttonRef}
      icon="search"
      label={m.query_view_search()}
      aria-expanded={bar.open}
      active={bar.open}
      data-query-toolbar="search"
      onClick={bar.toggle}
    />
  );
}

/** The row under the toolbar that holds the search field, while it stands. */
export function SearchRow({ view, bar }: { view: QueryView; bar: SearchBar }) {
  const dataset = useQueryViewState(view, (s) => s.view?.from);
  const query = useAnnotStore((s) => s.filterQuery);
  const setQuery = useSetFilterQuery();
  const inputRef = useRef<HTMLInputElement>(null);
  // The field takes the focus once it is mounted.
  useLayoutEffect(() => {
    if (bar.open) inputRef.current?.focus({ preventScroll: true });
  }, [bar.open]);
  if (!bar.open) return null;
  return (
    // The row takes the toolbar's insets and its bottom border, and the field
    // fills the row without a box of its own.
    <div
      className={cn(
        "zt:flex zt:shrink-0 zt:items-center zt:border-b-(length:--border-width) zt:border-(--table-border-color) zt:py-(--size-2-2) zt:ps-[var(--zt-query-toolbar-inset-start,var(--size-2-1))] zt:pe-[var(--zt-query-toolbar-inset-end,var(--size-2-1))] zt:in-[.print]:hidden",
        "zt:[--background-modifier-form-field-hover:transparent] zt:[--background-modifier-form-field:transparent] zt:[--input-border-width-focus:0px] zt:[--input-border-width:0px] zt:[--input-shadow:none]",
      )}
    >
      <SearchInput
        className="zt:grow"
        ref={inputRef}
        type="text"
        data-query-search=""
        aria-label={m.query_view_search()}
        value={query}
        onChange={setQuery}
        placeholder={datasetSpec(dataset).search()}
        clearLabel={m.query_view_clear_search()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          bar.close();
        }}
      />
    </div>
  );
}
