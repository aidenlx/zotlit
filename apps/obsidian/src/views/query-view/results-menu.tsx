// The result count of the Query View toolbar, and the Results menu it opens:
// a limit that saves to the view, and "Copy to clipboard" and "Export CSV…"
// for the rows on screen, with one column for each visible property.
//
// The menu is a native popover rather than a Chooser: its limit field takes
// the arrow keys and Enter, which a Chooser's key scope would hold.
import type { IconName } from "obsidian";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useStore } from "zustand";

import { Icon } from "@/components/obsidian/icon";
import { writeClipboardRichText } from "@/lib/clipboard";
import { saveFile } from "@/lib/file-save";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { themeHook } from "@/lib/theme-hooks";
import { cn } from "@/lib/utils";

import { toCSV, toHTML, toTSV } from "./table";
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
  const count = useStore(view.state, (s) => s.count);
  const matched = useStore(view.state, (s) => s.matched);
  const truncated = useStore(view.state, (s) => s.truncated);
  if (phase === "loading")
    return <span data-query-count="">{m.query_view_loading()}</span>;
  if (phase !== "ready") return null;
  return (
    <span data-query-count={count} data-query-matched={matched}>
      {truncated
        ? m.query_view_results_limited({ count: matched, shown: count })
        : m.query_view_results({ count })}
    </span>
  );
}

function MenuRow({
  icon,
  onClick,
  children,
  ...rest
}: {
  icon: IconName;
  onClick: () => void;
  children: ReactNode;
  [data: `data-${string}`]: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className="zt:flex zt:w-full zt:cursor-clickable zt:items-center zt:gap-2 zt:rounded-sm zt:py-1 zt:ps-1.5 zt:pe-1 zt:text-start zt:text-sm zt:hover:bg-muted"
    >
      <Icon name={icon} size={14} className="zt:shrink-0" />
      <span className="zt:truncate">{children}</span>
    </button>
  );
}

function LimitField({ view, close }: { view: QueryView; close: () => void }) {
  const limit = useStore(view.state, (s) => s.view?.limit);
  const [text, setText] = useState(limit === undefined ? "" : String(limit));
  const [invalid, setInvalid] = useState(false);
  const id = useId();
  return (
    <div className="zt:flex zt:items-center zt:justify-between zt:gap-3 zt:px-1.5 zt:py-1 zt:text-sm">
      <label htmlFor={id}>{m.query_view_limit()}</label>
      <input
        id={id}
        type="number"
        min={1}
        step={1}
        value={text}
        placeholder={m.query_view_limit_placeholder()}
        data-query-limit=""
        className={cn("zt:w-20", invalid && "mod-error")}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          if (next === "") {
            setInvalid(false);
            view.editView({ limit: undefined }, { typed: true });
            return;
          }
          const value = Number(next);
          const valid = Number.isInteger(value) && value > 0;
          setInvalid(!valid);
          if (valid) view.editView({ limit: value }, { typed: true });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.key !== "Enter") return;
          event.preventDefault();
          close();
        }}
      />
    </div>
  );
}

export function ResultsMenu({ view }: { view: QueryView }) {
  const current = useStore(view.state, (s) => s.view);
  const phase = useStore(view.state, (s) => s.phase);
  const matched = useStore(view.state, (s) => s.matched);
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const popupId = `zt-query-results-${id.replaceAll(":", "")}`;
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
      <button
        type="button"
        popoverTarget={popupId}
        aria-expanded={open}
        data-query-results=""
        className={cn(
          "clickable-icon zt:shrink-0 zt:text-sm zt:whitespace-nowrap zt:text-(--text-muted) zt:[anchor-name:var(--zt-results-anchor)]",
          (current.limit !== undefined || open) && "is-active",
        )}
        style={{ "--zt-results-anchor": anchor } as CSSProperties}
      >
        <CountText view={view} />
      </button>
      <div
        ref={popup}
        id={popupId}
        popover="auto"
        data-query-results-popup=""
        onToggle={(event) => setOpen(event.newState === "open")}
        className={cn(
          themeHook.chooser,
          "zt:inset-auto zt:my-1 zt:max-w-80 zt:min-w-60 zt:flex-col zt:p-(--menu-padding) zt:[&:popover-open]:flex",
          "zt:border-(length:--menu-border-width) zt:border-(--menu-border-color) zt:bg-(--menu-background) zt:text-foreground zt:shadow-(--menu-shadow)",
          "zt:rounded-(--menu-radius) zt:[corner-shape:var(--menu-corner-shape)]",
          "zt:[position-anchor:var(--zt-results-anchor)] zt:[position-area:block-end_span-inline-end] zt:[position-try-fallbacks:flip-block]",
        )}
        style={{ "--zt-results-anchor": anchor } as CSSProperties}
      >
        {open && (
          <>
            <LimitField view={view} close={close} />
            {current.limit !== undefined && phase === "ready" && (
              <MenuRow
                icon="rotate-ccw"
                data-query-show-all=""
                onClick={() => {
                  view.editView({ limit: undefined });
                  close();
                }}
              >
                {m.query_view_show_all({ count: matched })}
              </MenuRow>
            )}
            <div
              role="presentation"
              className="zt:my-1 zt:h-[var(--menu-divider-width,1px)] zt:bg-[var(--menu-divider-color,var(--background-modifier-border))]"
            />
            <MenuRow
              icon="copy"
              data-query-copy=""
              onClick={() => {
                close();
                void copyResults(view);
              }}
            >
              {m.query_view_copy()}
            </MenuRow>
            <MenuRow
              icon="file-down"
              data-query-export=""
              onClick={() => {
                close();
                exportResults(view);
              }}
            >
              {m.query_view_export_csv()}
            </MenuRow>
          </>
        )}
      </div>
    </>
  );
}
