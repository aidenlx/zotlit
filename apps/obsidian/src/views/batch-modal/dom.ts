// Shared DOM primitives for the batch-modal shell and its manifest bodies.
import { setIcon, setTooltip } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { renderProfileRecovery } from "@/lib/profile-recovery";
import { cn } from "@/lib/utils";
import { yieldToMain } from "@/lib/yield-to-main";
import type { BatchFailure } from "@/services/batch-run";
import { describeSelectionSource } from "@/services/note-feature/selection-copy";

import type { BatchListControls, BatchProfileChoice } from "./types";

export interface BatchRow {
  label: string;
  path?: string;
  profile?: string;
  reason?: string;
}

export function profileChoiceControl(
  parent: HTMLElement,
  choice: BatchProfileChoice,
  controls?: BatchListControls,
): void {
  const container = parent.createDiv({
    cls: "zt:flex zt:flex-wrap zt:items-start zt:gap-x-4 zt:gap-y-2 zt:normal-case zt:tracking-normal zt:font-normal",
    attr: choice.scope ? { "data-profile-choice-scope": choice.scope } : {},
  });
  const text = profileChoiceText(choice);
  const description = container.createDiv({
    cls: "zt:min-w-0 zt:flex-1 zt:basis-56 zt:space-y-1",
  });
  if (choice.scope) {
    description.createDiv({
      text: profileChoiceLabel(choice),
      cls: "zt:text-sm zt:font-medium zt:text-(--text-normal)",
    });
  }
  const help = profileChoiceHelp(choice.scope);
  const helpEl = help
    ? description.createDiv({
        text: help,
        cls: "zt:text-xs zt:leading-normal zt:text-pretty zt:text-(--text-muted)",
        attr: { id: `zt-profile-choice-${crypto.randomUUID()}` },
      })
    : undefined;
  const picker = container.createDiv({
    cls: "zt:flex zt:min-w-0 zt:max-w-full zt:flex-col zt:items-start zt:gap-1",
  });
  if (controls) {
    const button = picker.createEl("button", {
      cls: "zt:max-w-full zt:gap-2",
      attr: { type: "button", "data-profile-choice": "" },
    });
    button.createSpan({
      text: choice.scope
        ? (choice.label ?? m.modal_profile_choose_placeholder())
        : text,
      cls: "zt:truncate",
    });
    setIcon(
      button.createSpan({
        cls: "zt:flex zt:shrink-0",
        attr: { "aria-hidden": "true" },
      }),
      "chevron-down",
    );
    setTooltip(
      button,
      choice.scope && choice.label === undefined
        ? m.batch_profile_choose({ scope: profileChoiceLabel(choice) ?? "" })
        : text,
    );
    if (helpEl) button.setAttribute("aria-describedby", helpEl.id);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void controls.chooseProfile(choice);
    });
  } else {
    picker.createSpan({ text, cls: "zt:text-sm zt:break-words" });
  }
  if (!choice.scope) description.remove();
  const source =
    choice.label === undefined
      ? undefined
      : describeSelectionSource(choice.source);
  if (source)
    picker.createSpan({
      text: source,
      cls: "zt:text-xs zt:text-(--text-muted)",
    });
}

function profileChoiceLabel({ count = 0, scope }: BatchProfileChoice) {
  switch (scope) {
    case "unresolved":
      return m.batch_profile_unresolved_label({ count });
    case "affected":
      return m.batch_profile_affected_label({ count });
    case "all-new":
      return m.batch_profile_override_all_label();
  }
}

/** The control's own words: which rows it governs and where they go. */
function profileChoiceText({ label, count = 0, scope }: BatchProfileChoice) {
  switch (scope) {
    case "unresolved":
      return m.batch_profile_unresolved_destination({
        count,
        label: label ?? "",
      });
    case "affected":
      return label === undefined
        ? m.batch_profile_affected_choose({ count })
        : m.batch_profile_affected_destination({ count, label });
    case "all-new":
      return label === undefined
        ? m.batch_profile_override_all()
        : m.batch_profile_override_all_destination({ label });
    default:
      return m.batch_profile_destination({ label: label ?? "" });
  }
}

