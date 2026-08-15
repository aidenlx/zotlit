// The interaction one rendered citation carries, wherever it is rendered.

import { Menu } from "obsidian";
import type { HoverParent } from "obsidian";

import { getLogger } from "@/lib/log";

import { citationHoverIntent } from "./hover";
import { citationTarget, navigationIntent } from "./intent";
import type { CitedWork, NavigationPane } from "./intent";
import { hoverGesture, mouseGesture } from "./shell";
import type { GestureSurface } from "./shell";

const logger = getLogger("citekey-navigation");

/** Where the popover of a rendered citation hangs, and what it is written in. */
export interface CitationHoverTarget {
  /** What Obsidian hangs the popover off, and hides it with. */
  hoverParent: HoverParent;
  /** The path of the note the citation is written in. */
  sourcePath: string;
}

/** One hovered citation, as the Citation Popover is asked to show it. */
export interface CitationHoverRequest extends CitationHoverTarget {
  event: MouseEvent;
  /** The element the popover hangs off: the citation as this surface renders it. */
  targetEl: HTMLElement;
  /** The citekeys the citation names, in the order it names them. */
  citekeys: readonly string[];
  /** The open-or-create flow every citekey surface shares. */
  open: (citekey: string, pane: NavigationPane) => void;
}

export interface CitationNavigation {
  /** The works the citation names, in the order it names them. */
  works: readonly CitedWork[];
  where: GestureSurface;
  /** The open-or-create flow every citekey surface shares. */
  open: (citekey: string, pane: NavigationPane) => void;
  /** Show the Citation Popover of one hovered citation. */
  showPopover: (request: CitationHoverRequest) => void;
  /** Read when a popover is due; null when the citation sits in no view. */
  hoverTarget: () => CitationHoverTarget | null;
}

/**
 * Gives one rendered citation the hover of the Citation Popover — the entries
 * of every work it names, wherever the citation itself has nothing to open.
 *
 * The listener sits on the citation's own element, so it goes with it when the
 * surface renders that citation again.
 */
export function attachCitationHover(
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  element.addEventListener("mouseover", (event) => {
    hover(event, element, navigation);
  });
}

/**
 * Gives one rendered citation the click, menu, and hover of an internal link —
 * the surface a marked citekey already carries, over text a style formatted.
 */
export function attachCitationNavigation(
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  attachCitationHover(element, navigation);
  element.addEventListener("click", (event) => {
    if (event.button === 0) navigate(event, navigation);
  });
  // Obsidian reads middle-click off `mousedown`; `click` never fires for it.
  element.addEventListener("mousedown", (event) => {
    if (event.button === 1) navigate(event, navigation);
  });
}

/**
 * Opens the work a rendered citation names, or asks which when it names
 * several. Every branch runs the shared open-or-create flow, so a missing
 * Literature Note is handled the way it is everywhere else.
 */
function navigate(event: MouseEvent, navigation: CitationNavigation): void {
  const { works, where } = navigation;
  const surface = where.surface;
  const intent = navigationIntent(
    mouseGesture(event, "click", where),
    citationTarget(works),
  );
  if (intent.kind === "open") {
    event.preventDefault();
    logger.debug("Rendered citation opens note", {
      surface,
      citekey: intent.citekey,
      pane: intent.pane,
    });
    navigation.open(intent.citekey, intent.pane);
    return;
  }
  if (intent.kind !== "show-citation-menu") {
    logger.debug("Rendered citation click not followed", {
      surface,
      works: works.length,
      intent: intent.kind,
    });
    return;
  }
  event.preventDefault();

  logger.debug("Rendered citation offers its works", {
    surface,
    works: works.length,
    pane: intent.pane,
  });
  const menu = new Menu();
  for (const work of works) {
    menu.addItem((item) =>
      item.setTitle(work.label).onClick(() => {
        navigation.open(work.citekey, intent.pane);
      }),
    );
  }
  menu.showAtMouseEvent(event);
}

/**
 * Shows the entries of every work a rendered citation names.
 *
 * A citation whose keys reach no Zotero Item still opens the popover: the
 * entries say so themselves, where showing nothing would read as breakage.
 */
function hover(
  event: MouseEvent,
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  const { works, where } = navigation;
  const surface = where.surface;
  // The same re-entry guard Obsidian runs before its own hover, so moving
  // within one citation hovers once.
  const { relatedTarget } = event;
  if (relatedTarget instanceof Node && element.contains(relatedTarget)) return;

  const intent = citationHoverIntent(
    hoverGesture(event, where),
    works.map((work) => work.citekey),
  );
  if (intent.kind !== "popover") {
    logger.trace("Rendered citation hover suppressed", {
      surface,
      works: works.length,
      reason: intent.reason,
    });
    return;
  }

  const target = navigation.hoverTarget();
  if (!target) {
    logger.trace("Rendered citation sits in no view", { surface });
    return;
  }
  logger.trace("Rendered citation shows its entries", {
    surface,
    works: intent.citekeys.length,
    path: target.sourcePath,
  });
  navigation.showPopover({
    ...target,
    event,
    targetEl: element,
    citekeys: intent.citekeys,
    open: navigation.open,
  });
}
