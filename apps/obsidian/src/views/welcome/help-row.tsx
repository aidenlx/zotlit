// The "Welcome & help" row at the foot of the Library Tree: the way back to a
// dismissed Welcome View banner, as "Open welcome view" is.
//
// @see apps/obsidian/docs/adr/0077-the-library-view-is-the-first-screen.md
import { createRoot } from "react-dom/client";

import { Icon } from "@/components/obsidian/icon";
import * as m from "@/lib/i18n/generated/messages";

/**
 * Draw the row into `el`, in the tree's row style; a press runs `request`.
 *
 * @returns what takes the row away.
 */
export function renderWelcomeHelpRow(
  el: HTMLElement,
  request: () => void,
): () => void {
  const root = createRoot(el);
  root.render(
    // A row of the tree, not an Obsidian button, whose unlayered style would
    // fill it; its label is on screen, so it carries no tooltip. Its icon
    // stands where a top-level node's does, past the slot of the chevron.
    <div
      role="button"
      tabIndex={0}
      data-welcome-help-row=""
      onClick={request}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        request();
      }}
      className="zt:flex zt:min-w-0 zt:cursor-(--cursor) zt:items-center zt:gap-(--size-2-1) zt:rounded-(--radius-s) zt:py-(--size-2-2) zt:ps-[calc(var(--size-4-4)+var(--size-2-1)*2)] zt:pe-(--size-4-2) zt:text-(length:--nav-item-size) zt:text-(--nav-item-color) zt:outline-hidden zt:hover:bg-(--nav-item-background-hover) zt:hover:text-(--nav-item-color-hover) zt:focus-visible:shadow-[inset_0_0_0_var(--input-border-width-focus)_var(--background-modifier-border-focus)]"
    >
      {/* The quiet xs icon in the box of a node's icon, so its label lines
          up with the nodes' labels. */}
      <span className="zt:me-(--size-2-2) zt:flex zt:w-(--icon-s) zt:shrink-0 zt:justify-center zt:text-(--icon-color)">
        <Icon name="circle-help" size="xs" />
      </span>
      <span className="zt:min-w-0 zt:truncate">
        {m.library_view_help_action()}
      </span>
    </div>,
  );
  return () => root.unmount();
}
