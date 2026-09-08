// The Refresh setting drives scheduling; the host starts an on-demand render.

import { useOptionalEditor, useWorkbenchStore } from "./editor";
import { useWorkbenchMessages } from "./messages";
import { WorkbenchSelect, WorkbenchOption } from "./select";
import { useParts } from "./theme";

export function PreviewControls({
  busy,
  disabled = false,
  onRun,
}: {
  busy: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  const m = useWorkbenchMessages();
  const editor = useOptionalEditor();
  const preview = useWorkbenchStore((state) => state.preview);
  const part = useParts("previewControls");
  return (
    <div {...part("controls")}>
      <label {...part("label")}>
        <span {...part("label-text")}>{m.workbench_preview_mode()}</span>
        <WorkbenchSelect
          value={preview.mode}
          disabled={!editor}
          onInput={(event) =>
            editor?.store.getState().setPreview({
              mode:
                event.currentTarget.value === "update" ? "update" : "create",
            })
          }
        >
          <WorkbenchOption value="create">
            {m.workbench_preview_create()}
          </WorkbenchOption>
          <WorkbenchOption value="update">
            {m.workbench_preview_update()}
          </WorkbenchOption>
        </WorkbenchSelect>
      </label>
      <label {...part("label")}>
        <span {...part("label-text")}>{m.workbench_preview_refresh()}</span>
        <WorkbenchSelect
          value={preview.live ? "live" : "demand"}
          disabled={!editor}
          onInput={(event) => {
            const live = event.currentTarget.value === "live";
            editor?.store.getState().setPreview({ live });
          }}
        >
          <WorkbenchOption value="live">
            {m.workbench_preview_live()}
          </WorkbenchOption>
          <WorkbenchOption value="demand">
            {m.workbench_preview_on_demand()}
          </WorkbenchOption>
        </WorkbenchSelect>
      </label>
      {!preview.live && (
        <span role="status" {...part("paused")}>
          {m.workbench_preview_paused()}
        </span>
      )}
      {!preview.live && (
        <button
          {...part("run")}
          type="button"
          disabled={!editor || busy || disabled}
          onClick={onRun}
        >
          {m.workbench_preview_run()}
        </button>
      )}
    </div>
  );
}
