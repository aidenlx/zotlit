// The toolbar's Search: a button that opens a field which finds text in the
// rows on screen. It filters the cards the query gave; it runs no query.
import { useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/obsidian/icon";
import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import { cn, tooltipAttrs } from "@/lib/utils";
import { useAnnotStore, useSetFilterQuery } from "@/views/annot-view/store";

import { TOOLBAR_LABEL } from "./toolbar-popover";

export function SearchControl() {
  const query = useAnnotStore((s) => s.filterQuery);
  const setQuery = useSetFilterQuery();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // A field the button reveals takes the focus once it is mounted.
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  const close = () => {
    setQuery("");
    setOpen(false);
    buttonRef.current?.focus();
  };
  return (
    <div className="zt:flex zt:items-center zt:gap-1">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        {...tooltipAttrs(m.query_view_search())}
        data-query-toolbar="search"
        className={cn(
          "clickable-icon zt:flex zt:items-center zt:gap-1",
          (open || query !== "") && "is-active",
        )}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="search" size={14} />
        {!open && (
          <span className={TOOLBAR_LABEL}>{m.query_view_search()}</span>
        )}
      </button>
      {open && (
        <SearchInput
          ref={inputRef}
          type="text"
          data-query-search=""
          aria-label={m.query_view_search()}
          className="zt:w-48"
          value={query}
          onChange={setQuery}
          placeholder={m.query_view_search_placeholder()}
          clearLabel={m.query_view_search_clear()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            close();
          }}
        />
      )}
    </div>
  );
}
