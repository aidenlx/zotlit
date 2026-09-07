// The theme a host supplies once: the class each part of the tree wears and
// the icons it draws. The tree marks its parts with `data-part` and their
// state with `data-state`, and carries no class of its own (ADR 0044).

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Every component of the tree and the parts it marks. A component that joins
 * the tree adds its entry here, so a host's class map is checked against it.
 */
export interface WorkbenchParts {
  tabBar: "tab-bar" | "tab";
  tabPanel: "tab-panel";
  editToolbar:
    | "edit-toolbar"
    | "mode-group"
    | "mode"
    | "toolbar-actions"
    | "undo"
    | "redo";
  problemsFooter:
    | "problems"
    | "problems-heading"
    | "problems-text"
    | "problems-recovery"
    | "problems-open";
}

export type WorkbenchComponent = keyof WorkbenchParts;

/** The class a host attaches to each part, by component. */
export type WorkbenchClassMap = {
  readonly [C in WorkbenchComponent]?: {
    readonly [P in WorkbenchParts[C]]?: string;
  };
};

/** The icons the tree asks for, named by role so each host picks the glyph. */
export type WorkbenchIcon = "basic" | "advanced" | "undo" | "redo";

export interface WorkbenchTheme {
  readonly classes?: WorkbenchClassMap;
  /** Draws a named icon; a host without one draws none. */
  readonly icon?: (name: WorkbenchIcon) => ReactNode;
}

const ThemeContext = createContext<WorkbenchTheme>({});

export function WorkbenchThemeProvider({
  theme,
  children,
}: {
  theme: WorkbenchTheme;
  children?: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

/** The attributes a part carries: its name, its state, and the host's class. */
export interface PartAttributes {
  "data-part": string;
  "data-state"?: string;
  className?: string;
}

/**
 * The part attributes of one component, read from the theme in context.
 *
 * @example
 *   const part = useParts("tabBar");
 *   <button {...part("tab", active ? "active" : "inactive")} />
 */
export function useParts<C extends WorkbenchComponent>(
  component: C,
): (part: WorkbenchParts[C], state?: string) => PartAttributes {
  const { classes } = useContext(ThemeContext);
  return (part, state) => {
    const className = classes?.[component]?.[part];
    return {
      "data-part": part,
      ...(state === undefined ? {} : { "data-state": state }),
      ...(className === undefined ? {} : { className }),
    };
  };
}

/** Draws a themed icon, or nothing where the host draws none. */
export function useIcon(): (name: WorkbenchIcon) => ReactNode {
  const { icon } = useContext(ThemeContext);
  return (name) => icon?.(name) ?? null;
}
