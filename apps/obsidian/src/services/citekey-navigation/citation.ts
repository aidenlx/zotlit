// The interaction one rendered citation carries, wherever it is rendered.

import { Menu } from "obsidian";
import type { HoverParent, Workspace } from "obsidian";

import { getLogger } from "@/lib/log";
import type { ShownCitation } from "@/services/citation-text/present";

import { citationHoverIntent } from "./hover";
import type { CitationHoverIntent, HoverPreferences } from "./hover";
import {
  citationClickIntent,
  citationTarget,
  navigationIntent,
} from "./intent";
import type {
  CitationClickIntent,
  CitedWork,
  HoveredWork,
  NavigationPane,
} from "./intent";
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
  /** The works the citation names, in the order it names them. */
  works: readonly HoveredWork[];
  /**
   * The occurrence the pointer is on, where the surface shows formatted text in
   * the citation's place — which is what the popover reads a note-class style's
   * own note text through, on every read it makes. A surface showing the
   * citation's own source text carries none, and its popover stands on the
   * entries alone.
   */
  shown?: ShownCitation;
  /** The open-or-create flow every citekey surface shares. */
  open: (citekey: string, pane: NavigationPane) => void;
}

/**
 * What one rendered citation answers a hover with, whichever syntax wrote it —
 * the Citation Popover the Hover Action names.
 */
export interface CitationHover {
  /** The works the citation names, in the order it names them. */
  works: readonly HoveredWork[];
  /**
   * The occurrence this citation stands for, where the surface renders
   * formatted text — what a note-class style's own note text reaches the
   * popover through.
   */
  shown?: ShownCitation;
  where: GestureSurface;
  /** The open-or-create flow every citekey surface shares. */
  open: (citekey: string, pane: NavigationPane) => void;
  /** Show the Citation Popover of one hovered citation. */
  showPopover: (request: CitationHoverRequest) => void;
  /** What hover answers with, read once per hover. */
  hoverPreferences: () => HoverPreferences;
  /** Read when a popover is due; null when the citation sits in no view. */
  hoverTarget: () => CitationHoverTarget | null;
}

export interface CitationNavigation extends CitationHover {
  /** The works the citation names, in the order it names them. */
  works: readonly CitedWork[];
  /**
   * The vault path of the one Literature Note `citekey` names, or null when
   * zero or several name it — read only by the page preview branch.
   */
  hoverNotePath: (citekey: string) => string | null;
}

/** What a plain left-click on one rendered citation does. */
export type CitationClickAffordance =
  /** Opens the work it names. */
  | "open"
  /** Places the caret in the source it stands in place of. */
  | "edit"
  /** Nothing at all: the citation is static text. */
  | "none";

/**
 * The cursor a rendered citation takes from {@link markCitationClick}'s
 * attribute, as the utilities that read it.
 */
const CLICK_CURSOR_CLASSES = [
  "zt:data-[zt-click=open]:cursor-link",
  "zt:data-[zt-click=edit]:cursor-text",
  "zt:data-[zt-click=none]:cursor-text",
];

/**
 * States on one rendered citation what a plain left-click on it does, which is
 * what its cursor and its hover colour are drawn from — so the citation says
 * what the gesture reaches before it is made.
 *
 * `data-zt-click` is the plugin's own affordance plumbing, free to change with
 * the DOM structure the theme contract keeps private: it is registered in no
 * theme hook and documented in no theme reference. A theme keys on the public
 * `zt-` classes instead.
 *
 * @param cursor whether the element takes that cursor from the plugin's own
 *   utilities. An anchor Obsidian styles itself takes it from a stylesheet rule
 *   instead, which is what reaches past Obsidian's own unlayered rules.
 *   @default true
 */
