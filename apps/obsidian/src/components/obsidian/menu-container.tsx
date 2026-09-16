// Which document a menu's portal mounts into.
import { createContext } from "react";

/**
 * Base UI reaches for the global `document.body` by default, which is the main
 * window's even when the surface runs in a pop-out — so a host that can be
 * popped out supplies its own `el.doc.body` here.
 *
 * It lives apart from `menu.tsx` so a host can name its window without pulling
 * Base UI into its own module graph.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
export const MenuContainerContext = createContext<HTMLElement | null>(null);

export const MenuContainerProvider = MenuContainerContext.Provider;
