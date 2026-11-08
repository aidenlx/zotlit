// The Fields Panel, the chosen Item's fields in the host's non-modal Fields
// popover, or docked beside the editor while the reader has it pinned.
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchEditor, useWorkbenchModel } from "./editor";
import { useOptionalHost, useTooltip } from "./host";
import { composing } from "./ime";
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

/**
 * What the field rows share with the Fields Panel they stand in: the step
 * Escape takes inside the panel before the Fields popover closes, which
 * answers `true` when it took the key.
 */
export interface FieldsPanelRows {
  readonly escape: RefObject<() => boolean>;
  /** The panel, which a field's details popover stands beside. */
  readonly panel: RefObject<HTMLElement | null>;
  /**
   * The place in the panel's header for the rows' own actions, such as
   * collapsing every section, once the header is drawn.
   */
  readonly actions: HTMLElement | null;
}

const FieldsPanelRowsContext = createContext<FieldsPanelRows | null>(null);

/**
 * The Fields Panel the field rows stand in, or `null` outside one, as in the
 * standalone Template Data Explorer, whose rows keep no details.
 */
export function useFieldsPanelRows(): FieldsPanelRows | null {
  return useContext(FieldsPanelRowsContext);
}

/** The Fields Panel in the host's Fields popover. */
export function FieldsPanel(props: FieldsPanelContent) {
  const model = useWorkbenchModel();
  const host = useOptionalHost();
  const [state, setState] = useAtom(model.fieldsPanel);
  const { fields } = useAtomValue(model.placement);
  const titleId = useUniqueId();
  const escape = useRef<() => boolean>(() => false);
  const Popover = host?.fieldsAction?.popover;
  if (!Popover) return null;
  return (
    <Popover
      open={fields === "popover"}
      onClose={() => setState("closed")}
      labelledBy={titleId}
      returnFocus={state !== "to-editor"}
      onEscape={() => escape.current()}
    >
      <FieldsPanelBody
        {...props}
        titleId={titleId}
        placement="popover"
        escape={escape}
      />
    </Popover>
  );
}

/**
 * The Fields Panel docked beside the editor, whose title `titleId` names its
 * region. It takes focus in its search as it draws only after the reader
 * pinned or showed it.
 */
export function DockedFieldsPanel(
  props: FieldsPanelContent & { readonly titleId: string },
) {
  const escape = useRef<() => boolean>(() => false);
  return <FieldsPanelBody {...props} placement="docked" escape={escape} />;
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
  escape,
}: FieldsPanelContent & {
  readonly titleId: string;
  readonly placement: "popover" | "docked";
  readonly escape: RefObject<() => boolean>;
}) {
  const { model, registry } = useWorkbenchEditor();
  const m = useWorkbenchMessages();
  const part = useParts("fieldsPanel");
  const icon = useIcon();
  const setState = useAtomSet(model.fieldsPanel);
  const { pinned, canPin } = useAtomValue(model.fieldsPin);
  const panel = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const rows = useMemo<FieldsPanelRows>(
    () => ({ escape, panel, actions }),
    [escape, actions],
  );
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
    // A panel with no search yet, as before an item is chosen, takes focus
    // on its pin, so the focus the popover held does not fall to the page.
    (
      panel.current?.querySelector<HTMLElement>("[data-part=body] input") ??
      panel.current?.querySelector<HTMLElement>("[data-part=pin]")
    )?.focus({ preventScroll: true });
  }, [placement, registry, model]);
  return (
    // Escape closes a field's details, then clears the search, before the
    // host closes the panel. A host that takes the key first asks the same
    // step through `onEscape`, and a key it took arrives here handled.
    <div
      ref={panel}
      {...part("panel", placement)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Escape that drops an input method's candidate is the method's.
        if (composing(event)) return;
        if (!escape.current()) return;
        event.preventDefault();
        event.stopPropagation();
      }}
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
        <span ref={setActions} {...part("actions")} />
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
      <FieldsPanelRowsContext.Provider value={rows}>
        <div {...part("body")}>{content}</div>
      </FieldsPanelRowsContext.Provider>
    </div>
  );
}
