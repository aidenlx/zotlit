// Shared DOM primitives for the batch-modal shell and its manifest bodies.
import { setIcon } from "obsidian";

import { cn } from "@/lib/utils";
import type { BatchFailure } from "@/services/batch-run";

export type RowStatus = "pending" | "done" | "skipped" | "failed";

export const ROW_ICON: Record<RowStatus, string> = {
  pending: "circle-dashed",
  done: "check",
  skipped: "minus",
  failed: "x",
};

export const ROW_ICON_CLASS: Record<RowStatus, string> = {
  pending: "zt:text-(--text-faint)",
  done: "zt:text-(--text-success)",
  skipped: "zt:text-(--text-muted)",
  failed: "zt:text-(--text-error)",
};

export const ICON_CLS = "zt:flex zt:shrink-0";

/**
 * Sticky category label (Obsidian UI-smaller scale, not an editor heading): it
 * pins to the top of the scroll region so the current group stays labeled while
 * its rows scroll, over a modal-surface background that hides them underneath.
 */
export const SECTION_SUMMARY_CLS =
  "zt:sticky zt:top-0 zt:z-10 zt:mb-1 zt:cursor-pointer zt:select-none zt:bg-(--modal-background) zt:py-1 zt:text-xs zt:font-semibold zt:uppercase zt:tracking-wide zt:text-(--text-muted)";

/** Groups larger than this start collapsed, so the modal opens on a compact
 * overview of group headers and the user can collapse past a group of thousands
 * to reach the next one instead of scrolling through it. */
export const SECTION_OPEN_MAX = 50;

// `content-visibility: auto` lets the browser skip layout/paint for off-screen
// rows in an expanded group while keeping every <li> (and its updatable status
// icon) live in the DOM; the intrinsic-size estimate keeps the scrollbar steady.
const ROW_CLS =
  "zt:flex zt:items-center zt:gap-2 zt:py-0.5 zt:min-w-0 zt:[content-visibility:auto] zt:[contain-intrinsic-size:auto_1.5rem]";
const ROW_LABEL_CLS = "zt:truncate zt:text-sm zt:text-(--text-normal)";

/** Collapsible titled section: a sticky summary label above a reset `<ul>`;
 * `open` starts the group expanded (see {@link SECTION_OPEN_MAX}). */
export function section(
  parent: HTMLElement,
  header: string,
  open: boolean,
): HTMLElement {
  const details = parent.createEl("details", {
    cls: "zt:mb-4 zt:last:mb-0",
    attr: open ? { open: "" } : {},
  });
  details.createEl("summary", { text: header, cls: SECTION_SUMMARY_CLS });
  return details.createEl("ul", { cls: "zt:m-0 zt:list-none zt:p-0" });
}

/** One checklist row: a leading icon span (returned for status styling) and a
 * truncated label whose full text shows as a hover tooltip. `indent` nests the
 * row under a parent header (the hierarchy tree). */
export function row(
  ul: HTMLElement,
  label: string,
  opts?: { indent?: boolean },
): HTMLElement {
  const li = ul.createEl("li", {
    cls: cn(ROW_CLS, opts?.indent && "zt:pl-6"),
  });
  const icon = li.createSpan({ cls: ICON_CLS });
  li.createSpan({
    text: label,
    cls: ROW_LABEL_CLS,
    attr: { "aria-label": label },
  });
  return icon;
}

/** Paint a status icon into a row's leading span. */
export function setRowIcon(icon: HTMLElement, status: RowStatus): void {
  icon.className = `${ICON_CLS} ${ROW_ICON_CLASS[status]}`;
  setIcon(icon, ROW_ICON[status]);
}

export interface StaticGroup {
  header: string;
  items: readonly { label: string }[];
  icon: string;
  colorCls: string;
}

/** A static (non-updating) section of icon + label rows, skipped when empty. */
export function listGroup(parent: HTMLElement, group: StaticGroup): void {
  if (group.items.length === 0) return;
  const ul = section(
    parent,
    group.header,
    group.items.length <= SECTION_OPEN_MAX,
  );
  for (const item of group.items) {
    const icon = row(ul, item.label);
    icon.addClass(group.colorCls);
    setIcon(icon, group.icon);
  }
}

/** A failed-item row: an x-icon + truncated label, with the error message on a
 * second muted line indented under the label. Shared by the live run-phase
 * panel and the summary's Failed group. */
export function failureRow(ul: HTMLElement, failure: BatchFailure): void {
  const li = ul.createEl("li", {
    cls: "zt:py-0.5 zt:min-w-0 zt:[content-visibility:auto] zt:[contain-intrinsic-size:auto_2.5rem]",
  });
  const r = li.createDiv({
    cls: "zt:flex zt:items-center zt:gap-2 zt:min-w-0",
  });
  setIcon(r.createSpan({ cls: `${ICON_CLS} zt:text-(--text-error)` }), "x");
  r.createSpan({
    text: failure.label,
    cls: "zt:truncate zt:text-sm",
    attr: { "aria-label": failure.label },
  });
  li.createDiv({
    text: failure.message,
    cls: "zt:text-xs zt:text-(--text-muted) zt:pl-6",
  });
}
