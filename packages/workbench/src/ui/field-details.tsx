// One field's details in the Fields Panel: its full value, its template path,
// and what the note gets, with Insert and Copy. A wide view shows them in the
// host's popover beside the panel; a narrow one in a bar of fixed height at
// the panel's foot.
import type { DisplayNode, SnippetKind } from "#/explorer/index";
import { useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";

import { useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import { fieldValueText } from "./explorer-fields";
import type { FieldForm, FieldInsertOptions } from "./field-insertion";
import { useFieldsPanelRows } from "./fields-panel";
import { useOptionalHost, useTooltip } from "./host";
import { useWorkbenchMessages } from "./messages";
import type { ViewSize } from "./panel-layout";
import { useIcon, useParts } from "./theme";

import { formatPath, isList, listItemValues } from "#/explorer/index";

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
  /** The forms the field goes into the note in; the reader picks one where there are several. */
  readonly forms: readonly FieldForm[];
  /** Absent where the editor takes no field now. */
  readonly onInsert?: (form: FieldForm, options: FieldInsertOptions) => void;
  readonly onCopy: (form: FieldForm) => void;
  readonly onClose: () => void;
  /**
   * Whether the details take focus on their first control as they open: the
   * form choice, else Insert, else Copy. Enter opened them, so the keys
   * reach their controls.
   */
  readonly takeFocus?: boolean;
  /**
   * Tab moved focus past the last control of the details, or Shift+Tab
   * before the first: focus goes back to the panel, which a popover on the
   * page's body does not follow in the Tab order.
   */
  readonly onTabOut: () => void;
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
  forms,
  onInsert,
  onCopy,
  onClose,
  takeFocus = false,
  onTabOut,
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
  // A list goes into the note in the form the reader picks, its first by
  // default; any other field has one form.
  const [kind, setKind] = useState<SnippetKind>(forms[0]!.kind);
  const form = forms.find((each) => each.kind === kind) ?? forms[0]!;
  const formsId = useUniqueId();
  const { result } = form;
  const empty = m.workbench_fields_empty();
  // A list shows its values one per line, numbered: every item, an item
  // without a value marked as empty.
  const values = isList(node) ? listItemValues(node) : [];
  const reasonId = useUniqueId();
  const section = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!takeFocus) return;
    section.current
      ?.querySelector<HTMLElement>(
        "input:checked, [data-part=insert]:not(:disabled), [data-part=copy]",
      )
      ?.focus({ preventScroll: true });
  }, [takeFocus]);
  const formLabels: Partial<Record<SnippetKind, string>> = {
    joined: m.workbench_fields_details_form_joined(),
    loop: m.workbench_fields_details_form_loop(),
  };
  return (
    <section
      ref={(element) => {
        section.current = element;
        if (typeof surface === "function") surface(element);
        else if (surface) surface.current = element;
      }}
      aria-labelledby={titleId}
      {...part("details", state)}
      // Mod+Enter inserts the field in the form the details show, as it
      // inserts the selected row from the search.
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:checked",
            ),
          ];
          const edge = event.shiftKey ? controls[0] : controls.at(-1);
          if (event.target !== edge) return;
          event.preventDefault();
          onTabOut();
          return;
        }
        if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
        if (composing(event) || !onInsert) return;
        event.preventDefault();
        onInsert(form, { keepOpen: event.shiftKey });
      }}
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
      {values.length > 1 ? (
        <ol {...part("values")}>
          {values.map((text, index) => (
            <li key={index} {...part("values-item")}>
              <span {...part("values-index")}>{index + 1}</span>
              <span
                {...part(
                  "values-text",
                  text === null || text === "" ? "empty" : undefined,
                )}
              >
                {text === null || text === "" ? empty : text}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p {...part("value", value === "" ? "empty" : undefined)}>
          {value === "" ? empty : value}
        </p>
      )}
      <div {...part("item", "path")}>
        <span {...part("label")}>{m.workbench_fields_details_path()}</span>
        <code {...part("path")}>
          {node.kind === "list-property"
            ? m.workbench_fields_details_path_each({
                list: formatPath(node.list, "zt"),
                property: node.property,
              })
            : formatPath(node.path, "zt")}
        </code>
      </div>
      <div {...part("item", "note")}>
        <div {...part("item-header")}>
          <span id={formsId} {...part("label")}>
            {m.workbench_fields_details_in_note()}
          </span>
          {forms.some(isListForm) && (
            // Named by its visible label, so no tooltip stands on the group.
            <div role="radiogroup" aria-labelledby={formsId} {...part("forms")}>
              {forms.map((each) => (
                <label key={each.kind} {...part("form")}>
                  <input
                    type="radio"
                    name={formsId}
                    checked={form.kind === each.kind}
                    onChange={() => setKind(each.kind)}
                  />
                  {formLabels[each.kind]}
                </label>
              ))}
            </div>
          )}
        </div>
        <code {...part("snippet")}>{form.snippet}</code>
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
          aria-describedby={onInsert ? undefined : reasonId}
          onClick={(event) => onInsert?.(form, { keepOpen: event.shiftKey })}
          {...part("insert")}
        >
          {icon("insert")}
          {m.workbench_fields_insert()}
        </button>
        <button type="button" onClick={() => onCopy(form)} {...part("copy")}>
          {icon("copy")}
          {m.workbench_fields_copy()}
        </button>
      </div>
      {!onInsert && (
        <p id={reasonId} {...part("reason")}>
          {m.workbench_fields_choose_place()}
        </p>
      )}
    </section>
  );
}

/** A form a list goes into the note in, which the reader picks by name. */
function isListForm({ kind }: FieldForm): boolean {
  return kind === "joined" || kind === "loop";
}
