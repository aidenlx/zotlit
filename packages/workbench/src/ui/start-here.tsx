import { useEffect } from "react";

import { useWorkbenchStore } from "./editor";
import { useWorkbenchHost } from "./host";
import { m } from "./paraglide/messages.js";
import { useParts } from "./theme";

const KEY = "start-here-dismissed";

/** One introduction shared by the native and web authoring surfaces. */
export function StartHere() {
  const host = useWorkbenchHost();
  const dismissed = useWorkbenchStore((state) => state.startHereDismissed);
  const dismiss = useWorkbenchStore((state) => state.dismissStartHere);
  const part = useParts("startHere");
  const saved = host.persistence.read("device", KEY) === "true";
  useEffect(() => {
    if (saved) dismiss();
  }, [saved, dismiss]);
  if (dismissed || saved) return null;
  return (
    <aside {...part("strip")} aria-label={m.workbench_start_here()}>
      <div {...part("heading")}>
        <strong>{m.workbench_start_here()}</strong>
        <button
          type="button"
          onClick={() => {
            host.persistence.write("device", KEY, "true");
            dismiss();
          }}
          {...part("dismiss")}
        >
          {m.workbench_start_here_dismiss()}
        </button>
      </div>
      <p {...part("line")}>{m.workbench_start_here_editor()}</p>
      <p {...part("line")}>{m.workbench_start_here_explorer()}</p>
      <p {...part("line")}>{m.workbench_start_here_preview()}</p>
    </aside>
  );
}
