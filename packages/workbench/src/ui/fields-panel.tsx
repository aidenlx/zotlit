// The Fields Panel, the chosen Item's fields in the host's non-modal Fields popover.
import { useAtom, useAtomSet } from "@effect/atom-react";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

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
  useLayoutEffect(() => {
    panel.current
      ?.querySelector<HTMLElement>("[data-part=body] input")
      ?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={panel} {...part("panel")}>
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
