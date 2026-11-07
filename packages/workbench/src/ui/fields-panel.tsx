// The Fields Panel, the chosen Item's fields in the host's non-modal Fields popover.
import { useAtom, useAtomSet } from "@effect/atom-react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

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

/**
 * What the field rows share with the Fields Panel they stand in: the step
 * Escape takes inside the panel before the Fields popover closes, which
 * answers `true` when it took the key.
 */
export interface FieldsPanelRows {
  readonly escape: RefObject<() => boolean>;
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
  const titleId = useUniqueId();
  const escape = useRef<() => boolean>(() => false);
  const Popover = host?.fieldsAction?.popover;
  if (!Popover) return null;
  return (
    <Popover
      open={state === "open"}
      onClose={() => setState("closed")}
      labelledBy={titleId}
      returnFocus={state !== "to-editor"}
      onEscape={() => escape.current()}
    >
      <FieldsPanelBody {...props} titleId={titleId} escape={escape} />
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
  escape,
}: FieldsPanelContent & {
  readonly titleId: string;
  readonly escape: RefObject<() => boolean>;
}) {
  const model = useWorkbenchModel();
  const m = useWorkbenchMessages();
  const part = useParts("fieldsPanel");
  const icon = useIcon();
  const setState = useAtomSet(model.fieldsPanel);
  const panel = useRef<HTMLDivElement>(null);
  const [rows] = useState<FieldsPanelRows>(() => ({ escape }));
  const closeLabel = m.workbench_fields_close();
  const closeTooltip = useTooltip(closeLabel);
  useLayoutEffect(() => {
    panel.current
      ?.querySelector<HTMLElement>("[data-part=body] input")
      ?.focus({ preventScroll: true });
  }, []);
  return (
    // Escape closes a field's details, then clears the search, before the
    // host closes the panel. A host that takes the key first asks the same
    // step through `onEscape`, and a key it took arrives here handled.
    <div
      ref={panel}
      {...part("panel")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Escape that drops an input method's candidate is the method's.
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          return;
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
      <FieldsPanelRowsContext.Provider value={rows}>
        <div {...part("body")}>{content}</div>
      </FieldsPanelRowsContext.Provider>
    </div>
  );
}
