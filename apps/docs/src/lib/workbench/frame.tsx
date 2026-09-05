// The Workbench frame — the page shell, the header, the sample row, the
// status line, the main grid with the field column and the two panes, and the
// toolbar, tab strip, and result header the panes open with — shared by the
// live Workbench and the skeleton the route paints before the editor bundle
// arrives. The route's chunk imports this module, so it imports React, the
// messages, the UI kit, icons, and the connection bar only.

import {
  ChevronDown,
  Code2,
  Download,
  FolderOpen,
  List,
  Plus,
  Redo2,
  Undo2,
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
  return `min-h-80 min-w-0 flex-1 flex-col min-[780px]:min-h-0 ${
    shown ? "flex" : "hidden min-[780px]:flex"
  }`;
}

export function WorkbenchFrame({
  name,
  actions,
  strips,
  sample,
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
  /** The strips between the header and the sample row. */
  strips?: ReactNode;
  sample: ReactNode;
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
    <div
      aria-busy={busy || undefined}
      className="flex min-h-[calc(100dvh-var(--fd-banner-height,0px))] flex-col bg-fd-background text-fd-foreground min-[780px]:h-[calc(100dvh-var(--fd-banner-height,0px))] min-[780px]:min-h-[40rem]"
    >
      <a
        href="#workbench-editor"
        className="sr-only focus:not-sr-only focus:p-3"
      >
        {m.workbench_skip_editor()}
      </a>
      {children}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-fd-border px-4 py-3 min-[780px]:px-6">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-fd-muted-foreground">
            {m.workbench_title()}
          </p>
          <h1 className="font-serif text-xl font-medium break-words">{name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </header>

      {strips}

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4 min-[780px]:px-6">
        {sample}
      </div>
      <p
        role="status"
        className="px-4 pt-2 text-xs text-fd-muted-foreground min-[780px]:px-6"
      >
        {status}
      </p>

      <main
        id="workbench-editor"
        className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 min-[780px]:grid min-[780px]:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] min-[780px]:gap-5 min-[780px]:px-6 min-[1180px]:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1fr)_minmax(0,0.85fr)]"
      >
        {/* The pane and the result are columns of their own once there is
            room for both. */}
        <div
          role="group"
          aria-label={m.workbench_view_label()}
          className="flex gap-1 rounded-md bg-fd-muted p-1 min-[780px]:hidden"
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
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={m.workbench_editing_mode()}
      >
        <Button
          variant={advanced ? "ghost" : "outline"}
          size="sm"
          aria-pressed={!advanced}
          disabled={onMode === undefined}
          onClick={() => onMode?.(false)}
        >
          <List aria-hidden />
          {m.workbench_basic()}
        </Button>
        <Button
          variant={advanced ? "outline" : "ghost"}
          size="sm"
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
          className="min-[1180px]:hidden"
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
    <TabsList aria-label={m.workbench_title()} className="mb-3">
      {TABS.map((id) => (
        <TabsTrigger
          key={id}
          value={id}
          disabled={disabled}
          className="min-w-0 flex-1 px-2"
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
}: {
  heading: string;
  showMarkdown: boolean;
  onShowMarkdown?: (showMarkdown: boolean) => void;
}) {
  return (
    <div className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2">
      <h2 className="font-serif text-lg font-medium">{heading}</h2>
      <label className="flex items-center gap-2 text-sm">
        <span className="sr-only">{m.workbench_preview_format()}</span>
        <NativeSelect
          value={showMarkdown ? "markdown" : "reading"}
          disabled={onShowMarkdown === undefined}
          onChange={(event) =>
            onShowMarkdown?.(event.target.value === "markdown")
          }
          size="sm"
        >
          <NativeSelectOption value="reading">
            {m.workbench_preview_reading()}
          </NativeSelectOption>
          <NativeSelectOption value="markdown">
            {m.workbench_result_markdown_toggle()}
          </NativeSelectOption>
        </NativeSelect>
      </label>
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
      className="group min-h-0 flex-1 overflow-auto rounded-md border border-fd-border bg-fd-card p-4 shadow-sm sm:p-6"
    >
      {children}
    </div>
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
          <Button variant="outline" disabled>
            <ProfileMenuLabel />
          </Button>
          <Button disabled>
            <Download aria-hidden />
            {m.workbench_download()}
          </Button>
        </>
      }
      strips={
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
      sample={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium">
            {m.workbench_showing_label()}
          </span>
          <Placeholder className="h-10 w-72 max-w-full" />
        </div>
      }
      status={m.workbench_loading()}
      view="edit"
      fields={<Placeholder className="min-h-40" />}
      editor={
        <>
          <EditToolbar advanced={false} />
          <Tabs className="flex min-h-0 flex-1 flex-col" value="note">
            <PaneTabList disabled />
            <Placeholder className="min-h-40 flex-1" />
          </Tabs>
        </>
      }
      result={
        <>
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
