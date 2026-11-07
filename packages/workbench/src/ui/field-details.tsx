// One field's details in the Fields Panel: its full value, its template path,
// and what the note gets, with Insert and Copy. A wide view shows them in the
// host's popover beside the panel; a narrow one in a bar of fixed height at
// the panel's foot.
import type { DisplayNode } from "#/explorer/index";
import type { Ref } from "react";

import { useUniqueId } from "@zotlit/ui";

import { fieldResult, fieldValueText } from "./explorer-fields";
import { useFieldsPanelRows } from "./fields-panel";
import { useOptionalHost, useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { ViewSize } from "./panel-layout";
import { useIcon, useParts } from "./theme";

import { formatPath } from "#/explorer/index";

/**
 * The narrowest view, in pixels, that shows a field's details in a popover
 * beside the Fields Panel; a narrower view shows them in a bar at the
 * panel's foot.
 */
export const DETAILS_BESIDE_MIN = 600;

/** Where a field's details stand. */
export type FieldDetailsPlacement = "popover" | "bar";

/**
 * Where a field's details stand in a view of `size`: beside the panel in a
 * view {@link DETAILS_BESIDE_MIN} wide or wider, or one not measured yet.
 */
export const placeFieldDetails = (
  size: ViewSize | null,
): FieldDetailsPlacement =>
  size === null || size.width >= DETAILS_BESIDE_MIN ? "popover" : "bar";

/** What the details show and do for one field. */
export interface FieldDetailsContent {
  readonly node: DisplayNode;
  /** The field's name as its row shows it. */
  readonly label: string;
  /** Where the field sits: its section, and the field it belongs to. */
  readonly context: string;
  /** The text an insert puts into the note. */
  readonly snippet: string;
  /** Absent where the editor takes no field now. */
  readonly onInsert?: (keepOpen: boolean) => void;
  readonly onCopy: () => void;
  readonly onClose: () => void;
}

/**
 * The details where the view shows them: in the host's popover level with
 * `row`, or in the bar. A host without a details popover shows the bar.
 */
export function FieldDetails({
  placement,
  row,
  surface,
  ...content
}: FieldDetailsContent & {
  readonly placement: FieldDetailsPlacement;
  readonly row: HTMLElement | null;
  /** The element the details draw in, which a press outside leaves. */
  readonly surface: Ref<HTMLElement>;
}) {
  const host = useOptionalHost();
  const part = useParts("fieldDetails");
  const titleId = useUniqueId();
  const panel = useFieldsPanelRows()?.panel.current ?? null;
  const Popover = host?.fieldsAction?.details;
  if (placement === "popover" && Popover && row && panel)
    return (
      <Popover
        anchor={row}
        panel={panel}
        onClose={content.onClose}
        labelledBy={titleId}
      >
        <DetailsBody
          {...content}
          titleId={titleId}
          surface={surface}
          state="popover"
        />
      </Popover>
    );
  return (
    <div {...part("details-bar")}>
      <DetailsBody
        {...content}
        titleId={titleId}
        surface={surface}
        state="bar"
      />
    </div>
  );
}

function DetailsBody({
  node,
  label,
  context,
  snippet,
  onInsert,
  onCopy,
  onClose,
  titleId,
  surface,
  state,
}: FieldDetailsContent & {
  readonly titleId: string;
  readonly surface: Ref<HTMLElement>;
  readonly state: FieldDetailsPlacement;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("fieldDetails");
  const icon = useIcon();
  const closeLabel = m.workbench_fields_details_close();
  const closeTooltip = useTooltip(closeLabel);
  const value =
    node.kind === "value" && typeof node.value === "string"
      ? node.value
      : fieldValueText(node);
  const result = fieldResult(node);
  const empty = m.workbench_fields_empty();
  return (
    <section
      ref={surface}
      aria-labelledby={titleId}
      {...part("details", state)}
    >
      <div {...part("header")}>
        <span {...part("heading")}>
          <span {...part("context")}>{context}</span>
          <span id={titleId} {...part("title")}>
            {label}
          </span>
        </span>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          {...closeTooltip}
          {...part("close")}
        >
          {icon("close")}
        </button>
      </div>
      <p {...part("value", value === "" ? "empty" : undefined)}>
        {value === "" ? empty : value}
      </p>
      <div {...part("item")}>
        <span {...part("label")}>{m.workbench_fields_details_path()}</span>
        <code {...part("path")}>{formatPath(node.path, "zt")}</code>
      </div>
      <div {...part("item")}>
        <span {...part("label")}>{m.workbench_fields_details_in_note()}</span>
        <code {...part("snippet")}>{snippet}</code>
        <p {...part("result", result === null ? "empty" : undefined)}>
          <span aria-hidden="true" {...part("result-icon")}>
            {icon("result")}
          </span>
          <span>{result ?? empty}</span>
        </p>
      </div>
      <div {...part("actions")}>
        <button
          type="button"
          disabled={!onInsert}
          onClick={(event) => onInsert?.(event.shiftKey)}
          {...part("insert")}
        >
          {icon("insert")}
          {m.workbench_fields_insert()}
        </button>
        <button type="button" onClick={onCopy} {...part("copy")}>
          {icon("copy")}
          {m.workbench_fields_copy()}
        </button>
      </div>
    </section>
  );
}
