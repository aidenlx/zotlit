// The Workbench frame — the page shell, the header, the status line,
// the main area with the field list and the two panes, and the
// toolbar, tab strip, and result header the panes open with — shared by the
// live Workbench and the skeleton the route paints before the editor bundle
// arrives. The route's chunk imports this module, so it imports React, the
// shared Workbench UI, the site's messages, the UI kit, icons, the web theme, and
// the connection bar only.

import { ChevronDown, CircleHelp, Download, FolderOpen } from "lucide-react";
import type { ReactNode, Ref } from "react";

import {
  EditToolbar,
  ResultHeader,
  ResultRegion,
  INITIAL_PANELS,
  TabBar,
  usePanelProperties,
  useParts,
  WorkbenchThemeProvider,
  WorkbenchMessagesProvider,
} from "@zotlit/workbench/ui";
import type { PanelSide, WorkbenchPanels } from "@zotlit/workbench/ui";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { m } from "@/paraglide/messages.js";

import { ConnectionBar } from "./connection-bar";
import { WEB_THEME } from "./theme";

/** A pane section, which fills the place the layout gives it. */
const PANE_CLASS = "flex min-h-0 min-w-0 flex-1 flex-col";

/** The three parts the main area arranges. */
export interface FrameParts {
  readonly fields: ReactNode;
  /** The pane the source and the Problems area share. */
  readonly edit: ReactNode;
  readonly result: ReactNode;
}

/**
 * The panels a new page shows: both, the Fields Panel at the width of the
 * field column it replaced (18rem), the Preview at its initial width.
 */
export const PAGE_PANELS: WorkbenchPanels = {
  fields: { shown: true, width: 288 },
  preview: { ...INITIAL_PANELS.preview, shown: true },
};

/**
 * The parts as a new page first paints them, before it measures its frame:
 * the panels of {@link PAGE_PANELS} as columns, drawn with the live panels'
 * parts and custom properties.
 */
function FirstPaint({ fields, edit, result }: FrameParts) {
  const part = useParts("panels");
  const properties = usePanelProperties();
  const column = (side: PanelSide, content: ReactNode) => (
    <div
      style={{ [properties.width]: `${PAGE_PANELS[side].width}px` }}
      {...part("panel", side)}
    >
      {content}
    </div>
  );
  return (
    <div {...part("panels")}>
      {column("fields", fields)}
      <div aria-hidden {...part("edge", "fields")} />
      <div {...part("stack")}>
        <div {...part("editor")}>{edit}</div>
      </div>
      <div aria-hidden {...part("edge", "preview")} />
      {column("preview", result)}
    </div>
  );
}

