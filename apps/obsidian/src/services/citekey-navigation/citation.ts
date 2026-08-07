// The interaction one rendered citation carries, wherever it is rendered.

import { Menu, type HoverParent, type Workspace } from "obsidian";

import { getLogger } from "@/lib/log";

import {
  citationTarget,
  navigationIntent,
  type CitedWork,
  type NavigationPane,
} from "./intent";
import {
  mouseGesture,
  triggerCitekeyHover,
  type GestureSurface,
} from "./shell";

const logger = getLogger("citekey-navigation");

/** Where a page preview of a rendered citation hangs, and what it is written in. */
export interface CitationHoverTarget {
  workspace: Pick<Workspace, "trigger">;
  /** What Obsidian hangs the popover off, and hides it with. */
  hoverParent: HoverParent;
  /** The path of the note the citation is written in. */
  sourcePath: string;
}

export interface CitationNavigation {
  /** The works the citation names, in the order it names them. */
  works: readonly CitedWork[];
  where: GestureSurface;
  /** The open-or-create flow every citekey surface shares. */
  open: (citekey: string, pane: NavigationPane) => void;
  /**
   * The vault path of the one Literature Note `citekey` names, or null when
   * zero or several name it.
   */
  hoverNotePath: (citekey: string) => string | null;
  /** Read when a preview is due; null when the citation sits in no view. */
  hoverTarget: () => CitationHoverTarget | null;
}

/**
 * Gives one rendered citation the click, menu, and hover of an internal link —
 * the surface a marked citekey already carries, over text a style formatted.
 *
 * The listeners sit on the citation's own element, so they go with it when the
 * surface renders that citation again.
 */
export function attachCitationNavigation(
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  element.addEventListener("click", (event) => {
    if (event.button === 0) navigate(event, navigation);
  });
  // Obsidian reads middle-click off `mousedown`; `click` never fires for it.
  element.addEventListener("mousedown", (event) => {
    if (event.button === 1) navigate(event, navigation);
  });
  element.addEventListener("mouseover", (event) => {
    preview(event, element, navigation);
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
 * Previews the Literature Note a rendered citation names.
 *
 * A citation naming several works reaches the intent module as an unavailable
 * target and previews nothing, so no popover path can create a file.
 */
function preview(
  event: MouseEvent,
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  const { works, where } = navigation;
  const surface = where.surface;
  // The same re-entry guard Obsidian runs before its own `hover-link`, so
  // moving within one citation fires a single hover.
  const { relatedTarget } = event;
  if (relatedTarget instanceof Node && element.contains(relatedTarget)) return;

  const single = works.length === 1 ? works[0]!.citekey : null;
  const notePath = single === null ? null : navigation.hoverNotePath(single);
  const intent = navigationIntent(
    mouseGesture(event, "hover", where),
    notePath === null || single === null
      ? { resolution: "unavailable" }
      : { resolution: "direct", citekey: single },
  );
  // The second test repeats the target's own input so TypeScript sees the path
  // a `direct` resolution always carries.
  if (intent.kind !== "hover" || notePath === null) {
    logger.trace("Rendered citation hover suppressed", {
      surface,
      works: works.length,
    });
    return;
  }

  const target = navigation.hoverTarget();
  if (!target) {
    logger.trace("Rendered citation sits in no view", {
      surface,
      citekey: intent.citekey,
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
}
