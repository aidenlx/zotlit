// The host adapter: everything that opens over the page, and what only the
// host can answer — rendering, the vault's match vocabulary, where a field is
// inserted, and where a preference is kept (ADR 0044). Obsidian binds these to
// its `Menu`, `Modal`, `SuggestModal`, tooltips, and `Notice`; the web binds
// them to Base UI.

import type {
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "#/document/controller";
import type { SuggestionSource } from "#/language/completion";
import type { RenderedProperty, RenderedRange } from "#/render/result";
import type { RenderSchedulerOptions } from "#/render/scheduler";
import type { Extension } from "@codemirror/state";
import { createContext, useContext } from "react";
import type { ComponentType, HTMLAttributes, ReactNode } from "react";

import type { WorkbenchIcon } from "./theme";

export interface WorkbenchMenuItem {
  readonly label: string;
  readonly icon?: WorkbenchIcon;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface WorkbenchMenuRequest {
  /** The element the menu opens from. */
  readonly anchor: HTMLElement;
  readonly items: readonly WorkbenchMenuItem[];
  readonly submenus?: readonly {
    label: string;
    items: readonly WorkbenchMenuItem[];
  }[];
}

export interface WorkbenchDialogRequest {
  readonly title: string;
  readonly content: ReactNode;
  /** Told when the reader dismisses the dialog. */
  readonly onClose?: () => void;
}

export interface WorkbenchDialogHandle {
  close(): void;
}

export interface WorkbenchConfirmRequest {
  readonly title: string;
  readonly body: string;
  /** The confirming action's label. */
  readonly confirm: string;
  readonly cancel?: string;
}

export interface WorkbenchSuggesterOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
}

export interface WorkbenchSuggesterGroup {
  /** Text shown when this group has no options. */
  readonly empty?: string;
  readonly label: string;
  readonly options: readonly WorkbenchSuggesterOption[];
}

export interface WorkbenchSuggesterRequest {
  /** The control that receives focus after the chooser closes. */
  readonly anchor?: HTMLElement;
  readonly title: string;
  readonly placeholder?: string;
  readonly groups: readonly WorkbenchSuggesterGroup[];
  /** The option chosen now, if any. */
  readonly selected?: string;
}

export interface WorkbenchHoverCardRequest {
  readonly anchor: HTMLElement | DOMRect;
  readonly content: ReactNode;
}

export interface WorkbenchHoverCardHandle {
  close(): void;
}

/** A Library as a Match condition names it (ADR 0039). */
export interface WorkbenchLibrary {
  /** `personal`, or `group:<groupID>`. */
  readonly id: "personal" | `group:${number}`;
  /** The host's display name, where it has one. */
  readonly name?: string;
}

/** The names a Match condition can be written against. */
export interface WorkbenchMatchData {
  tags(): Promise<readonly string[]>;
  /** Root-first Collection path segments; display formatting stays in the UI. */
  collections(): Promise<readonly (readonly string[])[]>;
  libraries(): Promise<readonly WorkbenchLibrary[]>;
}

/** The slice editor a field is inserted into, and where in it. */
export interface WorkbenchInsertTarget {
  readonly slice: WorkbenchSliceId;
  readonly range: WorkbenchSliceRange;
}

/** Per-device preferences follow the machine; per-vault ones follow the vault. */
export type WorkbenchPreferenceScope = "device" | "vault";

export interface WorkbenchPersistence {
  read(scope: WorkbenchPreferenceScope, key: string): string | null;
  /** `null` forgets the preference. */
  write(
    scope: WorkbenchPreferenceScope,
    key: string,
    value: string | null,
  ): void;
}

export interface WorkbenchMarkdownProps {
  readonly markdown: string;
  readonly properties: readonly RenderedProperty[];
  readonly showMarkdown: boolean;
  readonly marks?: readonly RenderedRange[];
}

export interface WorkbenchHost {
  menu(request: WorkbenchMenuRequest): void;
  dialog(request: WorkbenchDialogRequest): WorkbenchDialogHandle;
  /** Resolves `true` when the reader confirms. */
  confirm(request: WorkbenchConfirmRequest): Promise<boolean>;
  /** Resolves the chosen option's id, or `null` when dismissed. */
  suggester(request: WorkbenchSuggesterRequest): Promise<string | null>;
  /** The attributes that give an in-page element a tooltip reading `text`. */
  tooltip(text: string): HTMLAttributes<HTMLElement>;
  hoverCard(request: WorkbenchHoverCardRequest): WorkbenchHoverCardHandle;
  notice(text: string): void;
  /** Renders one request; the tree schedules through `createRenderScheduler`. */
  render: RenderSchedulerOptions["startWorker"];
  /** The host reading view for a rendered note or annotation. */
  markdown: ComponentType<WorkbenchMarkdownProps>;
  /** Completion and hover presentation over the shared editor. */
  editorPopups?(read: SuggestionSource): Extension;
  matchData: WorkbenchMatchData;
  /** The focused slice editor, or `null` when none has had focus. */
  insertTarget(): WorkbenchInsertTarget | null;
  persistence: WorkbenchPersistence;
}

const HostContext = createContext<WorkbenchHost | null>(null);

export function WorkbenchHostProvider({
  host,
  children,
}: {
  host: WorkbenchHost;
  children?: ReactNode;
}) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

export function useWorkbenchHost(): WorkbenchHost {
  const host = useContext(HostContext);
  if (host === null) {
    throw new Error("The Workbench UI needs a WorkbenchHostProvider above it.");
  }
  return host;
}

/**
 * The tooltip attributes for `text`. Outside a host — the web's skeleton —
 * the browser's own `title` tooltip stands in.
 */
export function useTooltip(text: string): HTMLAttributes<HTMLElement> {
  const host = useContext(HostContext);
  return host?.tooltip(text) ?? { title: text };
}

/** The host, when the surface is mounted inside one. */
export function useOptionalHost(): WorkbenchHost | null {
  return useContext(HostContext);
}
