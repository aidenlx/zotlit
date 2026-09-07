// Preview scheduling controls use the editor store; the host starts or pauses work.

import { useOptionalEditor, useWorkbenchStore } from "./editor";
import { m } from "./paraglide/messages.js";
import { useParts } from "./theme";

export function PreviewControls({
  busy,
  onRun,
  onStop,
}: {
  busy: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const editor = useOptionalEditor();
  const preview = useWorkbenchStore((state) => state.preview);
  const part = useParts("previewControls");
  return (
    <div {...part("controls")}>
      <label {...part("label")}>
        <span {...part("label-text")}>{m.workbench_preview_mode()}</span>
        <select
          {...part("select")}
          value={preview.mode}
          disabled={!editor}
          onInput={(event) =>
            editor?.store.getState().setPreview({
              mode:
                event.currentTarget.value === "update" ? "update" : "create",
            })
          }
        >
          <option value="create">{m.workbench_preview_create()}</option>
          <option value="update">{m.workbench_preview_update()}</option>
        </select>
      </label>
      <label {...part("label")}>
        <span {...part("label-text")}>{m.workbench_preview_refresh()}</span>
        <select
          {...part("select")}
          value={preview.live ? "live" : "demand"}
          disabled={!editor}
          onInput={(event) => {
            const live = event.currentTarget.value === "live";
            editor?.store.getState().setPreview({ live });
            if (!live) onStop();
          }}
        >
          <option value="live">{m.workbench_preview_live()}</option>
          <option value="demand">{m.workbench_preview_on_demand()}</option>
        </select>
      </label>
      <button
        {...part("run")}
        type="button"
        disabled={!editor || busy}
        onClick={onRun}
      >
        {m.workbench_preview_run()}
      </button>
      <button
        {...part("stop")}
        type="button"
        disabled={!editor || (!busy && !preview.live)}
        onClick={() => {
          editor?.store.getState().setPreview({ live: false });
          onStop();
        }}
      >
        {m.workbench_preview_stop()}
      </button>
    </div>
  );
}
