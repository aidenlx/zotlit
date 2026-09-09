// The tab strip over the authoring panes and the panel each tab opens. The
// strip owns the keyboard: arrow keys move through the tabs and choose as they
// go, Home and End jump to the ends. The chosen tab lives in the editor's store.

import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import {
  useDocumentRevision,
  useOptionalEditor,
  useWorkbenchStore,
} from "./editor";
import { useWorkbenchMessages } from "./messages";
import { TABS, tabLabel } from "./tabs";
import type { WorkbenchTab } from "./tabs";
import { useParts } from "./theme";

function tabId(prefix: string, tab: WorkbenchTab): string {
  return `${prefix}tab-${tab}`;
}

function panelId(prefix: string, tab: WorkbenchTab): string {
  return `${prefix}panel-${tab}`;
}

/** Where an arrow or a jump key lands, from `index`; `null` for any other key. */
function keyTarget(key: string, index: number, length: number): number | null {
  const last = length - 1;
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
  defaultProfile,
}: {
  onTabChange?: (tab: WorkbenchTab) => void;
  defaultProfile?: boolean;
} = {}) {
  const m = useWorkbenchMessages();
  const editor = useOptionalEditor();
  const tab = useWorkbenchStore((state) => state.tab);
  const setTab = useWorkbenchStore((state) => state.setTab);
  const part = useParts("tabBar");
  const prefix = editor?.id ?? "";
  useDocumentRevision(editor?.controller ?? null);
  const disabled = editor === null;
  const identity = useRef({
    controller: editor?.controller,
    id: editor?.controller.document?.manifest.id,
  });
  if (identity.current.controller !== editor?.controller)
    identity.current = { controller: editor?.controller, id: undefined };
  if (editor?.controller.document)
    identity.current.id = editor.controller.document.manifest.id;
  const isDefault = defaultProfile ?? identity.current.id === "default";
  const enabledTabs = TABS.filter((id) => !(isDefault && id === "match"));
  useEffect(() => {
    if (isDefault && tab === "match") setTab("note");
  }, [isDefault, tab, setTab]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = keyTarget(
      event.key,
      enabledTabs.indexOf(tab),
      enabledTabs.length,
    );
    if (target === null) return;
    event.preventDefault();
    const next = enabledTabs[target]!;
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
        const tabDisabled = disabled || (isDefault && id === "match");
        const active = id === tab && !tabDisabled;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(prefix, id)}
            aria-selected={active}
            aria-controls={panelId(prefix, id)}
            aria-disabled={tabDisabled || undefined}
            disabled={tabDisabled}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (tabDisabled) return;
              setTab(id);
              onTabChange?.(id);
            }}
            {...part("tab", active ? "active" : "inactive")}
          >
            {tabLabel(m, id)}
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
