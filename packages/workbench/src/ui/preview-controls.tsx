// The Refresh setting drives scheduling; the host starts an on-demand render.

import { useWorkbenchMessages } from "./messages";
import { WorkbenchSelect, WorkbenchOption } from "./select";
import type { PreviewSettings } from "./store";
import { useParts } from "./theme";

export function PreviewControls({
  preview,
  onChange,
  busy,
  disabled = false,
  onRun,
}: {
  preview: PreviewSettings;
  onChange: (value: Partial<PreviewSettings>) => void;
  busy: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  const m = useWorkbenchMessages();
  const part = useParts("previewControls");
  return (
    <div {...part("controls")}>
      <label {...part("label")}>
        <span {...part("label-text")}>{m.workbench_preview_mode()}</span>
        <WorkbenchSelect
          value={preview.mode}
          onInput={(event) =>
            onChange({
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
          onInput={(event) => {
            const live = event.currentTarget.value === "live";
            onChange({ live });
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
          disabled={busy || disabled}
          onClick={onRun}
        >
          {m.workbench_preview_run()}
        </button>
      )}
    </div>
  );
}
