// The citekey editor treatment in Live Preview: the CodeMirror extension the
// settings switch on, the annotation link hover beside it, and the hover link
// source every citekey surface shares.
import type { Extension } from "@codemirror/state";
import { Effect, Layer, Stream } from "effect";

import { dispatchToMarkdownEditors } from "@/lib/editor-decoration";
import { scopedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { ObsidianApp } from "@/lib/obsidian-app";
import { Workspace } from "@/lib/obsidian-workspace";
import { PluginHost } from "@/lib/plugin-host";
import { AnnotationPopover } from "@/services/annotation-popover/service";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { CitationPopover } from "@/services/citation-popover/service";
import { CitationText } from "@/services/citation-text/service";
import {
  CITEKEY_HOVER_SOURCE,
  hoverPreferences,
} from "@/services/citekey-navigation";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { annotationLinkHoverExtension } from "./annotation-link";
import { citekeyDecorationsChanged, citekeyEditorExtension } from "./extension";
import { CitekeyEditor, citekeyTreatment } from "./service";
import type { CitekeyTreatment } from "./service";

/**
 * Marks literal Pandoc `@citekey` text in the editor while the settings ask
 * for the treatment.
 *
 * The CodeMirror extension is registered once as a mutable array, so the
 * setting toggles it by rewriting that array and asking Obsidian to
 * reconfigure — the mechanism `registerEditorExtension` documents. The hover
 * link source, the annotation link hover and that array register in this
 * order, once, for the plugin's lifetime.
 */
export const layerCitekeyEditorExtension = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const app = yield* ObsidianApp;
    const workspace = yield* Workspace;
    const editor = yield* CitekeyEditor;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const lookup = yield* CitationLookup;
    const citationPopover = yield* CitationPopover;
    const annotationPopover = yield* AnnotationPopover;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    /** What the extension reads per decoration build and per hover. */
    let treatment: CitekeyTreatment = {
      navigationEnabled: false,
      showFormatted: false,
      active: false,
      hover: hoverPreferences(defaults),
    };
    /** Registered once; its contents are the on/off switch. */
    const extensions: Extension[] = [];
    const extension = citekeyEditorExtension({
      workspace: {
        trigger: (name, ...data) => run(workspace.trigger(name, ...data)),
      },
      open: (citekey, pane) =>
        void bridge.runPromise(editor.openCitekey(citekey, pane)),
      showPopover: (request) => run(citationPopover.show(request)),
      hoverPreferences: () => treatment.hover,
      hoverNotePath: (citekey, answer) =>
        run(editor.hoverNotePath(citekey, answer)),
      observeLookup: (changed) => run(lookup.observe(changed)),
      navigationEnabled: () => treatment.navigationEnabled,
      showFormatted: () => treatment.showFormatted,
      citationText: (path) => run(citationText.peek(path)),
    });
    // A Durable Annotation Link shows its Annotation on every hover.
    const annotationLinkHover = annotationLinkHoverExtension({
      showAnnotation: (request) =>
        void bridge.runPromise(annotationPopover.show(request)),
    });

    /**
     * Asks the open Markdown editors to build their decorations again. The
     * decoration layer owns what changed; this only names the reason, since
     * the data behind a mark or a widget lives outside the document.
     *
     * @param path the one document to reach, or nothing for every editor.
     */
    const decorateAgain = (path?: string) =>
      Effect.gen(function* () {
        if (!treatment.active) return;
        const editors = dispatchToMarkdownEditors(
          app,
          citekeyDecorationsChanged.of(undefined),
          { path },
        );
        yield* Effect.logTrace("Redrawing citation widgets").pipe(
          Effect.annotateLogs({ editors, path }),
        );
      });

    const apply = (next: CitekeyTreatment) =>
      Effect.gen(function* () {
        // Read straight through: hover answers from the newest snapshot, and
        // nothing drawn depends on it.
        const previous = treatment;
        treatment = next;
        const activeChanged = next.active !== previous.active;
        const treatmentChanged =
          next.navigationEnabled !== previous.navigationEnabled ||
          next.showFormatted !== previous.showFormatted;
        if (activeChanged) {
          extensions.length = 0;
          if (next.active) extensions.push(extension);
          yield* workspace.updateOptions;
          yield* Effect.logInfo(
            next.active ? "Citekey editor enabled" : "Citekey editor disabled",
          );
        } else if (treatmentChanged) {
          yield* decorateAgain();
          yield* Effect.logDebug("Citekey editor treatment changed").pipe(
            Effect.annotateLogs({
              navigationEnabled: next.navigationEnabled,
              showFormatted: next.showFormatted,
            }),
          );
        }
      });

    // Registered once and for the plugin's lifetime, so the row in Obsidian's
    // Page preview settings stays put while the Hover Action changes. Mod is
    // the platform convention for a citation, and Obsidian's own row owns that
    // gate wherever ZotLit hands hover to the page preview.
    host.registerHoverLinkSource(CITEKEY_HOVER_SOURCE, {
      display: m.hover_source_citekey(),
      defaultMod: true,
    });
    host.registerEditorExtension(annotationLinkHover);
    host.registerEditorExtension(extensions);
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        extensions.length = 0;
        return workspace.updateOptions;
      }),
    );
    yield* forkEach(
      Stream.map(settings.changes, (next) => citekeyTreatment(next)),
      apply,
    );
    // A widget's text is read asynchronously and shared with every other
    // surface, so the editors showing that document draw again when it lands
    // or goes stale — until then they keep the raw marked source.
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? decorateAgain(event.path)
        : event.type === "invalidated"
          ? decorateAgain()
          : undefined,
    );
  }).pipe(withLogCategory("citekey-editor")),
);
