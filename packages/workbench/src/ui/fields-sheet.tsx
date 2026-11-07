// The Fields sheet: the fields of the chosen Item in one modal sheet at the
// view's leading edge, which the Fields action opens at every width. It
// stands over the editor above a scrim and holds focus: Tab stays in it, and
// the panels under it are inert. Escape, the scrim, the close button and a
// second press on the action close it. An insert closes it too and leaves
// focus to the editor, at the inserted text; Shift on Insert keeps it open.
// The host supplies what the sheet holds and draws its parts.
import { useAtomSet } from "@effect/atom-react";
import { useLayoutEffect, useRef } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor";
import { useOptionalHost, useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { FieldsAction } from "./panel-layout";
import { useIcon, useParts } from "./theme";

/** What the Fields sheet holds, and what names it. */
export interface FieldsSheetContent {
  /** The sheet's title, which also names it to a screen reader. */
  readonly label: string;
  /** The fields: the host's field tree and its search. */
  readonly content: ReactNode;
}

/**
 * The Fields action's ARIA state: a disclosure of the sheet `sheetId`
 * names, which it controls while the sheet stands.
 */
export function fieldsActionAttributes(
  action: FieldsAction,
  sheetId: string,
): {
  readonly "aria-haspopup": "dialog";
  readonly "aria-expanded": "true" | "false";
  readonly "aria-controls": string | undefined;
} {
  return {
    "aria-haspopup": "dialog",
    "aria-expanded": action.open ? "true" : "false",
    "aria-controls": action.open ? sheetId : undefined,
  };
}

/** Where focus stood in the sheet: its field row and its control's name. */
interface FocusPlace {
  readonly field: string | null;
  readonly label: string | null;
}

/** The control at `place` in `root`, as the sheet draws it now. */
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

/** The elements Tab stops at, in document order. */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The sheet over the editor while it stands open, and its scrim. */
export function FieldsSheet({ label, content }: FieldsSheetContent) {
  const model = useWorkbenchModel();
  const host = useOptionalHost();
  const m = useWorkbenchMessages();
  const part = useParts("fieldsSheet");
  const icon = useIcon();
  const setOpen = useAtomSet(model.fieldsSheet);
  const sheet = useRef<HTMLElement>(null);
  const fallbackId = useUniqueId();
  const titleId = useUniqueId();
  const closeLabel = m.workbench_fields_close();
  const closeTooltip = useTooltip(closeLabel);
  /** Closes without an insert: focus goes back to the Fields action. */
  const dismiss = () => {
    setOpen(false);
    host?.fieldsAction?.focus();
  };
  // The sheet opens with focus in its search field, or its first stop.
  useLayoutEffect(() => {
    const root = sheet.current;
    const first =
      root?.querySelector<HTMLElement>("[data-part=body] input") ??
      root?.querySelector<HTMLElement>(TABBABLE);
    first?.focus({ preventScroll: true });
  }, []);
  // The sheet holds focus. A Shift insert can draw the row that held it
  // again, and the browser then drops focus to the page: it goes back to the
  // same control in the new row. While that row is not drawn yet, the search
  // field holds focus for it, until the row comes back or the reader moves on.
  const place = useRef<FocusPlace | null>(null);
  const lost = useRef<FocusPlace | null>(null);
  const searchField = () =>
    sheet.current?.querySelector<HTMLElement>("[data-part=body] input") ?? null;
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
    const root = sheet.current;
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
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // A key is the reader's next step: the control focus waited for is past.
    lost.current = null;
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const stops = [
      ...(sheet.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? []),
    ];
    if (stops.length === 0) return;
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    const at = sheet.current?.ownerDocument.activeElement;
    if (event.shiftKey && at === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <>
      <div aria-hidden="true" onClick={dismiss} {...part("scrim")} />
      <aside
        ref={sheet}
        id={host?.fieldsAction?.sheetId ?? fallbackId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        {...part("sheet")}
      >
        <div {...part("header")}>
          <span aria-hidden="true" {...part("icon")}>
            {icon("fields")}
          </span>
          {/* A title, not a heading: the dialog takes its name from it, and
              a host's heading style would outweigh the theme's part. */}
          <span id={titleId} {...part("title")}>
            {label}
          </span>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={dismiss}
            {...closeTooltip}
            {...part("close")}
          >
            {icon("close")}
          </button>
        </div>
        <div {...part("body")}>{content}</div>
      </aside>
    </>
  );
}
