// The reading-mode surface of the Citekey Editor Treatment: literal citekey
// citations show formatted in the reading view, navigate like links, and are
// rewritten in place while Obsidian shows their section.
import { Effect, Layer } from "effect";
import { MarkdownRenderChild, setTooltip } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";

import { scopedBridge, valueOr } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace, workspaceTrigger } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import { renderProfileRecovery } from "@/lib/profile-recovery";
import {
  rerenderReadingViewsIn,
  retireReadingSurface,
} from "@/lib/reading-surface";
import {
  LiveSections,
  isDraftMarkdown,
  markdownViewOf,
  sectionRange,
} from "@/lib/reading-view";
import { themeHook } from "@/lib/theme-hooks";
import { heldResolution } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type {
  CitationLookupAnswer,
  CitationLookupObservation,
} from "@/services/citation-index/service";
import { CitationPopover } from "@/services/citation-popover/service";
import {
  citationContent,
  citationElement,
  citationKeyStates,
  citationState,
  citationStateHooks,
  citedWorks,
  citekeyState,
  literalKeyStateOf,
  presentedCitationEqual,
  sectionCoordinates,
} from "@/services/citation-text/present";
import type {
  CitationKeyState,
  DocumentCitations,
  PresentedCitation,
} from "@/services/citation-text/present";
import { CitationText } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import {
  attachCitationHover,
  attachCitationNavigation,
  attachClosedCitationGestures,
  hoverPreferences,
  markCitationClick,
} from "@/services/citekey-navigation";
import type {
  CitationNavigation,
  HoverPreferences,
} from "@/services/citekey-navigation";
import type { ProfilePresentationFailure } from "@/services/pandoc/document-presentation";
import type { Held } from "@/services/query-client/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { replaceCitations, sectionCitations } from "./render";
import type { SectionCitation } from "./render";
import "./style.css";

/** One element standing in a citation's place, and what it was built from. */
interface PlacedCitation {
  element: HTMLElement;
  /** The content shown — the source where none was formatted for it. */
  shown: PresentedCitation | string;
  /** The key states the element's theme hooks and handlers were chosen by. */
  states: readonly CitationKeyState[];
  /** The navigation the element's handlers read, refreshed while it stays. */
  navigation: CitationNavigation;
}

/** One held section: its citations, and the elements standing in their place. */
interface HeldSection {
  citations: readonly SectionCitation[];
  lookup: CitationLookupObservation;
  /**
   * The element standing in each citation's place. Empty until the first show
   * puts elements in place.
   */
  placed: PlacedCitation[];
}

/** Whether two placed answers show the same content. */
function shownEqual(
  left: PresentedCitation | string,
  right: PresentedCitation | string,
): boolean {
  if (typeof left === "string" || typeof right === "string") {
    return left === right;
  }
  return presentedCitationEqual(left, right);
}

/**
 * Renders literal citekey citations in reading mode, so a shared or published
 * view of a note shows formatted citations.
 *
 * A citation is formatted from the shared citation text of its document, so
 * this surface, the editor's cluster widgets, and the References Sidebar agree
 * on the References Style and go stale together. With no engine installed the
 * citation keeps its native source text.
 *
 * Navigation is independent: when enabled, one work opens on click and several
 * works open a menu at the cursor. Wherever Citations stay closed as links, a
 * plain click on a rendered citation does nothing — it reads as the static text
 * it is — and Mod-click keeps opening the work. Hover belongs to the Hover
 * Action alone, so every citation this surface renders carries it. A citation
 * none of whose keys reaches a Zotero Item stays raw source text, inert but for
 * that hover.
 *
 * A post-processor stays registered for the plugin's lifetime, so the toggles
 * are read per render rather than by adding and removing it.
 *
 * A section this surface rendered into stays held while Obsidian shows it, and
 * its citations are rewritten in place — the same Held Read text, or the fresh
 * text that replaced it — so a change to what a citation says moves nothing
 * else in the view. A toggle that changes whether the surface touches a
 * citation at all still renders the views again.
 */
