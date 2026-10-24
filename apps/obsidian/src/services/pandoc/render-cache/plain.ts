/** Bibliography renders for views and legacy services, on the plugin runtime. */
import type { CslItemData } from "@zotlit/db";

import { Cause, Effect, Exit, Stream } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import type { EffectivePresentation } from "@/services/pandoc/document-presentation";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import type {
  BibliographyRenderEvents,
  BibliographyRenderState,
  BibliographyRenderOutcome,
  BibliographyRenderResult,
  CitationRenderOutcome,
  ReadOptions,
  RenderPresentation,
} from "@/services/pandoc/render-cache";

export interface PlainBibliographyRender {
  readonly state: BibliographyRenderState;
  /**
   * The vault Citation Presentation each document inherits the halves it leaves
   * unsaid from — Style default for both until the first settings snapshot
   * names the selections. A surface composing one document's whole presentation
   * reads it from here, so it renders under what this cache renders under.
   */
  readonly vaultPresentation: EffectivePresentation;
  /**
   * The whole bibliography of `items`, formatted in the Citation and References Style.
   *
   * Entries come back in the style's own bibliography order, as typed AST. The
   * rendered value is deeply immutable and shared: every consumer of one render
   * gets the identical value, so a consumer holds it as long as it likes and
   * compares renders by reference.
   *
   * @param items the cited works as CSL-JSON, in the order they are cited.
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @returns the formatted bibliography, or the unavailable or failed state
   *   that tells the sidebar to show its plain list.
   */
  render(
    items: readonly CslItemData[],
    presentation?: RenderPresentation,
  ): Promise<BibliographyRenderOutcome>;
  /**
   * One document's in-text citations, formatted in the Citation and References Style,
   * each paired with the works it names.
   *
   * A style that numbers counts citations across the whole document, so the
   * unit rendered — and the unit cached — is every citation the document
   * writes, in document order. The rendered value is shared under the same
   * contract as {@link render}.
   *
   * @param citations each citation as the source writes it, in document order.
   * @param items the works those citations name, each `id` the key the source
   *   names that work by.
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @returns one held formatted-citation result, or the unavailable reason.
   */
  renderCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
    presentation?: RenderPresentation,
  ): Promise<CitationRenderOutcome>;
  /**
   * The bibliography of `items` once the render behind it stands, for a caller
   * that shows no stale list of its own — the citation text service numbers its
   * cited entries off the very list the References Sidebar shows.
   *
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @param signal ends the wait; the shared render runs on for every other
   *   caller that joined it.
   * @returns the settled render, or null where the engine or style is unavailable.
   * @throws the render failure, including while its retry cooldown is active.
   */
  readBibliography(
    items: readonly CslItemData[],
    options?: ReadOptions,
  ): Promise<BibliographyRenderResult | null>;
  /**
   * One document's in-text citations once the render behind them stands, for a
   * caller that shows no stale text of its own — the citation text service
   * holds the formatted text every surface of that document reads.
   *
   * @param presentation the style and Citation Locale to render under; the
   *   vault selection where it names none.
   * @param signal ends the wait; the shared render runs on for every other
   *   caller that joined it.
   * @returns the settled render, or null where the engine or style is unavailable.
   * @throws the render failure, including while its retry cooldown is active.
   */
  readCitations(
    citations: readonly string[],
    items: readonly CslItemData[],
    options?: ReadOptions,
  ): Promise<readonly RenderedCitation[] | null>;
  subscribe(callback: (state: BibliographyRenderState) => void): () => void;
  on<K extends keyof BibliographyRenderEvents>(
    event: K,
    callback: BibliographyRenderEvents[K],
  ): () => void;
  /** Subscribe to the first unavailable selected style, including one already found. */
  onStyleMissing(callback: (styleId: string) => void): () => void;
}

export function plainBibliographyRender(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<BibliographyRender, never>,
    "runSync" | "runPromiseExit" | "runFork" | "scope"
  >,
): PlainBibliographyRender {
  const service = runtime.runSync(BibliographyRender);
  const context = runtime.runSync(Effect.context<never>());
  const runSync = Effect.runSyncWith(context);
  const runReleased = Effect.runPromiseExitWith(context);
  const releasedRender = () =>
    ({ kind: "unavailable", reason: "failed" }) as const;
  const releasedRead = (): never => {
    throw new DOMException("Held read released", "AbortError");
  };
  const run = async <A>(
    effect: Effect.Effect<A, unknown>,
    released: () => A,
  ): Promise<A> => {
    // Retain the legacy read surface after release, including unavailable
    // engine/style outcomes. A disposed ManagedRuntime cannot run it itself.
    const exit = await (runtime.scope.state._tag === "Closed"
      ? runReleased(effect)
      : runtime.runPromiseExit(effect));
    if (Exit.isSuccess(exit)) return exit.value;
    if (Cause.hasInterruptsOnly(exit.cause)) return released();
    throw Cause.squash(exit.cause);
  };
  const missing = (replay: boolean, callback: (styleId: string) => void) => {
    const seen = runSync(service.state);
    return subscribe(
      runtime,
      service.changes.pipe(
        Stream.dropWhile(
          (next) => !replay && next.missingStyle === seen.missingStyle,
        ),
        Stream.map((next) => next.missingStyle),
        Stream.changes,
        Stream.filter((style): style is string => style !== null),
      ),
      callback,
    );
  };
  return {
    get state() {
      return runSync(service.state);
    },
    get vaultPresentation() {
      return runSync(service.state).vaultPresentation;
    },
    render: (...args) => run(service.render(...args), releasedRender),
    renderCitations: (...args) =>
      run(service.renderCitations(...args), releasedRender),
    readBibliography: (...args) =>
      run(service.readBibliography(...args), releasedRead),
    readCitations: (...args) =>
      run(service.readCitations(...args), releasedRead),
    subscribe: (callback) => subscribe(runtime, service.changes, callback),
    onStyleMissing: (callback) => missing(true, callback),
    on: (event, callback) => {
      if (event === "style-missing")
        return missing(
          false,
          callback as BibliographyRenderEvents["style-missing"],
        );
      return subscribe(runtime, service.events, (next) => {
        if (next._tag !== event) return;
        switch (next._tag) {
          case "changed":
            (callback as BibliographyRenderEvents["changed"])(next.key);
            break;
          case "settled":
            (callback as BibliographyRenderEvents["settled"])(
              next.key,
              next.held,
            );
            break;
          case "invalidated":
            (callback as BibliographyRenderEvents["invalidated"])();
            break;
        }
      });
    },
  };
}
