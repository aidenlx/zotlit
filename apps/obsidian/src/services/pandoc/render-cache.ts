// The plugin-wide cache of whole-bibliography renders every consumer of rendered citation text reads.
import { hashKey } from "@tanstack/query-core";
import type { QueryFunction } from "@tanstack/query-core";
import {
  Cause,
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  PubSub,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import type { CslItemData } from "@zotlit/db";

import { scopedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { Profile } from "@/services/profile/service";
import { QueryClients } from "@/services/query-client/service";
import type { Held } from "@/services/query-client/service";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import {
  effectivePresentation,
  vaultPresentation,
} from "./document-presentation";
import type { EffectivePresentation } from "./document-presentation";
import type { BibliographyEntry, RenderedCitation } from "./engine";
import { PandocEngine } from "./service";
import { InstalledStyleCache, styleHasEntryMarkers } from "./styles";
import type { CslStyleRequest, ResolvedCslStyle } from "./styles";

const BIBLIOGRAPHY_RENDER = "bibliography-render";

/**
 * The style cache or the citation engine rejected. `message` is the
 * original's, which the held read and its notice show; `cause` holds it.
 */
export class BibliographyRenderError extends Schema.TaggedError<
  BibliographyRenderError,
  { readonly brand: unique symbol }
>()("BibliographyRenderError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const renderError = (cause: unknown) =>
  new BibliographyRenderError({
    message: Error.isError(cause) ? cause.message : String(cause),
    cause,
  });
const CITATION_RENDER = "citation-render";

export interface BibliographyRenderEvents {
  changed: (key: string) => void;
  settled: (key: string, held: Held<unknown> | null) => void;
  invalidated: () => void;
  "style-missing": (styleId: string) => void;
}
export type BibliographyRenderEvent =
  | { readonly _tag: "changed"; readonly key: string }
  | {
      readonly _tag: "settled";
      readonly key: string;
      readonly held: Held<unknown> | null;
    }
  | { readonly _tag: "invalidated" };
export interface BibliographyRenderState {
  readonly vaultPresentation: EffectivePresentation;
  /** The first unavailable selected style found in this plugin lifecycle. */
  readonly missingStyle: string | null;
}
/**
 * The Citation Presentation one render asks for. An omitted member inherits the
 * vault selection, which is what a caller that renders the vault default asks
 * for by passing nothing at all.
 */
export interface RenderPresentation {
  /**
   * Installed CSL ID to render with, or `null` for the engine's embedded
   * default style.
   */
  styleId?: string | null;
  /** Citation Locale to render in, overriding the style's own default locale. */
  locale?: string | null;
}

/** A completed bibliography and whether its style supplies Entry Markers. */
export interface BibliographyRenderResult {
  entries: readonly BibliographyEntry[];
  hasEntryMarkers: boolean;
}

export type RenderUnavailableReason =
  | "engine-absent"
  | "style-missing"
  | "failed";

export type HeldRenderOutcome<T> =
  | { kind: "unavailable"; reason: RenderUnavailableReason }
  | { kind: "held"; key: string; record: Held<T> };

/** What the References Sidebar needs to replace or preserve its current list. */
export type BibliographyRenderOutcome =
  HeldRenderOutcome<BibliographyRenderResult>;

export type CitationRenderOutcome = HeldRenderOutcome<
  readonly RenderedCitation[]
>;

/** A Resolved CSL Style a render can actually run with. */
type RenderStyle = Exclude<ResolvedCslStyle, { kind: "failed" }>;

export class BibliographyRender extends Context.Service<
  BibliographyRender,
  {
    readonly state: Effect.Effect<BibliographyRenderState>;
    readonly changes: Stream.Stream<BibliographyRenderState>;
    readonly events: Stream.Stream<BibliographyRenderEvent>;
    render(
      items: readonly CslItemData[],
      presentation?: RenderPresentation,
    ): Effect.Effect<BibliographyRenderOutcome, unknown>;
    renderCitations(
      citations: readonly string[],
      items: readonly CslItemData[],
      presentation?: RenderPresentation,
    ): Effect.Effect<CitationRenderOutcome, unknown>;
    readBibliography(
      items: readonly CslItemData[],
      options?: ReadOptions,
    ): Effect.Effect<BibliographyRenderResult | null, unknown>;
    readCitations(
      citations: readonly string[],
      items: readonly CslItemData[],
      options?: ReadOptions,
    ): Effect.Effect<readonly RenderedCitation[] | null, unknown>;
  }
>()("zotlit/pandoc/BibliographyRender") {}

export interface ReadOptions {
  presentation?: RenderPresentation;
}

/** Each bibliography render invalidation. */
export function renderInvalidated(
  render: Pick<BibliographyRender["Service"], "events">,
): Stream.Stream<void> {
  return render.events.pipe(
    Stream.filter((event) => event._tag === "invalidated"),
    Stream.map(() => undefined),
  );
}

/** The style IDs a render finds unavailable, each once until it clears. */
export function missingStyleChanges(
  changes: Stream.Stream<BibliographyRenderState>,
): Stream.Stream<string> {
  return changes.pipe(
    Stream.map((state) => state.missingStyle),
    Stream.changes,
    Stream.filter((style): style is string => style !== null),
  );
}

export const layerBibliographyRender = Layer.effect(
  BibliographyRender,
  Effect.gen(function* () {
    const reads = yield* ZoteroReads;
    const engine = yield* PandocEngine;
    const pref = yield* ZoteroPref;
    const settings = yield* PluginSettings;
    const profile = yield* Profile;
    const queries = yield* QueryClients;
    const scope = yield* Scope.Scope;
    const { runPromise } = yield* scopedBridge;
    const styles = new InstalledStyleCache();
    let closed = false;
    const state = yield* SubscriptionRef.make<BibliographyRenderState>({
      vaultPresentation: vaultPresentation(yield* settings.current),
      missingStyle: null,
    });
    const events = yield* Effect.acquireRelease(
      PubSub.unbounded<BibliographyRenderEvent>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const recover = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Could not update bibliography renders", cause),
        ),
      );
    const invalidate = Effect.fn("BibliographyRender.invalidate")(function* () {
      if (closed) return;
      yield* Effect.logDebug("Bibliography renders went stale");
      for (const prefix of [BIBLIOGRAPHY_RENDER, CITATION_RENDER])
        yield* queries.invalidate([prefix]);
      yield* PubSub.publish(events, { _tag: "invalidated" });
    });
    const listen = <A>(
      stream: Stream.Stream<A>,
      handle: (value: A) => Effect.Effect<unknown>,
    ) =>
      Stream.runForEach(stream, (value) => recover(handle(value))).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
    // Each state subscription skips its acquisition snapshot, just as on("changed") did.
    const initialProfile = yield* profile.state;
    yield* listen(
      Stream.dropWhile(profile.changes, (next) => next === initialProfile),
      () => invalidate(),
    );
    yield* listen(reads.events, (event) =>
      event._tag === "changed" ? invalidate() : Effect.void,
    );
    const initialEngine = yield* engine.getStatus;
    yield* listen(
      Stream.dropWhile(engine.changes, (next) => next === initialEngine),
      () => invalidate(),
    );
    let previousPref = yield* pref.current;
    yield* listen(
      pref.changes,
      Effect.fn("BibliographyRender.preferencesChanged")(function* (next) {
        const changed =
          next.prefs !== previousPref.prefs ||
          next.dataDirOverride !== previousPref.dataDirOverride;
        previousPref = next;
        if (changed) yield* invalidate();
      }),
    );
    yield* listen(
      settings.changes,
      Effect.fn("BibliographyRender.applySettings")(function* (saved) {
        const next = vaultPresentation(saved);
        const before = yield* SubscriptionRef.get(state);
        if (
          before.vaultPresentation.styleId === next.styleId &&
          before.vaultPresentation.locale === next.locale
        )
          return;
        yield* SubscriptionRef.set(state, {
          ...before,
          vaultPresentation: next,
        });
        yield* Effect.logInfo("Citation presentation settings changed").pipe(
          Effect.annotateLogs({ styleId: next.styleId, locale: next.locale }),
        );
        yield* invalidate();
      }),
    );
    yield* listen(
      queries.changes,
      Effect.fn("BibliographyRender.settled")(function* (change) {
        if (
          change.key[0] !== BIBLIOGRAPHY_RENDER &&
          change.key[0] !== CITATION_RENDER
        )
          return;
        const key = renderKeyOf(change.key);
        if (change.changed)
          yield* PubSub.publish(events, { _tag: "changed", key });
        yield* PubSub.publish(events, {
          _tag: "settled",
          key,
          held: change.held,
        });
      }),
    );
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        yield* PubSub.shutdown(state.pubsub);
      }),
    );
    yield* Effect.logInfo("Vault citation presentation selected").pipe(
      Effect.annotateLogs({
        ...(yield* SubscriptionRef.get(state)).vaultPresentation,
      }),
    );

    const prepare = Effect.fn("BibliographyRender.prepare")(
      function* (presentation: RenderPresentation | undefined) {
        if ((yield* engine.getStatus).kind !== "installed")
          return { reason: "engine-absent" } as const;
        const selected = (yield* SubscriptionRef.get(state)).vaultPresentation;
        const request = effectivePresentation(presentation ?? {}, selected);
        const dataDir = (yield* pref.current).dataDir;
        const style = yield* Effect.tryPromise({
          try: () => styles.resolve(dataDir, request),
          catch: renderError,
        });
        if (style.kind !== "failed") return { request, style };
        yield* Effect.logDebug(
          "Cannot resolve the requested citation style",
        ).pipe(
          Effect.annotateLogs({
            styleId: style.styleId,
            parentId: style.parentId,
            reason: style.reason,
          }),
        );
        yield* SubscriptionRef.updateSome(state, (before) =>
          !closed &&
          style.styleId === before.vaultPresentation.styleId &&
          before.missingStyle === null
            ? Option.some({ ...before, missingStyle: style.styleId })
            : Option.none(),
        );
        return { reason: "style-missing" } as const;
      },
      withLogCategory("pandoc", "render-cache"),
    );
    const runBibliography = Effect.fn("BibliographyRender.runBibliography")(
      function* (items: readonly CslItemData[], style: RenderStyle) {
        if (items.length === 0) return { entries: [], hasEntryMarkers: false };
        const presentation = enginePresentation(style);
        const active = yield* engine.getEngine;
        if (!active) return { entries: [], hasEntryMarkers: false };
        const entries = yield* Effect.tryPromise({
          try: () => active.renderBibliography({ items, ...presentation }),
          catch: renderError,
        });
        const hasEntryMarkers =
          styleHasEntryMarkers(presentation.styleXml) ||
          entries.some((entry) => entry.marker !== undefined);
        yield* Effect.logDebug("Bibliography rendered").pipe(
          Effect.annotateLogs({ count: entries.length, hasEntryMarkers }),
        );
        return { entries, hasEntryMarkers };
      },
      Effect.tapError((error) =>
        Effect.logWarning("Cannot format the bibliography").pipe(
          Effect.annotateLogs({ error }),
        ),
      ),
    );
    const runCitations = Effect.fn("BibliographyRender.runCitations")(
      function* (
        citations: readonly string[],
        items: readonly CslItemData[],
        style: RenderStyle,
      ) {
        if (citations.length === 0) return [];
        const active = yield* engine.getEngine;
        if (!active) return [];
        const rendered = yield* Effect.tryPromise({
          try: () =>
            active.renderCitations({
              citations,
              items,
              ...enginePresentation(style),
            }),
          catch: renderError,
        });
        yield* Effect.logDebug("Citations rendered").pipe(
          Effect.annotateLogs({ count: rendered.length }),
        );
        return rendered;
      },
      Effect.tapError((error) =>
        Effect.logWarning("Cannot format the citations").pipe(
          Effect.annotateLogs({ error }),
        ),
      ),
    );
    // Start the shared refresh before peeking. A stale value answers immediately;
    // the layer owns the refresh even when this caller stops waiting.
    const askThenPeek = Effect.fn("BibliographyRender.askThenPeek")(function* <
      T,
    >(key: readonly string[], render: QueryFunction<T>) {
      if (closed) return null;
      const asking = yield* Effect.forkIn(queries.ask(key, render), scope, {
        startImmediately: true,
      });
      const held = yield* queries.peek<T>(key);
      if (held !== null) return held;
      yield* Fiber.join(asking);
      return yield* queries.peek<T>(key);
    });
    return BibliographyRender.of({
      state: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      events: Stream.fromPubSub(events),
      render: Effect.fn("BibliographyRender.render")(
        function* (items, presentation) {
          const prepared = yield* prepare(presentation);
          if (prepared.reason !== undefined)
            return { kind: "unavailable", reason: prepared.reason };
          const key = renderKey({ ...prepared, items });
          const record = yield* askThenPeek(
            [BIBLIOGRAPHY_RENDER, key],
            ({ signal }) =>
              runPromise(runBibliography(items, prepared.style), { signal }),
          );
          return record === null
            ? { kind: "unavailable", reason: "failed" }
            : { kind: "held", key, record };
        },
      ),
      renderCitations: Effect.fn("BibliographyRender.renderCitations")(
        function* (citations, items, presentation) {
          const prepared = yield* prepare(presentation);
          if (prepared.reason !== undefined)
            return { kind: "unavailable", reason: prepared.reason };
          const key = renderKey({ ...prepared, items, citations });
          const record = yield* askThenPeek(
            [CITATION_RENDER, key],
            ({ signal }) =>
              runPromise(runCitations(citations, items, prepared.style), {
                signal,
              }),
          );
          return record === null
            ? { kind: "unavailable", reason: "failed" }
            : { kind: "held", key, record };
        },
      ),
      readBibliography: Effect.fn("BibliographyRender.readBibliography")(
        function* (items, { presentation } = {}) {
          const prepared = yield* prepare(presentation);
          if (prepared.reason !== undefined) return null;
          return yield* queries.readFresh(
            [BIBLIOGRAPHY_RENDER, renderKey({ ...prepared, items })],
            ({ signal }) =>
              runPromise(runBibliography(items, prepared.style), { signal }),
          );
        },
      ),
      readCitations: Effect.fn("BibliographyRender.readCitations")(function* (
        citations,
        items,
        { presentation } = {},
      ) {
        const prepared = yield* prepare(presentation);
        if (prepared.reason !== undefined) return null;
        return yield* queries.readFresh(
          [CITATION_RENDER, renderKey({ ...prepared, items, citations })],
          ({ signal }) =>
            runPromise(runCitations(citations, items, prepared.style), {
              signal,
            }),
        );
      }),
    });
  }).pipe(withLogCategory("pandoc", "render-cache")),
);

/**
 * What the engine formats one Resolved CSL Style with: an installed style hands
 * over its content, and the embedded default style takes the Citation Locale as
 * the locale to render in.
 */
function enginePresentation(style: RenderStyle): {
  styleXml?: string;
  locale?: string;
} {
  return style.kind === "installed"
    ? { styleXml: style.xml }
    : { locale: style.locale };
}

/**
 * Full style and item content separate a cancelled render's captured inputs
 * from updated data under the same IDs. Query Core's stable JSON serialization
 * ignores object property order while preserving item and citation order.
 */
function renderKey({
  request,
  style,
  items,
  citations = [],
}: {
  request: CslStyleRequest;
  style: RenderStyle;
  items: readonly CslItemData[];
  citations?: readonly string[];
}): string {
  return hashKey([
    request.styleId ?? "",
    style.kind === "installed" ? (style.parentId ?? "") : "",
    request.locale ?? "",
    style.kind === "installed" ? style.xml : "",
    items,
    citations,
  ]);
}

/** The {@link renderKey} a held render's query key carries. */
function renderKeyOf(key: readonly unknown[]): string {
  return String(key[1]);
}
