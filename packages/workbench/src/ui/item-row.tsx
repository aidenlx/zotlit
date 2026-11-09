// The one row that names the item the whole Workbench view renders against,
// with the control that changes it. The Fields Panel, the editor and the
// Preview Panel read the same item, so the view names it once: the host draws
// this row above the panels, across all of them, at every placement. The
// panels' own heads hold only what is theirs.
import type { ReactNode } from "react";

import { useParts } from "./theme";

export function ItemRow({
  label,
  children,
}: {
  /** The item's name, such as "Example: Thinking, fast and slow"; none before one is chosen. */
  label?: ReactNode;
  /** The host's control that chooses another item. */
  children: ReactNode;
}) {
  const part = useParts("itemRow");
  return (
    <div data-workbench-item-row="" {...part("row")}>
      {label ? <p {...part("label")}>{label}</p> : null}
      {children}
    </div>
  );
}