export function WorkbenchFrame({
  name,
  actions,
  connection,
  notifications,
  strips,
  item,
  status,
  fields,
  editor,
  problems,
  result,
  arrange = (parts) => <FirstPaint {...parts} />,
  mainRef,
  busy = false,
  children,
}: {
  /** The Profile name the header carries. */
  name: ReactNode;
  /** The header's buttons. */
  actions: ReactNode;
  /** The connection control in the bottom status area. */
  connection: ReactNode;
  /** Persistent action failures above the status row. */
  notifications?: ReactNode;
  /** Notices that need attention before editing. */
  strips?: ReactNode;
  /** The item row, which names what every panel reads; it spans the panels. */
  item?: ReactNode;
  status: ReactNode;
  fields: ReactNode;
  editor: ReactNode;
  /** The Problems area, which shares the editor pane with the source. */
  problems?: ReactNode;
  result: ReactNode;
  /** Places the parts in the main area; the skeleton paints the first layout. */
  arrange?: (parts: FrameParts) => ReactNode;
  /** The main area, which the live page measures to place its panels. */
  mainRef?: Ref<HTMLElement>;
  /** Whether the page is still filling in. */
  busy?: boolean;
  /** Hidden helpers: the file input and the dialogs. */
  children?: ReactNode;
}) {
  return (
    // The page sits under the site's banner strip, so its height is the window
    // less whatever that strip takes; a dismissed strip leaves the whole window.
    // Short, narrow windows scroll the page so wrapped controls still leave
    // enough height to edit several lines: under 780 px the header wraps to
    // two or three rows, and a page held to the window would leave the main
    // area less than the editor's 320 px floor (EDITOR_MIN) with the Preview
    // under it. At 44rem the main area keeps that floor.
    <div
      aria-busy={busy || undefined}
      className="flex h-[calc(100dvh-var(--fd-banner-height,0px))] min-h-0 flex-col bg-fd-background font-sans text-sm leading-normal text-fd-foreground max-[780px]:min-h-[44rem]"
    >
      <a
        href="#workbench-editor"
        className="sr-only focus:not-sr-only focus:p-3"
      >
        {m.workbench_skip_editor()}
      </a>
      {children}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-fd-border px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm text-fd-muted-foreground">
            {m.workbench_title()}
          </p>
          <h1 className="text-base font-semibold break-words">{name}</h1>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      </header>

      {strips}
      {item}

      <main
        ref={mainRef}
        id="workbench-editor"
        className="flex min-h-0 flex-1 p-3"
      >
        {arrange({
          fields: (
            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1">
              {fields}
            </div>
          ),
          // The pane the source and the Problems area share. It measures
          // itself, so whether a reading fits beside the source is the
          // pane's own question rather than the window's.
          edit: (
            <section
              id="workbench-edit-pane"
              className={`@container-[size]/workbench-editor ${PANE_CLASS}`}
            >
              {editor}
              {problems}
            </section>
          ),
          result: (
            <section id="workbench-result-pane" className={PANE_CLASS}>
              {result}
            </section>
          ),
        })}
      </main>
      <footer
        aria-label={m.docs_workbench_status()}
        className="sticky bottom-0 z-20 shrink-0 border-t border-fd-border bg-fd-background"
      >
        <div className="max-h-[min(12rem,30dvh)] overflow-y-auto overscroll-contain">
          {notifications}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1">
          {connection}
          <p
            role="status"
            className="min-w-0 text-xs leading-normal text-pretty text-fd-muted-foreground"
          >
            {status}
          </p>
        </div>
      </footer>
    </div>
  );
}

/** What the Profile menu's button reads, on the live page and the skeleton. */
export function ProfileMenuLabel() {
  return (
    <>
      <FolderOpen aria-hidden />
      {m.workbench_profile_menu()}
      <ChevronDown aria-hidden />
    </>
  );
}

/** Guidance stays next to its task without taking a row from the editor. */
export function WorkbenchHelp({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="xs" />}>
        <CircleHelp aria-hidden />
        {m.workbench_help()}
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{children}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}

/** A quiet block where content is still to come. */
function Placeholder({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`rounded-md bg-fd-muted/60 ${className}`} />
  );
}

/**
 * The page as the shell paints it before the editor bundle arrives: the same
 * frame with every control inert, and quiet blocks where the panes go.
 */
export function WorkbenchSkeleton() {
  return (
    <WorkbenchMessagesProvider messages={m}>
      <WorkbenchThemeProvider theme={WEB_THEME}>
        <WorkbenchFrame
          busy
          name={m.workbench_loading()}
          actions={
            <>
              <Button variant="outline" size="xs" disabled>
                <ProfileMenuLabel />
              </Button>
              <Button size="xs" disabled>
                <Download aria-hidden />
                {m.workbench_download()}
              </Button>
            </>
          }
          connection={
            <ConnectionBar
              connection={{ state: "disconnected" }}
              website=""
              busy={false}
              resumable={false}
              saveBusy
              editingConnectedProfile={false}
              onReconnect={() => {}}
              onDisconnect={() => {}}
            />
          }
          status={m.workbench_loading()}
          fields={<Placeholder className="min-h-40" />}
          editor={
            <>
              <EditToolbar />
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2 flex shrink-0 gap-2">
                  <TabBar />
                </div>
                <Placeholder className="min-h-40 flex-1" />
              </div>
            </>
          }
          result={
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-fd-muted-foreground">
                  {m.docs_workbench_showing_label()}
                </span>
                <Placeholder className="h-8 min-w-0 flex-1" />
              </div>
              <ResultHeader
                heading={m.workbench_result_heading()}
                showMarkdown={false}
              />
              <ResultRegion>
                <Placeholder className="h-full min-h-40" />
              </ResultRegion>
            </>
          }
        />
      </WorkbenchThemeProvider>
    </WorkbenchMessagesProvider>
  );
}