/** One line telling a fallback apart from an override. */
function profileChoiceHelp(
  scope: BatchProfileChoice["scope"],
): string | undefined {
  switch (scope) {
    case "unresolved":
      return m.batch_profile_unresolved_help();
    case "affected":
      return m.batch_profile_recovery_help();
    case "all-new":
      return m.batch_profile_override_all_help();
    default:
      return undefined;
  }
}

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
 * Sticky group summary: it pins to the top of the scroll region so the current
 * group stays labeled while its rows scroll, over a modal-surface background
 * that hides them underneath.
 */
export const GROUP_SUMMARY_CLS =
  "zt:sticky zt:top-0 zt:z-10 zt:mb-1 zt:cursor-pointer zt:select-none zt:bg-(--modal-background) zt:py-1";

/** Category label on a {@link GROUP_SUMMARY_CLS} summary (Obsidian UI-smaller
 * scale, not an editor heading). */
export const SECTION_SUMMARY_CLS = `${GROUP_SUMMARY_CLS} zt:text-xs zt:font-semibold zt:uppercase zt:tracking-wide zt:text-(--text-muted)`;

/** Groups larger than this start collapsed, so the modal opens on a compact
 * overview of group headers and the user can collapse past a group of thousands
 * to reach the next one instead of scrolling through it. */
const SECTION_OPEN_MAX = 50;

/** Rows one task mounts when a collapsed group opens. */
const MOUNT_CHUNK = 200;

// `content-visibility: auto` lets the browser skip layout/paint for off-screen
// rows in an expanded group while keeping every mounted <li> (and its updatable
// status icon) live in the DOM; the intrinsic-size estimate keeps the scrollbar
// steady.
const ROW_CLS =
  "zt:flex zt:items-center zt:gap-2 zt:py-0.5 zt:min-w-0 zt:[content-visibility:auto] zt:[contain-intrinsic-size:auto_1.5rem]";
const ROW_LABEL_CLS = "zt:truncate zt:text-sm zt:text-(--text-normal)";

export interface RowGroupContent<T> {
  items: readonly T[];
  renderRow: (ul: HTMLElement, item: T) => void;
  /** @default groups of at most {@link SECTION_OPEN_MAX} start open */
  open?: boolean;
}

/**
 * A collapsible group of `items`: a `<details>` whose `<ul>` holds one row per
 * item. A group mounts its rows when it first opens, {@link MOUNT_CHUNK} per
 * task, so the window keeps painting through a group of thousands; a group
 * that starts open mounts its first chunk at once.
 *
 * @returns the group's `<summary>`, for the caller to fill
 */
export function rowGroup<T>(
  parent: HTMLElement,
  summaryCls: string,
  {
    items,
    renderRow,
    open = items.length <= SECTION_OPEN_MAX,
  }: RowGroupContent<T>,
): HTMLElement {
  const details = parent.createEl("details", {
    cls: "zt:mb-4 zt:last:mb-0",
    attr: open ? { open: "" } : {},
  });
  const summary = details.createEl("summary", { cls: summaryCls });
  const ul = details.createEl("ul", { cls: "zt:m-0 zt:list-none zt:p-0" });
  const mount = async () => {
    for (let start = 0; start < items.length; start += MOUNT_CHUNK) {
      if (start > 0) {
        await yieldToMain();
        // A phase change discards the group; its remaining rows go with it.
        if (!ul.isConnected) return;
      }
      for (const item of items.slice(start, start + MOUNT_CHUNK))
        renderRow(ul, item);
    }
  };
  if (open) {
    void mount();
    return summary;
  }
  const onToggle = () => {
    if (!details.open) return;
    details.removeEventListener("toggle", onToggle);
    void mount();
  };
  details.addEventListener("toggle", onToggle);
  return summary;
}

/**
 * {@link rowGroup} under a sticky category label.
 *
 * @returns the group's `<summary>`
 */
export function section<T>(
  parent: HTMLElement,
  header: string,
  content: RowGroupContent<T>,
): HTMLElement {
  const summary = rowGroup(parent, SECTION_SUMMARY_CLS, content);
  summary.setText(header);
  return summary;
}

/** One checklist row: a leading icon span (returned for status styling) and a
 * truncated label whose full text shows as a hover tooltip. `indent` nests the
 * row under a parent header (the hierarchy tree). */
