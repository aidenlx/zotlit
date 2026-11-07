// The Fields Panel, the chosen Item's fields in the host's non-modal Fields
// popover, or docked beside the editor while the reader has it pinned.
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchEditor, useWorkbenchModel } from "./editor";
import { useOptionalHost, useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import { pressFieldsPin } from "./model";
import type { FieldsAction } from "./panel-layout";
import { useIcon, useParts } from "./theme";

/** What the Fields Panel holds, and what names it. */
export interface FieldsPanelContent {
  /** The panel's title, which also names it to a screen reader. */
  readonly label: string;
  /** The fields: the host's field tree and its search. */
  readonly content: ReactNode;
}

/** The id of the docked Fields Panel, beside the Fields popover's `popoverId`. */
export const fieldsDockId = (popoverId: string) => `${popoverId}-docked`;

/**
 * The Fields action's ARIA state: a disclosure of the Fields popover
 * `popoverId` names, or of the docked panel, which it controls while either
 * stands.
 */
export function fieldsActionAttributes(
  action: FieldsAction,
  popoverId: string,
): {
  readonly "aria-haspopup": "dialog" | undefined;
  readonly "aria-expanded": "true" | "false";
  readonly "aria-controls": string | undefined;
} {
  const docked = action.placement === "docked";
  return {
    "aria-haspopup": docked ? undefined : "dialog",
    "aria-expanded": action.open ? "true" : "false",
    "aria-controls": docked
      ? fieldsDockId(popoverId)
      : action.open
        ? popoverId
        : undefined,
  };
}

/** The Fields Panel in the host's Fields popover. */
export function FieldsPanel(props: FieldsPanelContent) {
  const model = useWorkbenchModel();
  const host = useOptionalHost();
  const [state, setState] = useAtom(model.fieldsPanel);
  const { fields } = useAtomValue(model.placement);
  const titleId = useUniqueId();
  const Popover = host?.fieldsAction?.popover;
  if (!Popover) return null;
  return (
    <Popover
      open={fields === "popover"}
      onClose={() => setState("closed")}
      labelledBy={titleId}
      returnFocus={state !== "to-editor"}
    >
      <FieldsPanelBody {...props} titleId={titleId} placement="popover" />
    </Popover>
  );
}

/**
 * The Fields Panel docked beside the editor. It takes focus in its search as
 * it draws only after the reader pinned or showed it.
 */
export function DockedFieldsPanel(props: FieldsPanelContent) {
  const titleId = useUniqueId();
  return <FieldsPanelBody {...props} titleId={titleId} placement="docked" />;
}

/**
 * The panel's header and fields. The popover mounts it as it opens, and it
 * moves focus into its search field as it mounts; the docked panel does so
 * only where the reader asked for it.
 */
function FieldsPanelBody({
  label,
  content,
  titleId,
  placement,
}: FieldsPanelContent & {
  readonly titleId: string;
  readonly placement: "popover" | "docked";
}) {
  const { model, registry } = useWorkbenchEditor();
  const m = useWorkbenchMessages();
  const part = useParts("fieldsPanel");
  const icon = useIcon();
  const setState = useAtomSet(model.fieldsPanel);
  const { pinned, canPin } = useAtomValue(model.fieldsPin);
  const panel = useRef<HTMLDivElement>(null);
  const closeLabel = m.workbench_fields_close();
  const closeTooltip = useTooltip(closeLabel);
  const pinLabel = !canPin
    ? m.workbench_fields_pin_unavailable()
    : pinned
      ? m.workbench_fields_unpin()
      : m.workbench_fields_pin();
  const pinTooltip = useTooltip(pinLabel);
  useLayoutEffect(() => {
    if (placement === "docked") {
      if (!registry.get(model.fieldsFocus)) return;
      registry.set(model.fieldsFocus, false);
    }
    panel.current
      ?.querySelector<HTMLElement>("[data-part=body] input")
      ?.focus({ preventScroll: true });
  }, [placement, registry, model]);
  return (
    <div ref={panel} {...part("panel", placement)}>
      <div {...part("header")}>
        <span aria-hidden="true" {...part("icon")}>
          {icon("fields")}
        </span>
        {/* A title, not a heading: the popover takes its name from it, and
            a host's heading style would outweigh the theme's part. */}
        <span id={titleId} {...part("title")}>
          {label}
        </span>
        {/* Disabled by aria-disabled, so the pin keeps its focus and its
            tooltip says why it does not work. */}
        <button
          type="button"
          aria-label={pinLabel}
          aria-pressed={pinned && canPin}
          aria-disabled={canPin ? undefined : true}
          onClick={() => pressFieldsPin(registry, model)}
          {...pinTooltip}
          {...part("pin", pinned && canPin ? "pinned" : undefined)}
        >
          {icon(pinned && canPin ? "unpin" : "pin")}
        </button>
        {placement === "popover" && (
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => setState("closed")}
            {...closeTooltip}
            {...part("close")}
          >
            {icon("close")}
          </button>
        )}
      </div>
      {pinned && !canPin && (
        <p {...part("note")}>{m.workbench_fields_pinned_narrow()}</p>
      )}
      <div {...part("body")}>{content}</div>
    </div>
  );
}
