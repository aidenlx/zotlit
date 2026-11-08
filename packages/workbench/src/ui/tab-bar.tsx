// The tab strip over the authoring panes and the panel each tab opens. The
// strip owns the keyboard: arrow keys move through the tabs and choose as they
// go, Home and End jump to the ends. The chosen tab lives in the editor's model.

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useOptionalEditor, useWorkbenchModel } from "./editor";
import { useContainerName, useOptionalHost } from "./host";
import { useWorkbenchMessages } from "./messages";
import { setTab as tabTransition } from "./model";
import { SliceEditorVisibility } from "./slice-editor";
import { TABS, tabDocs, tabLabel, tabLede } from "./tabs";
import type { WorkbenchTab } from "./tabs";
import { useParts } from "./theme";
import { useRetention } from "./visited";

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
  tabs = TABS,
}: {
  onTabChange?: (tab: WorkbenchTab) => void;
  defaultProfile?: boolean;
  /** The tabs this document shows; the Template Document kind picks the set. */
  tabs?: readonly WorkbenchTab[];
} = {}) {
  const m = useWorkbenchMessages();
  const editor = useOptionalEditor();
  const model = useWorkbenchModel();
  const tab = useAtomValue(model.tab);
  const setView = useAtomSet(model.view);
  const setTab = (next: WorkbenchTab) => setView(tabTransition(next));
  const part = useParts("tabBar");
  const name = useContainerName(m.workbench_title());
  const prefix = editor?.id ?? "";
  useAtomValue(model.document.revision);
  const current = useAtomValue(model.controller);
  const controller = editor === null ? undefined : current;
  const disabled = editor === null;
  const identity = useRef({
    controller,
    id: controller?.document?.manifest.id,
  });
  if (identity.current.controller !== controller)
    identity.current = { controller, id: undefined };
  if (controller?.document)
    identity.current.id = controller.document.manifest.id;
  const isDefault = defaultProfile ?? identity.current.id === "default";
  const enabledTabs = tabs.filter((id) => !(isDefault && id === "match"));
  useEffect(() => {
    if (isDefault && tab === "match") setView(tabTransition("note"));
  }, [isDefault, tab, setView]);

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
      {...name.attrs}
      aria-orientation="horizontal"
      onKeyDown={disabled ? undefined : onKeyDown}
      {...part("tab-bar")}
    >
      {name.hiddenName}
      {tabs.map((id) => {
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
 * The docs page that shows how to write `tab`'s part of the template, set
 * after the tab's lede. A host that names no docs site gets nothing.
 */
export function TabDocsLink({ tab }: { tab: WorkbenchTab }) {
  const m = useWorkbenchMessages();
  const docsUrl = useOptionalHost()?.docsUrl;
  const part = useParts("tabPanel");
  if (docsUrl === undefined) return null;
  const { label, path } = tabDocs(m, tab);
  return (
    <a
      href={`${docsUrl}${path}`}
      target="_blank"
      rel="noreferrer"
      {...part("docs-link")}
    >
      {label}
    </a>
  );
}

/**
 * The panel `tab` opens. A tab the reader has opened before stays in the page,
 * hidden, so an editor inside keeps its view; one never opened is gone.
 */
export function TabPanel({
  tab,
  modeActive = true,
  children,
  description = true,
}: {
  tab: WorkbenchTab;
  /** Whether the mode that owns this panel is visible. */
  modeActive?: boolean;
  children?: ReactNode;
  description?: boolean;
}) {
  const m = useWorkbenchMessages();
  const editor = useOptionalEditor();
  const active = useAtomValue(useWorkbenchModel().tab) === tab;
  const part = useParts("tabPanel");
  const prefix = editor?.id ?? "";
  // A tab's occupant is the tab itself, so the list never changes and a visit
  // is remembered for as long as the editor lives.
  const occupants = useMemo(() => new Map([[tab, tab]]), [tab]);
  const retention = useRetention(occupants);
  const { open } = retention;
  useEffect(() => {
    if (active) open(tab);
  }, [active, open, tab]);
  if (!active && !retention.isRetained(tab)) return null;
  const shown = active && modeActive;
  return (
    <div
      role="tabpanel"
      id={panelId(prefix, tab)}
      aria-labelledby={tabId(prefix, tab)}
      hidden={!shown}
      {...part("tab-panel", shown ? "active" : "inactive")}
    >
      {description && tab !== "match" && (
        <p {...part("description")}>
          {tabLede(m, tab)} <TabDocsLink tab={tab} />
        </p>
      )}
      <SliceEditorVisibility visible={shown}>{children}</SliceEditorVisibility>
    </div>
  );
}