export function markCitationClick(
  element: HTMLElement,
  click: CitationClickAffordance,
  { cursor = true }: { cursor?: boolean } = {},
): void {
  element.dataset.ztClick = click;
  if (cursor) element.classList.add(...CLICK_CURSOR_CLASSES);
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
 * Gives one Rendered Citation what it answers wherever Citations stay closed as
 * links: the hover the Hover Action names, and the Mod-click that opens the
 * work anyway, through the same flow every other citekey surface opens it by.
 *
 * A plain click is the platform's own — Live Preview places the caret in the
 * source the citation stands in place of, and reading mode selects the text it
 * landed on — so nothing here touches it.
 *
 * The listeners sit on the citation's own element, so they go with it when the
 * surface renders that citation again.
 */
export function attachClosedCitationGestures(
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  attachCitationHover(element, navigation);
  element.addEventListener("click", (event) => {
    if (clickIntentOf(event, navigation.where) === "navigate") {
      navigate(event, navigation);
    }
  });
}

/**
 * Takes the plain left-click of one rendered wikilink Citation away from
 * Obsidian, wherever Citations stay closed as links: the gesture stops on the
 * Citation, so the delegated handler Obsidian hangs above the link never opens
 * the note with it.
 *
 * Mod-click and middle-click reach that handler untouched, which is what opens
 * the Literature Note the link names.
 *
 * @param where the surface the Citation is rendered on, which decides what the
 *   swallowed click leaves in its place.
 * @param edit what Live Preview does with the click instead: place the caret,
 *   which reveals the wikilink's own source text. Reading mode renders static
 *   text and supplies none.
 */
export function clickWikilinkCitation(
  event: MouseEvent,
  {
    where,
    edit,
  }: { where: GestureSurface; edit?: (event: MouseEvent) => void },
): void {
  if (event.button !== 0) return;
  const intent = clickIntentOf(event, where);
  if (intent === "navigate") return;
  event.preventDefault();
  event.stopPropagation();
  logger.debug("Wikilink citation keeps its note closed", {
    surface: where.surface,
    intent,
  });
  if (intent === "edit") edit?.(event);
}

/**
 * What one mouse event on a Rendered Citation means while Citations stay closed
 * as links. Obsidian reads middle-click off `mousedown`, so a button this shell
 * leaves alone is named here rather than inferred from the event type.
 */
function clickIntentOf(
  event: MouseEvent,
  where: GestureSurface,
): CitationClickIntent {
  if (event.button !== 0) return "nothing";
  return citationClickIntent(mouseGesture(event, "click", where));
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
 * Shows the Citation Popover of one hovered wikilink Citation, in place of the
 * hover Obsidian answers a Literature Note link with.
 *
 * The popover is the only hover this pipeline answers: a link Obsidian previews
 * itself needs nothing added under Page preview, and Off adds nothing anywhere.
 * Popover mode owns the gesture whole — the hover stops here for every Citation
 * the mode covers, so the delegated handler Obsidian hangs above the link sees
 * none of them and the two results never stack. A Require Mod gate the popover
 * is still waiting on is a hover that shows nothing, never a way back to the
 * page preview.
 *
 * @param element the citation as this surface renders it, which the popover
 *   hangs off and the re-entry guard is read against.
 */
export function hoverWikilinkCitation(
  event: MouseEvent,
  element: HTMLElement,
  hover: CitationHover,
): void {
  const preferences = hover.hoverPreferences();
  if (preferences.action === "popover") event.stopPropagation();
  const answer = hoverResult(event, element, { hover, preferences });
  if (answer === null || answer.intent.kind !== "popover") return;
  logger.trace("Wikilink citation shows its entries", {
    surface: hover.where.surface,
    works: hover.works.length,
    path: answer.target.sourcePath,
  });
  hover.showPopover({
    hoverParent: answer.target.hoverParent,
    sourcePath: answer.target.sourcePath,
    event,
    targetEl: element,
    works: hover.works,
    shown: hover.shown,
    open: hover.open,
  });
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
  const answer = hoverResult(event, element, {
    hover: navigation,
    preferences: navigation.hoverPreferences(),
  });
  if (answer === null) return;
  const { intent, target } = answer;

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
    works,
    shown: navigation.shown,
    open: navigation.open,
  });
}

/** The hover results a surface has something to show for. */
type ShownHoverIntent = Exclude<CitationHoverIntent, { kind: "nothing" }>;

/**
 * What one hover over a rendered citation is due, with the view the result
 * hangs in.
 *
 * @param preferences the Hover Action settings, read once for this hover.
 * @returns null when the gesture re-enters the citation the pointer is already
 *   inside, when the Hover Action answers it with nothing, or when the citation
 *   sits in no view at all.
 */
function hoverResult(
  event: MouseEvent,
  element: HTMLElement,
  {
    hover,
    preferences,
  }: { hover: CitationHover; preferences: HoverPreferences },
): { intent: ShownHoverIntent; target: CitationHoverTarget } | null {
  const { works, where } = hover;
  const surface = where.surface;
  // The same re-entry guard Obsidian runs before its own hover, so moving
  // within one citation hovers once.
  const { relatedTarget } = event;
  if (relatedTarget instanceof Node && element.contains(relatedTarget)) {
    return null;
  }

  const intent = citationHoverIntent(
    hoverGesture(event, where),
    preferences,
    works.map((work) => work.citekey),
  );
  if (intent.kind === "nothing") {
    logger.trace("Rendered citation hover suppressed", {
      surface,
      works: works.length,
      reason: intent.reason,
    });
    return null;
  }

  const target = hover.hoverTarget();
  if (!target) {
    logger.trace("Rendered citation sits in no view", { surface });
    return null;
  }
  return { intent, target };
}
