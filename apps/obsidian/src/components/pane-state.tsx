// The frame an empty or error state stands in, in place of a list: it takes
// the space its column leaves under the toolbar and centres what it holds, as
// Obsidian's `pane-empty` reads. Where the column has no height of its own,
// as a Query View in a note, it is as tall as what it holds.

import type { ReactNode } from "react";

/**
 * Hold `children` centred in the space the column leaves. The frame is
 * layout alone, with no name: the state inside it says what it is. Content
 * taller than the space scrolls, from its top.
 */
export function PaneState({ children }: { children: ReactNode }) {
  return (
    <div
      data-pane-state=""
      className="zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:items-center-safe zt:justify-center-safe zt:overflow-y-auto"
    >
      {children}
    </div>
  );
}
