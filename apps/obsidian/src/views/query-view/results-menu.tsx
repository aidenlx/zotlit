// The result count of the Query View toolbar, and the Results menu it opens:
// a limit that saves to the view, and "Copy to clipboard" and "Export CSV…"
// for the rows on screen, with one column for each visible property.
//
// The menu is a native popover rather than a Chooser: its limit field takes
// the arrow keys and Enter, which a Chooser's key scope would hold.
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useStore } from "zustand";

import { useUniqueId } from "@zotlit/ui";

import { writeClipboardRichText } from "@/lib/clipboard";
import { saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { themeHook } from "@/lib/theme-hooks";
import { cn } from "@/lib/utils";

import { toCSV, toHTML, toTSV } from "./table";
import { ToolbarButtonContent, toolbarButtonClass } from "./toolbar-button";
import {
  PopoverAction,
  PopoverActions,
  PopoverSection,
  toolbarPopoverClass,
} from "./toolbar-popover";
import type { QueryView } from "./view";

const logger = getLogger(["views", "query-view", "results"]);

/** Copy the rows on screen as a table: tab-separated text and HTML. */
export async function copyResults(view: QueryView): Promise<void> {
  const table = view.table();
  try {
    await writeClipboardRichText({ html: toHTML(table), text: toTSV(table) });
    new BaseNotice(m.query_view_copied());
  } catch (error) {
    logger.warn("The Query View could not copy its results", { error });
    new BaseNotice(m.query_view_copy_failed());
  }
}

/** Save the rows on screen as a CSV file named after the view. */
export function exportResults(view: QueryView): void {
  const name = view.state.getState().view?.name || m.query_view_results_menu();
  saveFile(
    new Blob([toCSV(view.table())], { type: "text/csv" }),
    `${name}.csv`,
  );
}

function CountText({ view }: { view: QueryView }) {
  const phase = useStore(view.state, (s) => s.phase);
  // A failed run that keeps the last rows keeps their count too.
  const results = useStore(view.state, (s) => s.results);
  if (phase === "loading")
    return <span data-query-count="">{m.query_view_loading()}</span>;
  if (!results) return null;
  const { count, matched, truncated } = results;
  return (
    <span data-query-count={count} data-query-matched={matched}>
      {truncated
        ? m.query_view_results_limited({ count: matched, shown: count })
        : m.query_view_results({ count })}
    </span>
  );
}

function LimitField({ view, close }: { view: QueryView; close: () => void }) {
  const limit = useStore(view.state, (s) => s.view?.limit);
  const [text, setText] = useState(limit === undefined ? "" : String(limit));
  const [invalid, setInvalid] = useState(false);
  const id = useUniqueId();
  // The form a Bases results menu opens with: the label over a field that
  // takes the menu's width. An invalid number turns the field's own border
  // and focus ring to the error colour, through the variables they read.
  return (
    <PopoverSection className="zt:px-(--size-4-2) zt:pt-(--size-4-1) zt:pb-(--size-4-2) zt:text-sm">
      <label htmlFor={id} className="zt:px-(--size-2-1) zt:py-(--size-2-2)">
        {m.query_view_limit()}
      </label>
      <input
        id={id}
        type="number"
        min={1}
        step={1}
        value={text}
        placeholder={m.query_view_limit_placeholder()}
        data-query-limit=""
        aria-invalid={invalid || undefined}
        className="zt:w-full zt:aria-invalid:[--background-modifier-border-focus:var(--background-modifier-error)] zt:aria-invalid:[--background-modifier-border-hover:var(--background-modifier-error)] zt:aria-invalid:[--background-modifier-border:var(--background-modifier-error)]"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          if (next === "") {
            setInvalid(false);
            view.document.editView({ limit: undefined }, { typed: true });
            return;
          }
          const value = Number(next);
          const valid = Number.isInteger(value) && value > 0;
          setInvalid(!valid);
          if (valid) view.document.editView({ limit: value }, { typed: true });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key !== "Enter") return;
          event.preventDefault();
          close();
        }}
      />
    </PopoverSection>
  );
}

export function ResultsMenu({ view }: { view: QueryView }) {
  const current = useStore(view.state, (s) => s.view);
  const phase = useStore(view.state, (s) => s.phase);
  const matched = useStore(view.state, (s) => s.results?.matched ?? 0);
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const popupId = useUniqueId();
  const anchor = `--${popupId}`;
  const close = () => popup.current?.hidePopover();
  // The limit field takes focus once the open menu has drawn it.
  useLayoutEffect(() => {
    if (open)
      popup.current
        ?.querySelector<HTMLInputElement>("[data-query-limit]")
        ?.focus();
  }, [open]);
  if (!current) return null;
  return (
    <>
      {/* The count is plain muted text, and takes the free room after it,
          so the controls after it sit at the toolbar's end. */}
      <button
        type="button"
        popoverTarget={popupId}
        aria-expanded={open}
        data-query-results=""
        data-active={current.limit !== undefined ? "" : undefined}
        data-open={open ? "" : undefined}
        className={cn(
          toolbarButtonClass,
          "zt:me-auto zt:shrink zt:[anchor-name:var(--zt-query-popover-anchor)]",
        )}
        style={{ "--zt-query-popover-anchor": anchor } as CSSProperties}
      >
        <ToolbarButtonContent
          label={<CountText view={view} />}
          keepLabel
          labelClassName="zt:text-xs"
        />
      </button>
      <div
        ref={popup}
        id={popupId}
        popover="auto"
        data-query-results-popup=""
        onToggle={(event) => setOpen(event.newState === "open")}
        className={cn(
          themeHook.chooser,
          toolbarPopoverClass,
          "zt:max-w-80 zt:min-w-60",
        )}
        style={{ "--zt-query-popover-anchor": anchor } as CSSProperties}
      >
        {open && (
          <>
            {view.can.limit && <LimitField view={view} close={close} />}
            <PopoverActions>
              {/* The row stays in place while no limit is set, dimmed as Bases
                  dims it, so the rows under it hold still as a limit is typed. */}
              {view.can.limit && (
                <PopoverAction
                  icon="rotate-ccw"
                  data-query-show-all=""
                  disabled={current.limit === undefined || phase !== "ready"}
                  className="zt:disabled:cursor-default zt:disabled:text-faint zt:disabled:hover:bg-transparent zt:disabled:[&_svg]:text-faint"
                  onClick={() => {
                    view.document.editView({ limit: undefined });
                    close();
                  }}
                >
                  {m.query_view_show_all({ count: matched })}
                </PopoverAction>
              )}
              <PopoverAction
                icon="copy"
                data-query-copy=""
                onClick={() => {
                  close();
                  void copyResults(view);
                }}
              >
                {m.query_view_copy()}
              </PopoverAction>
              <PopoverAction
                icon="file-down"
                data-query-export=""
                onClick={() => {
                  close();
                  exportResults(view);
                }}
              >
                {m.query_view_export_csv()}
              </PopoverAction>
            </PopoverActions>
          </>
        )}
      </div>
    </>
  );
}
