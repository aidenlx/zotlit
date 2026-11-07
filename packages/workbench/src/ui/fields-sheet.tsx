// The Fields sheet: the fields of the chosen Item in one modal sheet at the
// view's leading edge, which the Fields action opens at every width. It
// stands over the editor above a scrim and holds focus: Tab stays in it, and
// the panels under it are inert. Escape, the scrim, the close button and a
// second press on the action close it. An insert closes it too and leaves
// focus to the editor, at the inserted text; Shift on Insert keeps it open.
// The host supplies what the sheet holds and draws its parts.
import { useAtomSet } from "@effect/atom-react";
import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

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
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
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
        {...part("sheet")}
      >
        <div {...part("header")}>
          <span aria-hidden="true" {...part("icon")}>
            {icon("fields")}
          </span>
          <h2 id={titleId} {...part("title")}>
            {label}
          </h2>
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
