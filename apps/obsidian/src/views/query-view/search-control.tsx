// The toolbar's Search: a button that opens a field which finds text in the
// rows on screen. It filters the cards the query gave; it runs no query.
import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import { SearchInput } from "@/components/obsidian/search-input";
import * as m from "@/lib/i18n/generated/messages";
import { cn } from "@/lib/utils";
import { useAnnotStore, useSetFilterQuery } from "@/views/annot-view/store";

import { datasetSpec } from "./datasets";
import { ToolbarButton } from "./toolbar-button";
import type { QueryView } from "./view";

export function SearchControl({ view }: { view: QueryView }) {
  const dataset = useStore(view.state, (s) => s.view?.from);
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
    <div
      className={cn(
        "zt:flex zt:items-center zt:gap-(--size-2-2)",
        // An open field shrinks on a narrow toolbar, so the buttons stay in
        // the row; a closed one keeps its button whole.
        open ? "zt:min-w-0" : "zt:min-w-min",
      )}
    >
      <ToolbarButton
        ref={buttonRef}
        icon="search"
        label={m.query_view_search()}
        labelClassName={open ? "zt:@xl:hidden" : undefined}
        aria-expanded={open}
        active={query !== ""}
        open={open}
        data-query-toolbar="search"
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <SearchInput
          ref={inputRef}
          type="text"
          data-query-search=""
          aria-label={m.query_view_search()}
          className="zt:w-48 zt:min-w-0 zt:shrink"
          value={query}
          onChange={setQuery}
          placeholder={datasetSpec(dataset).search()}
          clearLabel={m.query_view_clear_search()}
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
