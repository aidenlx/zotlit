// The interaction one rendered citation carries, wherever it is rendered.

import { Menu } from "obsidian";
import type { HoverParent, Workspace } from "obsidian";

import { getLogger } from "@/lib/log";

import { citationHoverIntent } from "./hover";
import type { HoverPreferences } from "./hover";
import { citationTarget, navigationIntent } from "./intent";
import type { CitedWork, NavigationPane } from "./intent";
import { hoverGesture, mouseGesture, triggerCitekeyHover } from "./shell";
import type { GestureSurface } from "./shell";

const logger = getLogger("citekey-navigation");

/** Where the hover of a rendered citation hangs, and what it is written in. */
export interface CitationHoverTarget {
  /** Carries the `hover-link` the Page preview core plugin answers. */
  workspace: Pick<Workspace, "trigger">;
  /** What Obsidian hangs the popover off, and hides it with. */
  hoverParent: HoverParent;
  /** The path of the note the citation is written in. */
  sourcePath: string;
}

/** One hovered citation, as the Citation Popover is asked to show it. */
export interface CitationHoverRequest {
  event: MouseEvent;
  /** What Obsidian hangs the popover off, and hides it with. */
  hoverParent: HoverParent;
  /** The path of the note the citation is written in. */
  sourcePath: string;
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
  /** What hover answers with, read once per hover. */
  hoverPreferences: () => HoverPreferences;
  /**
   * The vault path of the one Literature Note `citekey` names, or null when
   * zero or several name it — read only by the page preview branch.
   */
  hoverNotePath: (citekey: string) => string | null;
  /** Read when a hover result is due; null when the citation sits in no view. */
  hoverTarget: () => CitationHoverTarget | null;
}

/**
 * Gives one rendered citation the hover the Hover Action names, wherever the
 * citation itself has nothing to open.
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
 * Shows what the Hover Action asks a rendered citation for: the entries of
 * every work it names, or the page preview of the one Literature Note it names.
 *
 * A citation whose keys reach no Zotero Item still opens the popover: the
 * entries say so themselves, where showing nothing would read as breakage. The
 * page preview branch instead stays clear of every key naming zero or several
 * notes, so no preview path can reach the create-then-open flow.
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
    navigation.hoverPreferences(),
    works.map((work) => work.citekey),
  );
  if (intent.kind === "nothing") {
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

  if (intent.kind === "page-preview") {
    const notePath = navigation.hoverNotePath(intent.citekey);
    if (notePath === null) {
      logger.trace("Rendered citation hover suppressed", {
        surface,
        works: works.length,
        reason: "no-note",
      });
      return;
    }
    logger.trace("Rendered citation previews note", {
      surface,
      citekey: intent.citekey,
      path: notePath,
    });
    triggerCitekeyHover(target.workspace, {
      event,
      hoverParent: target.hoverParent,
      targetEl: element,
      linktext: notePath,
      sourcePath: target.sourcePath,
    });
    return;
  }

  logger.trace("Rendered citation shows its entries", {
    surface,
    works: intent.citekeys.length,
    path: target.sourcePath,
  });
  navigation.showPopover({
    hoverParent: target.hoverParent,
    sourcePath: target.sourcePath,
    event,
    targetEl: element,
    citekeys: intent.citekeys,
    open: navigation.open,
  });
}
