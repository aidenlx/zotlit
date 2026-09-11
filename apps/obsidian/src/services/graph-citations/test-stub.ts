/**
 * Test doubles for the node-colour suites. A theme states a node colour by
 * setting the custom property on something the reading inherits from, which is
 * what these state and clear.
 */
import type { GraphColor, GraphData } from "obsidian";

import { themeProperty } from "@/lib/theme-hooks";

export function themeStates(
  literatureNote: string,
  citedWorkNode: string,
  citationLink?: string,
): void {
  document.body.style.setProperty(
    themeProperty.graphLiteratureNote,
    literatureNote,
  );
  document.body.style.setProperty(
    themeProperty.graphCitedWorkNode,
    citedWorkNode,
  );
  if (citationLink !== undefined) {
    document.body.style.setProperty(
      themeProperty.graphCitationLink,
      citationLink,
    );
  }
}

/** Puts the document back to a theme that states neither colour. */
export function themeStatesNothing(): void {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.body.removeAttribute("style");
}

export function graphNode(
  type: string,
  color?: GraphColor,
): GraphData["nodes"][string] {
  return { type, ...(color ? { color } : {}) };
}
