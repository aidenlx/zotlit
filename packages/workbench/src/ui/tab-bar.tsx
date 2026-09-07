// The tab strip over the authoring panes and the panel each tab opens. The
// strip owns the keyboard: arrow keys move through the tabs and choose as they
// go, Home and End jump to the ends. The chosen tab lives in the editor's store.

import type { KeyboardEvent, ReactNode } from "react";

import { useOptionalEditor, useWorkbenchStore } from "./editor";
import { m } from "./paraglide/messages.js";
import { TABS, TAB_LABEL } from "./tabs";
import type { WorkbenchTab } from "./tabs";
import { useParts } from "./theme";

function tabId(prefix: string, tab: WorkbenchTab): string {
  return `${prefix}tab-${tab}`;
}

function panelId(prefix: string, tab: WorkbenchTab): string {
  return `${prefix}panel-${tab}`;
}

/** Where an arrow or a jump key lands, from `index`; `null` for any other key. */
function keyTarget(key: string, index: number): number | null {
  const last = TABS.length - 1;
  switch (key) {
    case "ArrowRight":
      return index === last ? 0 : index + 1;
    case "ArrowLeft":
      return index === 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/** The tabs' strip; inert outside an editor. */
export function TabBar({
  onTabChange,
}: { onTabChange?: (tab: WorkbenchTab) => void } = {}) {
  const editor = useOptionalEditor();
  const tab = useWorkbenchStore((state) => state.tab);
  const setTab = useWorkbenchStore((state) => state.setTab);
  const part = useParts("tabBar");
  const prefix = editor?.id ?? "";
  const disabled = editor === null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = keyTarget(event.key, TABS.indexOf(tab));
    if (target === null) return;
    event.preventDefault();
    const next = TABS[target]!;
    setTab(next);
    onTabChange?.(next);
    event.currentTarget
      .querySelector<HTMLElement>(`#${CSS.escape(tabId(prefix, next))}`)
      ?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={m.workbench_title()}
      aria-orientation="horizontal"
      onKeyDown={disabled ? undefined : onKeyDown}
      {...part("tab-bar")}
    >
      {TABS.map((id) => {
        const active = id === tab;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(prefix, id)}
            aria-selected={active}
            aria-controls={panelId(prefix, id)}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              setTab(id);
              onTabChange?.(id);
            }}
            {...part("tab", active ? "active" : "inactive")}
          >
            {TAB_LABEL[id]()}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The panel `tab` opens. An inactive panel is gone unless `keepMounted`
 * holds it in the page, hidden, so an editor inside keeps its state.
 */
export function TabPanel({
  tab,
  keepMounted = false,
  children,
}: {
  tab: WorkbenchTab;
  keepMounted?: boolean;
  children?: ReactNode;
}) {
  const editor = useOptionalEditor();
  const active = useWorkbenchStore((state) => state.tab) === tab;
  const part = useParts("tabPanel");
  const prefix = editor?.id ?? "";
  if (!active && !keepMounted) return null;
  return (
    <div
      role="tabpanel"
      id={panelId(prefix, tab)}
      aria-labelledby={tabId(prefix, tab)}
      hidden={!active}
      {...part("tab-panel", active ? "active" : "inactive")}
    >
      {children}
    </div>
  );
}
