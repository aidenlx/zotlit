// The row above the editor: Basic against Advanced, and undo and redo over the
// document's one history. A host's own controls for the row come as children.
// Inert outside an editor.

import type { ReactNode } from "react";

import {
  useDocumentRevision,
  useOptionalEditor,
  useWorkbenchStore,
} from "./editor";
import { useTooltip } from "./host";
import { m } from "./paraglide/messages.js";
import { useIcon, useParts } from "./theme";

export function EditToolbar({
  children,
  leading,
  layout = "grouped",
  onModeChange,
}: {
  children?: ReactNode;
  /** The host's Item chooser, before the shared controls. */
  leading?: ReactNode;
  /** Linear headers put history before a single Advanced toggle. */
  layout?: "grouped" | "linear";
  onModeChange?: (advanced: boolean) => void;
}) {
  const editor = useOptionalEditor();
  const controller = editor?.controller ?? null;
  useDocumentRevision(controller);
  const advanced = useWorkbenchStore((state) => state.advanced);
  const setAdvanced = useWorkbenchStore((state) => state.setAdvanced);
  const part = useParts("editToolbar");
  const icon = useIcon();
  const undoTooltip = useTooltip(m.workbench_undo());
  const redoTooltip = useTooltip(m.workbench_redo());
  const inert = controller === null;

  const mode = (
    source: boolean,
    label: string,
    glyph: "basic" | "advanced",
  ) => (
    <button
      type="button"
      aria-pressed={advanced === source}
      disabled={inert}
      onClick={() => {
        const next = layout === "linear" ? !advanced : source;
        setAdvanced(next);
        onModeChange?.(next);
      }}
      {...part("mode", advanced === source ? "on" : "off")}
    >
      {icon(glyph)}
      {label}
    </button>
  );

  const history = (
    <>
      <button
        type="button"
        aria-label={m.workbench_undo()}
        disabled={!controller?.canUndo}
        onClick={() => controller?.undo()}
        {...undoTooltip}
        {...part("undo")}
      >
        {icon("undo")}
      </button>
      <button
        type="button"
        aria-label={m.workbench_redo()}
        disabled={!controller?.canRedo}
        onClick={() => controller?.redo()}
        {...redoTooltip}
        {...part("redo")}
      >
        {icon("redo")}
      </button>
    </>
  );
  return (
    <div {...part("edit-toolbar")}>
      {leading}
      {layout === "linear" ? (
        <>
          {history}
          {mode(true, m.workbench_advanced(), "advanced")}
          {children}
        </>
      ) : (
        <>
          <div
            role="group"
            aria-label={m.workbench_editing_mode()}
            {...part("mode-group")}
          >
            {mode(false, m.workbench_basic(), "basic")}
            {mode(true, m.workbench_advanced(), "advanced")}
          </div>
          <div {...part("toolbar-actions")}>
            {history}
            {children}
          </div>
        </>
      )}
    </div>
  );
}
