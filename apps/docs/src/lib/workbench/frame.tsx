// The Workbench frame — the page shell, the header, the status line,
// the main grid with the field column and the two panes, and the
// toolbar, tab strip, and result header the panes open with — shared by the
// live Workbench and the skeleton the route paints before the editor bundle
// arrives. The route's chunk imports this module, so it imports React, the
// messages, the UI kit, icons, and the connection bar only.

import { Popover } from "@base-ui/react/popover";
import {
  ChevronDown,
  CircleHelp,
  Code2,
  Download,
  FolderOpen,
  List,
  Plus,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import type { ReactNode, Ref } from "react";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { m } from "@/paraglide/messages.js";

import { ConnectionBar } from "./connection-bar";
import { TABS, TAB_LABEL } from "./tabs";

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
  /** The connection control beside the file actions. */
  connection: ReactNode;
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
          {connection}
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
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
      {footer}
      <p
        role="status"
        className="shrink-0 border-t border-fd-border px-3 py-1.5 text-xs leading-normal text-fd-muted-foreground"
      >
        {status}
      </p>
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

/**
 * The row above the editor: Basic against Advanced, undo and redo, and the
 * "Add a field" button the narrow layout opens the field sheet with. Every
 * control without a handler is disabled.
 */
export function EditToolbar({
  advanced,
  onMode,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  addFieldRef,
  sheetOpen = false,
  onAddField,
}: {
  advanced: boolean;
  onMode?: (advanced: boolean) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  addFieldRef?: Ref<HTMLButtonElement>;
  sheetOpen?: boolean;
  onAddField?: () => void;
}) {
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div
        className="flex items-center gap-0.5 rounded-md bg-fd-muted p-0.5"
        role="group"
        aria-label={m.workbench_editing_mode()}
      >
        <Button
          variant="ghost"
          size="sm"
          className="min-h-7 gap-1.5 rounded-sm px-2 py-0.5 text-xs text-fd-muted-foreground aria-pressed:bg-fd-card aria-pressed:text-fd-foreground aria-pressed:shadow-sm [&_svg]:size-3.5"
          aria-pressed={!advanced}
          disabled={onMode === undefined}
          onClick={() => onMode?.(false)}
        >
          <List aria-hidden />
          {m.workbench_basic()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-7 gap-1.5 rounded-sm px-2 py-0.5 text-xs text-fd-muted-foreground aria-pressed:bg-fd-card aria-pressed:text-fd-foreground aria-pressed:shadow-sm [&_svg]:size-3.5"
          aria-pressed={advanced}
          disabled={onMode === undefined}
          onClick={() => onMode?.(true)}
        >
          <Code2 aria-hidden />
          {m.workbench_advanced()}
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 [&_svg]:size-3.5"
          aria-label={m.workbench_undo()}
          title={m.workbench_undo()}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 [&_svg]:size-3.5"
          aria-label={m.workbench_redo()}
          title={m.workbench_redo()}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 aria-hidden />
        </Button>
        <Button
          ref={addFieldRef}
          variant="outline"
          size="sm"
          disabled={onAddField === undefined}
          onClick={onAddField}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className="min-h-8 gap-1.5 px-2 py-1 text-xs min-[1180px]:hidden [&_svg]:size-3.5"
        >
          <Plus aria-hidden />
          {m.workbench_add_field()}
        </Button>
      </div>
    </div>
  );
}

/** The three tabs' strip, inside the `Tabs` root that owns the chosen one. */
export function PaneTabList({ disabled = false }: { disabled?: boolean }) {
  return (
    <TabsList
      aria-label={m.workbench_title()}
      className="min-w-0 gap-0.5 p-0.5"
    >
      {TABS.map((id) => (
        <TabsTrigger
          key={id}
          value={id}
          disabled={disabled}
          className="min-h-7 min-w-0 px-2 py-0.5 text-xs"
        >
          {TAB_LABEL[id]()}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/** The result pane's heading beside the reading-or-Markdown choice. */
export function ResultHeader({
  heading,
  showMarkdown,
  onShowMarkdown,
  controls,
  help,
}: {
  heading: string;
  showMarkdown: boolean;
  onShowMarkdown?: (showMarkdown: boolean) => void;
  controls?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div className="mb-2 flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-2 min-[1180px]:flex-nowrap">
      <h2 className="shrink-0 text-xs font-semibold">{heading}</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 min-[1180px]:flex-1 min-[1180px]:flex-nowrap">
        {controls}
        <label className="flex min-w-0 items-center text-xs min-[1180px]:flex-1">
          <span className="sr-only">{m.workbench_preview_format()}</span>
          <NativeSelect
            value={showMarkdown ? "markdown" : "reading"}
            disabled={onShowMarkdown === undefined}
            onChange={(event) =>
              onShowMarkdown?.(event.target.value === "markdown")
            }
            size="xs"
            className="w-full"
          >
            <NativeSelectOption value="reading">
              {m.workbench_preview_reading()}
            </NativeSelectOption>
            <NativeSelectOption value="markdown">
              {m.workbench_result_markdown_toggle()}
            </NativeSelectOption>
          </NativeSelect>
        </label>
        {help}
      </div>
    </div>
  );
}

/** The box the rendered note is read in. */
export function ResultRegion({
  ref,
  emphasis,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={m.workbench_view_result()}
      ref={ref}
      data-emphasis={emphasis || undefined}
      className="group min-h-0 flex-1 overflow-auto rounded-md border border-fd-border bg-fd-card p-4"
    >
      {children}
    </div>
  );
}

/** Guidance stays next to its task without taking a row from the editor. */
export function WorkbenchHelp({
  title,
  children,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={
              compact
                ? "min-h-8 gap-1.5 px-2 py-1 text-xs [&_svg]:size-3.5"
                : undefined
            }
          />
        }
      >
        <CircleHelp aria-hidden />
        {m.workbench_help()}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-fd-border bg-fd-popover p-3 text-fd-popover-foreground shadow-lg">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Popover.Title className="text-sm font-semibold">
                {title}
              </Popover.Title>
              <Popover.Close
                render={
                  <Button variant="ghost" size="icon" className="size-8" />
                }
                aria-label={m.workbench_fields_close()}
              >
                <X aria-hidden />
              </Popover.Close>
            </div>
            <Popover.Description className="text-sm leading-relaxed text-pretty">
              {children}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
    <WorkbenchFrame
      busy
      name={m.workbench_loading()}
      actions={
        <>
          <Button variant="outline" size="sm" disabled>
            <ProfileMenuLabel />
          </Button>
          <Button size="sm" disabled>
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
          cancellable={false}
          message={null}
          saveBusy
          editingConnectedProfile={false}
          onConnect={() => {}}
          onCancel={() => {}}
          onDisconnect={() => {}}
        />
      }
      status={m.workbench_loading()}
      view="edit"
      fields={<Placeholder className="min-h-40" />}
      editor={
        <>
          <EditToolbar advanced={false} />
          <Tabs className="flex min-h-0 flex-1 flex-col" value="note">
            <div className="mb-2 flex shrink-0 gap-2">
              <PaneTabList disabled />
            </div>
            <Placeholder className="min-h-40 flex-1" />
          </Tabs>
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
  );
}
