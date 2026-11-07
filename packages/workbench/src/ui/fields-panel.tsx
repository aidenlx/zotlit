// The Fields Panel: the fields of the chosen Item, which the Fields action
// opens at every width. While it is not pinned it opens in the host's Fields
// popover, at the right edge of the view. The popover is not modal: the
// editor and the Preview stay in reach, and the host closes it on Escape and
// on a press outside, with focus back to the Fields action. The close button
// and a second press on the action close it too. An insert closes it and
// leaves focus to the editor, at the inserted text; Shift on Insert keeps it
// open. The host supplies what the panel holds and draws its parts.
import { useAtom, useAtomSet } from "@effect/atom-react";
import { useLayoutEffect, useRef } from "react";
import type { FocusEvent, ReactNode } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor";
import { useOptionalHost, useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { FieldsAction } from "./panel-layout";
import { useIcon, useParts } from "./theme";

/** What the Fields Panel holds, and what names it. */
export interface FieldsPanelContent {
  /** The panel's title, which also names it to a screen reader. */
  readonly label: string;
  /** The fields: the host's field tree and its search. */
  readonly content: ReactNode;
}

/**
 * The Fields action's ARIA state: a disclosure of the Fields popover
 * `popoverId` names, which it controls while the popover stands.
 */
export function fieldsActionAttributes(
  action: FieldsAction,
  popoverId: string,
): {
  readonly "aria-haspopup": "dialog";
  readonly "aria-expanded": "true" | "false";
  readonly "aria-controls": string | undefined;
} {
  return {
    "aria-haspopup": "dialog",
    "aria-expanded": action.open ? "true" : "false",
    "aria-controls": action.open ? popoverId : undefined,
  };
}

/** Where focus stood in the panel: its field row and its control's name. */
interface FocusPlace {
  readonly field: string | null;
  readonly label: string | null;
}

/** The control at `place` in `root`, as the panel draws it now. */
function controlAt(root: HTMLElement, place: FocusPlace): HTMLElement | null {
  const escape = (value: string) => value.replaceAll(/["\\]/g, "\\$&");
  const row =
    place.field === null
      ? root
      : root.querySelector<HTMLElement>(
          `[data-workbench-field="${escape(place.field)}"]`,
        );
  if (!row || place.label === null) return null;
  return row.querySelector<HTMLElement>(
    `[aria-label="${escape(place.label)}"]`,
  );
}

/** The Fields Panel in the host's Fields popover. */
export function FieldsPanel(props: FieldsPanelContent) {
  const model = useWorkbenchModel();
  const host = useOptionalHost();
  const [state, setState] = useAtom(model.fieldsPanel);
  const titleId = useUniqueId();
  const Popover = host?.fieldsAction?.popover;
  if (!Popover) return null;
  return (
    <Popover
      open={state === "open"}
      onClose={() => setState("closed")}
      labelledBy={titleId}
      returnFocus={state !== "to-editor"}
    >
      <FieldsPanelBody {...props} titleId={titleId} />
    </Popover>
  );
}

/**
 * The panel's header and fields. The popover mounts it as it opens, and it
 * moves focus into its search field as it mounts.
 */
function FieldsPanelBody({
  label,
  content,
  titleId,
}: FieldsPanelContent & { readonly titleId: string }) {
  const model = useWorkbenchModel();
  const m = useWorkbenchMessages();
  const part = useParts("fieldsPanel");
  const icon = useIcon();
  const setState = useAtomSet(model.fieldsPanel);
  const panel = useRef<HTMLDivElement>(null);
  const closeLabel = m.workbench_fields_close();
  const closeTooltip = useTooltip(closeLabel);
  const searchField = () =>
    panel.current?.querySelector<HTMLElement>("[data-part=body] input") ?? null;
  useLayoutEffect(() => {
    searchField()?.focus({ preventScroll: true });
  }, []);
  // A Shift insert can draw the row that held focus again, and the browser
  // then drops focus to the page: it goes back to the same control in the
  // new row. While that row is not drawn yet, the search field holds focus
  // for it, until the row comes back or the reader moves on.
  const place = useRef<FocusPlace | null>(null);
  const lost = useRef<FocusPlace | null>(null);
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const { target } = event;
    if (lost.current && target === searchField()) return;
    lost.current = null;
    place.current = {
      field:
        target.closest<HTMLElement>("[data-workbench-field]")?.dataset
          .workbenchField ?? null,
      label: target.getAttribute("aria-label"),
    };
  };
  useLayoutEffect(() => {
    const root = panel.current;
    const view = root?.ownerDocument.defaultView;
    if (!root || !view) return;
    const observer = new view.MutationObserver(() => {
      const doc = root.ownerDocument;
      const at = doc.activeElement;
      const dropped = !at || at === doc.body;
      if (lost.current) {
        const back = controlAt(root, lost.current);
        if (!back) return;
        const holding = lost.current;
        lost.current = null;
        if (dropped || at === searchField()) {
          place.current = holding;
          back.focus({ preventScroll: true });
        }
        return;
      }
      if (!dropped) return;
      const back = place.current && controlAt(root, place.current);
      if (back) {
        back.focus({ preventScroll: true });
        return;
      }
      lost.current = place.current;
      searchField()?.focus({ preventScroll: true });
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={panel}
      // A key is the reader's next step: the control focus waited for is past.
      onKeyDown={() => {
        lost.current = null;
      }}
      onFocus={onFocus}
      {...part("panel")}
    >
      <div {...part("header")}>
        <span aria-hidden="true" {...part("icon")}>
          {icon("fields")}
        </span>
        {/* A title, not a heading: the popover takes its name from it, and
            a host's heading style would outweigh the theme's part. */}
        <span id={titleId} {...part("title")}>
          {label}
        </span>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => setState("closed")}
          {...closeTooltip}
          {...part("close")}
        >
          {icon("close")}
        </button>
      </div>
      <div {...part("body")}>{content}</div>
    </div>
  );
}