export function row(
  ul: HTMLElement,
  label: string,
  opts?: { indent?: boolean } & Omit<BatchRow, "label">,
): HTMLElement {
  const li = ul.createEl("li", {
    cls: cn(ROW_CLS, opts?.indent && "zt:pl-6"),
  });
  const icon = li.createSpan({ cls: ICON_CLS });
  const detailed = opts?.profile || opts?.path || opts?.reason;
  const content = detailed ? li.createDiv({ cls: "zt:flex-1 zt:min-w-0" }) : li;
  const title = detailed
    ? content.createDiv({ cls: "zt:flex zt:items-center zt:gap-2 zt:min-w-0" })
    : li;
  title.createSpan({
    text: label,
    cls: ROW_LABEL_CLS,
    attr: { "aria-label": label },
  });
  if (opts?.profile)
    title.createSpan({
      text: opts.profile,
      cls: "zt:shrink-0 zt:rounded-sm zt:bg-(--background-modifier-hover) zt:px-1 zt:text-xs zt:text-(--text-muted)",
      attr: { "data-profile-stamp": "" },
    });
  for (const text of [opts?.path, opts?.reason]) {
    if (text)
      content.createDiv({
        text,
        cls: "zt:text-xs zt:text-(--text-muted) zt:break-all",
      });
  }
  return icon;
}

/** Paint a status icon into a row's leading span. */
function setRowIcon(icon: HTMLElement, status: RowStatus): void {
  icon.className = `${ICON_CLS} ${ROW_ICON_CLASS[status]}`;
  icon.dataset["rowStatus"] = status;
  setIcon(icon, ROW_ICON[status]);
}

/**
 * Each task row's status and, while the row is mounted, its icon. A run
 * records a status for any row; a row shows its status whenever it mounts.
 */
export class RowStatusBoard {
  /** Terminal status per task id; absent ids are pending. */
  readonly #status = new Map<number, RowStatus>();
  /** Status icon of each mounted row, keyed by task id. */
  readonly #icons = new Map<number, HTMLElement>();

  /** Mount one task row, painted with its recorded status. */
  mount(
    ul: HTMLElement,
    task: BatchRow & { id: number; indent?: boolean },
  ): void {
    const icon = row(ul, task.label, task);
    setRowIcon(icon, this.#status.get(task.id) ?? "pending");
    this.#icons.set(task.id, icon);
  }

  /** Record a row's status; a mounted row flips in place. */
  set(id: number, status: RowStatus): void {
    this.#status.set(id, status);
    const icon = this.#icons.get(id);
    if (icon) setRowIcon(icon, status);
  }

  /** Forget the mounted icons once a phase discards their DOM. */
  unmount(): void {
    this.#icons.clear();
  }
}

export interface StaticGroup {
  header: string;
  items: readonly BatchRow[];
  icon: string;
  colorCls: string;
}

/** A static (non-updating) section of icon + label rows, skipped when empty. */
export function listGroup(parent: HTMLElement, group: StaticGroup): void {
  if (group.items.length === 0) return;
  section(parent, group.header, {
    items: group.items,
    renderRow: (ul, item) => {
      const icon = row(ul, item.label, item);
      icon.addClass(group.colorCls);
      setIcon(icon, group.icon);
    },
  });
}

/** Completed rows retain their confirmed Profile in each summary group. */
export function profileListGroup(
  parent: HTMLElement,
  group: StaticGroup & { profileHeader: (args: { count: number }) => string },
): void {
  if (!group.items.some((item) => item.profile)) {
    listGroup(parent, group);
    return;
  }
  for (const [profile, items] of Map.groupBy(
    group.items,
    (item) => item.profile,
  )) {
    listGroup(parent, {
      ...group,
      items,
      header: profile
        ? m.batch_profile_group({
            group: group.profileHeader({ count: items.length }),
            profile,
          })
        : group.header,
    });
  }
}

/** A failed-item row: an x-icon + truncated label, with the error message on a
 * second muted line indented under the label. Shared by the live run-phase
 * panel and the summary's Failed group. */
export function failureRow(
  ul: HTMLElement,
  failure: BatchFailure,
  app: App,
): void {
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
  if (failure.recovery) renderProfileRecovery(li, app, failure.recovery);
}
