// The Workbench frame — the page shell, the header, the status line,
// the main grid with the field column and the two panes, and the
// toolbar, tab strip, and result header the panes open with — shared by the
// live Workbench and the skeleton the route paints before the editor bundle
// arrives. The route's chunk imports this module, so it imports React, the
// shared Workbench UI and its messages, the UI kit, icons, the web theme, and
// the connection bar only.

import {
  ChevronDown,
  CircleHelp,
  Download,
  FolderOpen,
  Plus,
} from "lucide-react";
import type { ReactNode, Ref } from "react";

import {
  EditToolbar,
  ResultHeader,
  ResultRegion,
  TabBar,
  WorkbenchThemeProvider,
  m,
} from "@zotlit/workbench/ui";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import { m as docsMessages } from "@/paraglide/messages.js";

import { ConnectionBar } from "./connection-bar";
import { WEB_THEME } from "./theme";

/** The two the narrow screen shows one of. */
export type WorkbenchView = "edit" | "result";

/** A pane section: shown, or kept for the wide layout alone. */
function paneClass(shown: boolean): string {
  return `min-h-0 min-w-0 flex-1 flex-col ${
    shown ? "flex" : "hidden min-[780px]:flex"
  }`;
}

export function WorkbenchFrame({
  name,
  actions,
  connection,
  notifications,
  strips,
  status,
  view,
  onView,
  fields,
  editor,
  result,
  footer,
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
  status: ReactNode;
  view: WorkbenchView;
  /** The narrow view switch's handler; without one the switch is inert. */
  onView?: (view: WorkbenchView) => void;
  fields: ReactNode;
  editor: ReactNode;
  result: ReactNode;
  /** The strip under the grid. */
  footer?: ReactNode;
  /** Whether the page is still filling in. */
  busy?: boolean;
  /** Hidden helpers: the file input and the dialogs. */
  children?: ReactNode;
}) {
  return (
    // The page sits under the site's banner strip, so its height is the window
    // less whatever that strip takes; a dismissed strip leaves the whole window.
    // Short, narrow windows scroll the page so wrapped controls still leave
    // enough height to edit several lines.
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

      <main
        id="workbench-editor"
        className="flex min-h-0 flex-1 flex-col gap-3 p-3 min-[780px]:grid min-[780px]:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] min-[1180px]:grid-cols-[18rem_minmax(0,1fr)_minmax(0,0.9fr)]"
      >
        {/* The pane and the result are columns of their own once there is
            room for both. */}
        <div
          role="group"
          aria-label={m.workbench_view_label()}
          className="flex shrink-0 gap-1 rounded-md bg-fd-muted p-1 min-[780px]:hidden"
        >
          {(["edit", "result"] as const).map((id) => (
            <Button
              key={id}
              variant={view === id ? "outline" : "ghost"}
              aria-pressed={view === id}
              aria-controls={`workbench-${id}-pane`}
              size="xs"
              className="flex-1"
              disabled={onView === undefined}
              onClick={() => onView?.(id)}
            >
              {id === "edit"
                ? m.workbench_view_editor()
                : m.workbench_view_result()}
            </Button>
          ))}
        </div>

        {/* A column of its own where three fit; under that width the same list
            is what "Add a field" opens. */}
        <div className="hidden min-h-0 min-w-0 grid-cols-1 min-[1180px]:grid">
          {fields}
        </div>

        <section
          id="workbench-edit-pane"
          className={paneClass(view === "edit")}
        >
          {editor}
        </section>

        <section
          id="workbench-result-pane"
          className={paneClass(view === "result")}
        >
          {result}
        </section>
      </main>
      <footer
        aria-label={docsMessages.docs_workbench_status()}
        className="sticky bottom-0 z-20 shrink-0 border-t border-fd-border bg-fd-background"
      >
        <div className="max-h-[min(12rem,30dvh)] overflow-y-auto overscroll-contain">
          {footer}
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

/**
 * The "Add a field" button the narrow layout opens the field sheet with, on
 * the toolbar's trailing edge; without a handler it is inert.
 */
export function AddFieldButton({
  ref,
  open = false,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  open?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      ref={ref}
      variant="outline"
      size="xs"
      disabled={onClick === undefined}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="min-[1180px]:hidden"
    >
      <Plus aria-hidden />
      {m.workbench_add_field()}
    </Button>
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
        view="edit"
        fields={<Placeholder className="min-h-40" />}
        editor={
          <>
            <EditToolbar>
              <AddFieldButton />
            </EditToolbar>
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
                {m.workbench_showing_label()}
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
  );
}
