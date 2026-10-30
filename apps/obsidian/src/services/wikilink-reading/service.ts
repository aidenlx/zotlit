// The Wikilink Reading Rendering: it registers the Markdown post-processor,
// answers which Literature Note a linkpath names, rewrites the Citations it
// placed when their text changes, and asks the open reading views to render
// again when something outside their documents changed which links it touches.
import { Effect, Layer } from "effect";
import { setTooltip } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";

import { scopedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
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
import {
  WikilinkDisplaySettings,
  citationOfRun,
  citationTarget,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import type { LiteratureNoteTarget, RunMember } from "@/lib/wikilink-citation";
import type { CitationLookupAnswer } from "@/services/citation-index/service";
import { CitationPopover } from "@/services/citation-popover/service";
import {
  citationContent,
  sectionCoordinates,
  showCitation,
} from "@/services/citation-text/present";
import type {
  DocumentCitations,
  ShownCitation,
} from "@/services/citation-text/present";
import { CitationText } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import {
  clickWikilinkCitation,
  hoverWikilinkCitation,
  markCitationClick,
} from "@/services/citekey-navigation";
import type { CitationHover } from "@/services/citekey-navigation";
import {
  NoteIndex,
  literatureNoteTargetIn,
} from "@/services/note-index/service";
import type { Held } from "@/services/query-client/service";
import { PluginSettings } from "@/services/settings/service";

import {
  hasInternalLink,
  renderCitationRuns,
  sectionCitationRuns,
  sectionLinktexts,
} from "./render";
import type { SectionRuns } from "./render";
import "./style.css";

/**
 * The Wikilink Reading Rendering: in reading mode a Literature Note wikilink —
 * and a whole Citation Run of them — shows the citation a style formatted.
 * Native link presentation stays in place until that render lands, while the
 * target stays Obsidian's. Hover follows the Hover Action: the Citation Popover
 * replaces Obsidian's own hover under the popover, and every other action
 * leaves the link hovering as the link it is. The click follows the
 * open-as-links choice: a plain click does nothing wherever Citations stay
 * closed as links — the Citation reads as the static text it is — and every
 * other click stays Obsidian's.
 *
 * A post-processor stays registered for the plugin's lifetime, so source and
 * display choices are read per render rather than by adding and removing it.
 *
 * A section this surface rendered into stays held while Obsidian shows it, and
 * its Citations are rewritten in place — the same Held Read text, or the fresh
 * text that replaced it — so a change to what a Citation says moves nothing
 * else in the view. A change to which links are Citations at all still renders
 * the views again.
 *
 * Two behavior changes come with replacing an anchor's text, both intended and
 * documented for the user: dragging such a link out of reading mode and the
 * context menu's Copy carry the rendered citation rather than the raw path.
 *
 * @see docs/research/wikilink-display-decoration-interaction.md — section 6
 */
export const layerWikilinkReading = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const vault = yield* Vault;
    const metadata = yield* MetadataCache;
    const workspace = yield* Workspace;
    const notes = yield* NoteIndex;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const citationPopover = yield* CitationPopover;
    const citekeyEditor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    /** The source and display settings that decide what a link displays. */
    const display = new WikilinkDisplaySettings();
    /** The sections this surface rendered into and Obsidian still shows. */
    const sections = new LiveSections();
    /** Set when the layer closes, which retires the treatment the post-processor applies. */
    let retired = false;
    /** What a hover raises its `hover-link` on, and a recovery button its Profile switch. */
    const hoverWorkspace = workspaceTrigger(workspace, run);

    const rerender = rerenderReadingViewsIn(workspace);

    /**
     * The Literature Note each linkpath of a section's native links names, or
     * null for one that names an ordinary note or nothing. Read before the
     * scan, which asks it per link.
     */
    const literatureNoteTargets = Effect.fnUntraced(function* (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
      lookup: CitationLookupAnswer | null,
    ) {
      const targets = new Map<string, LiteratureNoteTarget | null>();
      if (!display.enabled) return targets;
      for (const linktext of sectionLinktexts(el)) {
        const target = citationTarget(linktext);
        if (target === null || targets.has(target.linkpath)) continue;
        targets.set(
          target.linkpath,
          yield* literatureNoteTargetIn(metadata, target.linkpath, {
            sourcePath: ctx.sourcePath,
            lookup,
          }),
        );
      }
      return targets;
    });

    /**
     * The Citation Runs of a section's native links, which is every run that
     * has not rendered yet: a rendered run's anchor shows formatted text, so
     * the scan passes it by.
     */
    const sectionRuns = (
      el: HTMLElement,
      targets: ReadonlyMap<string, LiteratureNoteTarget | null>,
    ): SectionRuns =>
      sectionCitationRuns(el, (linktext) =>
        wikilinkCitation(linktext, {
          literatureNote: (linkpath) => targets.get(linkpath) ?? null,
          enabled: display.enabled,
        }),
      );

    /**
     * Gives one rendered Citation what this surface answers for it: the
     * Citation Popover on hover, in place of the page preview Obsidian answers
     * a Literature Note link with, and nothing at all on a plain click, in
     * place of opening that note.
     *
     * The listeners sit on the anchor the run rendered into, which is where
     * the post-processor left the Citation and where Obsidian's own delegated
     * handlers would have read the link from. They last until `signal` aborts,
     * which is when the section rewrites and attaches the next ones.
     */
    const attachPopover = (
      members: readonly RunMember<HTMLAnchorElement>[],
      shown: ShownCitation,
      { sourcePath, signal }: { sourcePath: string; signal: AbortSignal },
    ): void => {
      const element = members[0]!.source;
      const hover: CitationHover = {
        works: members.map(({ citation }) => ({
          citekey: citation.item.citekey,
          indexedKey: citation.indexedKey,
        })),
        // The occurrence this section shows in the Citation's place, which is
        // where a note-class style's own note text is read from, however often
        // the popover reads it again.
        shown,
        where: { surface: "reading" },
        // Unload interrupts a pending open.
        open: (citekey, pane) => {
          bridge.runAndForget(citekeyEditor.openCitekey(citekey, pane));
        },
        showPopover: (request) => run(citationPopover.show(request)),
        hoverPreferences: () => display.hover,
        hoverTarget: () => {
          const hoverParent = markdownViewOf(
            run(workspace.markdownViews),
            element,
          );
          return hoverParent === null
            ? null
            : { workspace: hoverWorkspace, hoverParent, sourcePath };
        },
      };
      if (display.popoverHover) {
        element.addEventListener(
          "mouseover",
          (event) => {
            hoverWikilinkCitation(event, element, hover);
          },
          { signal },
        );
      }
      if (display.clickIntercepted) {
        // The anchor states what its plain click does, which is what
        // neutralizes Obsidian's own link cursor and hover colour on it.
        markCitationClick(element, "none", { cursor: false });
        element.addEventListener(
          "click",
          (event) => {
            clickWikilinkCitation(event, { where: hover.where });
          },
          { signal },
        );
      }
    };

    /**
     * Shows every Citation Run of a section what the document's Held Read
     * holds for it. A run that has not rendered collapses into its first
     * anchor once text is held for it; a run that has keeps that anchor and
     * its current text until fresh text differs. Native links stay in place
     * while the read settles.
     *
     * @param rendered the runs that already show formatted text, in the order
     *   they rendered; a run this call renders is appended.
     * @param signal retires the gesture listeners this call attaches.
     * @param text the document's Held Read.
     * @param targets the Literature Note each linkpath of the section names.
     * @returns how many Citations show their formatted text.
     */
    const show = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
      {
        rendered,
        signal,
        text,
        targets,
      }: {
        rendered: SectionRuns;
        signal: AbortSignal;
        text: Held<DocumentCitations>;
        targets: ReadonlyMap<string, LiteratureNoteTarget | null>;
      },
    ): number => {
      const runs = [...rendered, ...sectionRuns(el, targets)].sort((a, b) =>
        documentOrder(a[0]!.source, b[0]!.source),
      );
      // Which occurrence each Citation of the section is, so a
      // position-dependent style shows every one of them the text rendered
      // for its own place.
      const citations = runs.map((members) => citationOfRun(members));
      const failure = text.value.presentationFailure;
      renderProfileRecovery(
        el,
        { workspace: hoverWorkspace },
        { path: failure?.target },
      );
      if (failure) {
        const diagnostic = m.notice_imported_note_profile_unknown({
          stamp: failure.diagnostic.stamp,
          target: failure.target,
        });
        for (const { source } of runs.flat()) {
          source.dataset["citationPresentationError"] = "profile";
          setTooltip(source, diagnostic);
        }
      }
      const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
      const contents = citations.map((citation, index) =>
        citationContent(citation, text.value, coordinates[index]),
      );
      // A run that rendered before keeps its one anchor: the collapse never
      // runs on it again, and its text follows the fresh content where there
      // is one.
      const collapsed = new Set(rendered);
      const shown = renderCitationRuns(runs, (members, index) => {
        const content = contents[index] ?? null;
        if (!collapsed.has(members)) {
          if (content !== null) rendered.push(members);
          return content;
        }
        if (content !== null)
          showCitation(members[0]!.source, content, "suppress");
        return null;
      });
      if (!display.popoverHover && !display.clickIntercepted) return shown;
      for (const [index, members] of runs.entries()) {
        // A run the style formatted no text for keeps Obsidian's own link,
        // hover and click and all; only the Citation this surface rendered
        // carries the popover.
        if (!rendered.includes(members)) continue;
        attachPopover(
          members,
          { citation: citations[index]!, at: coordinates[index] },
          { sourcePath: ctx.sourcePath, signal },
        );
      }
      return shown;
    };

    /**
     * Holds one rendered section and shows its Citations, which are rewritten
     * in place for as long as Obsidian shows the section.
     */
    const process = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
    ): void => {
      if (isDraftMarkdown(el)) return;
      if (retired) return;
      // Any internal link, Citation or not: a link whose Item gains a native
      // citation key at the next snapshot rebuild becomes a Citation in place.
      if (!hasInternalLink(el)) return;
      /** The runs that show formatted text, each collapsed into its first anchor. */
      const rendered: SectionRuns = [];
      /** Retires the gesture listeners the previous rewrite attached. */
      let gestures = new AbortController();
      const rewrite = Effect.gen(function* () {
        if (retired) return;
        gestures.abort();
        gestures = new AbortController();
        const signal = gestures.signal;
        // Read only once a Citation is on screen, so a section that writes none
        // waits for nothing.
        const file = yield* vault.getFileByPath(ctx.sourcePath);
        const text = file === null ? null : yield* citationText.peek(file.path);
        if (text === null) return;
        const targets = yield* literatureNoteTargets(
          el,
          ctx,
          text.value.lookup,
        );
        const shown = show(el, ctx, { rendered, signal, text, targets });
        if (shown > 0) {
          yield* Effect.logTrace("Rendered wikilink citations").pipe(
            Effect.annotateLogs({ path: ctx.sourcePath, count: shown }),
          );
        }
      });
      sections.hold(el, ctx, rewrite);
      run(rewrite);
    };

    host.registerMarkdownPostProcessor((el, ctx) => process(el, ctx));
    yield* forkEach(display.redraws(settings.changes), () => rerender);
    // Creating, deleting, or renaming a Literature Note changes which links
    // are Citations without changing any document, so every open reading view
    // renders again. The Note Index reports every moved mapping as `changed`,
    // and its one Full Scan per session as `indexed`.
    yield* forkEach(notes.changes, (change) =>
      change.type === "frontmatter-changed" ? undefined : rerender,
    );
    // What a placed Citation says follows its document's Held Read: the live
    // sections of that document rewrite on its change, and every live section
    // rewrites when all text goes stale.
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? sections.refresh(event.path)
        : event.type === "invalidated"
          ? sections.refresh()
          : undefined,
    );
    // A reading view holds the text this layer wrote, so the views render
    // again without it once it is gone.
    yield* retireReadingSurface(workspace, () => {
      retired = true;
    });
  }).pipe(withLogCategory("wikilink-reading")),
);

/** Sorts two nodes into document order. */
function documentOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}
