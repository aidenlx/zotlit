// The Wikilink Editor Treatment: it registers the CodeMirror extension,
// answers which Literature Note a linkpath names, and asks the open editors to
// draw again when something outside their documents changed the answer.
import type { Extension } from "@codemirror/state";
import { Effect, Layer } from "effect";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import { scopedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import { WikilinkDisplaySettings } from "@/lib/wikilink-citation";
import type { LiteratureNoteTarget } from "@/lib/wikilink-citation";
import { heldCitekeyOf } from "@/services/citation-index/lookup";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupAnswer } from "@/services/citation-index/service";
import { CitationPopover } from "@/services/citation-popover/service";
import { CitationText } from "@/services/citation-text/service";
import { CitekeyEditor } from "@/services/citekey-editor/service";
import {
  NoteIndex,
  resolveLiteratureNoteIn,
} from "@/services/note-index/service";
import { PluginSettings } from "@/services/settings/service";

import {
  wikilinkDecorationsChanged,
  wikilinkEditorExtension,
} from "./extension";

/**
 * The Wikilink Editor Treatment: in Live Preview a Literature Note wikilink —
 * and a whole Citation Run of them — shows the citation a style formatted.
 * Native wikilink presentation stays in place until that render lands, while
 * drag and conceal interaction stay Obsidian's. Hover follows the Hover Action:
 * the Citation Popover replaces Obsidian's own hover under the popover, and
 * every other action leaves the link hovering as the link it is. The click
 * follows the open-as-links choice: wherever Citations stay closed as links a
 * plain click is taken from Obsidian and places the caret in the link's own
 * source text, and every other click stays Obsidian's.
 *
 * The extension is registered as a mutable array, the mechanism
 * `registerEditorExtension` documents, and stays installed for the plugin's
 * lifetime. Source and display choices are read per decoration build, so a
 * setting change needs no extension re-registration.
 */
export const layerWikilinkEditor = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const notes = yield* NoteIndex;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const lookup = yield* CitationLookup;
    const citationPopover = yield* CitationPopover;
    const citekeyEditor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    /** The source and display settings that decide what a link displays. */
    const display = new WikilinkDisplaySettings();

    /** The Literature Note `linkpath` names from `sourcePath`, with its citation key. */
    const literatureNote = Effect.fnUntraced(function* (
      linkpath: string,
      sourcePath: string,
      answer: CitationLookupAnswer | null,
    ) {
      const note = yield* resolveLiteratureNoteIn(
        metadata,
        linkpath,
        sourcePath,
      );
      if (!note) return null;
      const target: LiteratureNoteTarget = {
        ...note,
        citationKey: heldCitekeyOf(answer, note.indexedKey) ?? null,
      };
      return target;
    });

    /** Registered once; emptied when the layer closes, which retires the treatment. */
    const extensions: Extension[] = [
      wikilinkEditorExtension({
        literatureNote: (linkpath, sourcePath, answer) =>
          run(literatureNote(linkpath, sourcePath, answer)),
        observeLookup: (changed) => run(lookup.observe(changed)),
        enabled: () => display.enabled,
        citationText: (path) => run(citationText.peek(path)),
        open: (citekey, pane) =>
          void bridge.runPromise(citekeyEditor.openCitekey(citekey, pane)),
        showPopover: (request) => run(citationPopover.show(request)),
        hoverPreferences: () => display.hover,
        popoverHover: () => display.popoverHover,
        clickIntercepted: () => display.clickIntercepted,
      }),
    ];

    /**
     * Asks the open Markdown editors to build their decorations again. The
     * decoration layer owns what changed; this only names the reason, since
     * what a link displays lives outside the document.
     *
     * @param path the one document to reach, or nothing for every editor.
     */
    const redraw = (path?: string) =>
      Effect.gen(function* () {
        const editors = dispatchToMarkdownEditors(
          yield* workspace.markdownViews,
          wikilinkDecorationsChanged.of(undefined),
          { path },
        );
        yield* Effect.logTrace("Redrawing wikilink citations").pipe(
          Effect.annotateLogs({ editors, path }),
        );
      });

    host.registerEditorExtension(extensions);
    yield* workspace.updateOptions;
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        extensions.length = 0;
        return workspace.updateOptions;
      }),
    );

    // A setting change redraws whatever changes what a link displays or who
    // answers its hover.
    yield* forkEach(display.redraws(settings.changes), () => redraw());
    // Creating, deleting, or renaming a Literature Note changes what a link
    // displays without changing any document. The Note Index's own
    // invalidation is coarse, so every change redraws every open editor.
    yield* forkEach(notes.changes, (change) =>
      change.type === "frontmatter-changed" ? undefined : redraw(),
    );
    // A citation's formatted text is read asynchronously and shared with every
    // other surface, so the editors showing that document draw again when it
    // lands or goes stale — until then they keep native presentation.
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? redraw(event.path)
        : event.type === "invalidated"
          ? redraw()
          : undefined,
    );
  }).pipe(withLogCategory("wikilink-editor")),
);