export const layerCitekeyReading = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const vault = yield* Vault;
    const workspace = yield* Workspace;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const citationLookup = yield* CitationLookup;
    const citationPopover = yield* CitationPopover;
    const citekeyEditor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    /** `undefined` until the first settings snapshot decides the treatment. */
    let active: boolean | undefined;
    let showFormatted = false;
    let navigationEnabled = false;
    let hover: HoverPreferences = hoverPreferences(defaults);
    /** The sections this surface rendered into and Obsidian still shows. */
    const sections = new LiveSections();
    /** What a hover raises its `hover-link` on, and a recovery button its Profile switch. */
    const hoverWorkspace = workspaceTrigger(workspace, run);
    /** A reading view holds what a post-processor produced until it renders again. */
    const rerender = rerenderReadingViewsIn(workspace);

    const applySettings = Effect.fnUntraced(function* (
      next: Readonly<Settings>,
    ) {
      // Read straight through: hover answers from the newest snapshot, and
      // nothing rendered depends on it.
      hover = hoverPreferences(next);
      const pandocCitations = next["citation.pandoc-citations"];
      const formatted = pandocCitations && next["citation.show-formatted"];
      const navigation = pandocCitations && next["citation.open-as-links"];
      const nextActive = formatted || navigation;
      if (
        nextActive === active &&
        formatted === showFormatted &&
        navigation === navigationEnabled
      ) {
        return;
      }
      const initial = active === undefined;
      const activeChanged = nextActive !== active;
      active = nextActive;
      showFormatted = formatted;
      navigationEnabled = navigation;
      if (activeChanged) {
        yield* Effect.logInfo(
          nextActive ? "Citekey reading enabled" : "Citekey reading disabled",
        );
      } else {
        yield* Effect.logDebug("Citekey reading treatment changed").pipe(
          Effect.annotateLogs({
            navigationEnabled: navigation,
            showFormatted: formatted,
          }),
        );
      }
      if (initial) return;
      yield* rerender;
    });

    /**
     * Builds the element one citation shows as, with its handlers attached,
     * and the navigation those handlers read.
     */
    const buildCitationElement = (
      doc: Document,
      sourcePath: string,
      {
        content,
        states,
        works,
        at,
        failure,
        lookup,
      }: {
        content: PresentedCitation | string;
        states: readonly CitationKeyState[];
        works: CitationNavigation["works"];
        /** The occurrence shown in the citation's place, where formatted text is. */
        at: CitationNavigation["shown"];
        /** The Profile failure the document's presentation reports, if any. */
        failure: ProfilePresentationFailure | undefined;
        /** The section-owned lookup used by hover while this element stays live. */
        lookup: CitationLookupAnswer | null;
      },
    ): { element: HTMLElement; navigation: CitationNavigation } => {
      const themeClasses = [
        themeHook.citationKey,
        ...citationStateHooks(citationState(states)),
      ];
      const element = citationElement(doc, content, themeClasses);
      if (failure) {
        element.dataset["citationPresentationError"] = "profile";
        setTooltip(
          element,
          m.notice_imported_note_profile_unknown({
            stamp: failure.diagnostic.stamp,
            target: failure.target,
          }),
        );
      }
      const navigation: CitationNavigation = {
        works,
        // The occurrence this section shows in the citation's place, which is
        // where a note-class style's own note text is read from, however often
        // the popover reads it again. A citation left as source text shows
        // none.
        shown: at,
        where: { surface: "reading" },
        // Unload interrupts a pending open.
        open: (citekey, pane) => {
          void bridge
            .runPromiseExit(citekeyEditor.openCitekey(citekey, pane))
            .then((exit) => valueOr(exit, undefined));
        },
        showPopover: (request) => run(citationPopover.show(request)),
        hoverPreferences: () => hover,
        hoverNotePath: (citekey) =>
          run(citekeyEditor.hoverNotePath(citekey, lookup)),
        workspace: hoverWorkspace,
        hoverTarget: () => {
          // The Markdown view a rendered citation sits in, which Obsidian
          // hangs the popover off. Markdown rendered outside such a view — an
          // export, a popover of its own — belongs to none, and hover stays
          // silent there.
          const hoverParent = markdownViewOf(
            run(workspace.markdownViews),
            element,
          );
          return hoverParent === null
            ? null
            : { workspace: hoverWorkspace, hoverParent, sourcePath };
        },
      };
      // Hover belongs to the Hover Action, so every rendered citation carries
      // it. Click is Citekey Navigation's alone: it opens the work the
      // citation names, and wherever Citations stay closed as links a plain
      // click does nothing, the way it does on any other rendered text. A
      // citation none of whose keys reaches a Zotero Item has nothing to open
      // anyway; it stays wrapped so themes can style its error state, and its
      // entries say as much. An Ambiguous Citation Key names no one Item
      // either, so a citation resting on those alone opens nothing.
      if (navigationEnabled && states.includes("resolved")) {
        markCitationClick(element, "open");
        attachCitationNavigation(element, navigation);
        return { element, navigation };
      }
      markCitationClick(element, "none");
      if (!navigationEnabled && showFormatted) {
        attachClosedCitationGestures(element, navigation);
        return { element, navigation };
      }
      attachCitationHover(element, navigation);
      return { element, navigation };
    };

    /**
     * Shows every citation of a section what the document's Held Read holds
     * for it. The first show splits the source text and puts an element in
     * each citation's place. Every later one keeps an element whose content
     * and key states the fresh answer equals, refreshing only the navigation
     * its handlers read — so a hover or popover anchored on it stays anchored
     * — and swaps a rebuilt element for one they differ from, so its theme
     * hooks and handlers follow the current answer. A citation the fresh text
     * holds nothing for keeps what it shows.
     *
     * `text` is the document's Held Read, as `CitationText.peek` reads it.
     */
    const show = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
      {
        citations,
        lookup,
        placed,
        text,
      }: HeldSection & { text: Held<DocumentCitations> | null },
    ): void => {
      const answer = text?.value.lookup ?? lookup.current?.value ?? null;
      const resolutionPending = answer === null;
      // Source stays until a first answer: native text while the read
      // settles, and what a placed element shows until fresh text replaces it.
      if (text === null && !resolutionPending) return;
      renderProfileRecovery(
        el,
        { workspace: hoverWorkspace },
        {
          path: text?.value.presentationFailure?.target,
        },
      );
      const snapshotState = (citekey: string) =>
        citekeyState(heldResolution(answer, citekey));
      const stateOf =
        text === null ? snapshotState : literalKeyStateOf(text.value);
      // Which occurrence each citation of the section is, so a
      // position-dependent style shows every one of them the text rendered
      // for its own place.
      const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
      /**
       * The element citation `index` shows as: the one placed, where the
       * fresh answer equals what it was built from, or a rebuilt one recorded
       * in its place.
       */
      const place = (citation: SectionCitation, index: number): HTMLElement => {
        const content = showFormatted
          ? text === null
            ? null
            : citationContent(citation, text.value, coordinates[index])
          : null;
        const previous = placed[index];
        const shown = content ?? previous?.shown ?? citation.source;
        const states = citationKeyStates(citation, stateOf);
        const works = text === null ? [] : citedWorks(citation, text.value);
        const at =
          content === null ? undefined : { citation, at: coordinates[index] };
        if (
          previous !== undefined &&
          shownEqual(previous.shown, shown) &&
          previous.states.length === states.length &&
          previous.states.every((state, i) => state === states[i])
        ) {
          Object.assign(previous.navigation, {
            works,
            shown: at,
            hoverNotePath: (citekey: string) =>
              run(citekeyEditor.hoverNotePath(citekey, answer)),
          });
          return previous.element;
        }
        const built = buildCitationElement(el.ownerDocument, ctx.sourcePath, {
          content: shown,
          states,
          works,
          at,
          failure: text?.value.presentationFailure,
          lookup: answer,
        });
        placed[index] = { ...built, shown, states };
        return built.element;
      };
      if (placed.length === 0) {
        replaceCitations(citations, place);
        return;
      }
      for (const [index, citation] of citations.entries()) {
        const previous = placed[index]!.element;
        const next = place(citation, index);
        if (next !== previous) previous.replaceWith(next);
      }
    };

    /**
     * Holds one rendered section and shows its citations, which are rewritten
     * in place for as long as Obsidian shows the section.
     */
    const process = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
    ): void => {
      if (isDraftMarkdown(el)) return;
      if (active !== true) return;
      const citations = sectionCitations(el);
      if (citations.length === 0) return;
      const file = run(vault.getFileByPath(ctx.sourcePath));
      if (!file) return;

      let rewrite: Effect.Effect<void> = Effect.void;
      const lookup = run(citationLookup.observe(() => run(rewrite)));
      const child = new MarkdownRenderChild(el);
      child.onunload = () => lookup[Symbol.dispose]();
      ctx.addChild(child);
      const held: HeldSection = { citations, lookup, placed: [] };
      rewrite = Effect.gen(function* () {
        if (active !== true) return;
        const text = yield* citationText.peek(ctx.sourcePath);
        show(el, ctx, { ...held, text });
      });
      lookup.set({
        citekeys: [
          ...new Set(
            citations.flatMap((citation) =>
              citation.keys.map(({ citekey }) => citekey),
            ),
          ),
        ],
      });
      sections.hold(el, ctx, rewrite);
      run(rewrite);
    };

    host.registerMarkdownPostProcessor((el, ctx) => process(el, ctx));
    yield* forkEach(settings.changes, applySettings);
    // What a placed citation says follows its document's Held Read: the live
    // sections of that document rewrite on its change, and every live section
    // rewrites when all text goes stale — which a citekey resolution snapshot
    // rebuild counts as.
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? sections.refresh(event.path)
        : event.type === "invalidated"
          ? sections.refresh()
          : undefined,
    );
    // A rendered citation carries this layer's own click and hover handlers,
    // so the reading views render again without it once it is gone.
    yield* retireReadingSurface(workspace, () => {
      active = false;
    });
  }).pipe(withLogCategory("citekey-reading")),
);
