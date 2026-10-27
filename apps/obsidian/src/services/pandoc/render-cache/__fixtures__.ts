import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
/** The real bibliography layer over the dependency ports used by consumer fixtures. */
import { Context, Effect, Layer, PubSub, Stream } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { AbortError } from "@/lib/abort-error";
import { buildRuntime } from "@/lib/effect-layer";
import type { ManagedBinaryHandle } from "@/services/managed-binary/handle";
import type { CitationEngine } from "@/services/pandoc/engine";
import {
  BibliographyRenderError,
  layerBibliographyRender,
} from "@/services/pandoc/render-cache";
import { PandocEngine } from "@/services/pandoc/service";
import type { PlainProfile } from "@/services/profile/plain";
import { Profile } from "@/services/profile/service";
import type { PlainQueryClients } from "@/services/query-client/plain";
import {
  QueryClients,
  layerQueryClients,
} from "@/services/query-client/service";
import type { HeldReadChange } from "@/services/query-client/service";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { plainBibliographyRender } from "./plain";

/**
 * A render read's rejection as the real member fails: an abort and a
 * {@link BibliographyRenderError} keep their identity, and any other rejection
 * is the engine's, wrapped with its own message.
 */
export function renderFailure(
  error: unknown,
): BibliographyRenderError | DOMException {
  if (error instanceof BibliographyRenderError || AbortError.test(error))
    return error;
  return new BibliographyRenderError({
    message: Error.isError(error) ? error.message : String(error),
    cause: error,
  });
}

export interface BibliographyRenderFixtureOptions {
  profile: Pick<PlainProfile, "changed">;
  db: Pick<
    PlainZoteroReads,
    | "changed"
    | "degraded"
    | "refresh-failed"
    | "refreshing"
    | "db-file-missing"
    | "refresh-requested"
  >;
  pandocEngine: Pick<ManagedBinaryHandle<CitationEngine>, "binary">;
  zoteroPref: {
    readonly dataDir: string;
    /** Each move of the profile or data folder Zotero reads from. */
    readonly moves: Stream.Stream<void>;
  };
  settings: Pick<PluginSettings["Service"], "current" | "changes">;
  queryClient?: Pick<
    PlainQueryClients,
    "ask" | "readFresh" | "peek" | "invalidate" | "watch"
  >;
}

export async function bibliographyRenderFixture(
  options: BibliographyRenderFixtureOptions,
  context: Context.Context<never> = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const callbacks = <A>(
    register: (callback: (value: A) => void) => () => void,
  ): Stream.Stream<A> => {
    const bus = Effect.runSync(PubSub.unbounded<A>());
    stack.defer(register((value) => PubSub.publishUnsafe(bus, value)));
    stack.defer(() => Effect.runSync(PubSub.shutdown(bus)));
    return Stream.fromPubSub(bus);
  };
  const profileState = {
    loaded: true,
    profiles: [],
    diagnostics: [],
    defaultDocumentPath: "",
    templateStatus: { state: "loaded", compileErrors: new Map() },
  } as const;
  const prefs = new Map();
  const prefSnapshot = () => ({
    prefs,
    dataDir: options.zoteroPref.dataDir,
    dataDirOverride: null,
    state: "ready" as const,
    resolvedProfileDir: null,
    profileDirOverride: null,
    databasePath: "",
    sourceId: null,
    baseAttachmentPath: null,
    httpPort: null,
  });
  const query = options.queryClient;
  const queryLayer = query
    ? Layer.succeed(
        QueryClients,
        stubService<QueryClients["Service"]>("QueryClients", {
          changes: callbacks<HeldReadChange>((emit) => {
            let changed = false;
            return query.watch([], {
              changed: () => {
                changed = true;
              },
              settled: (key, held) => {
                emit({ key, held, changed });
                changed = false;
              },
            });
          }),
          ask: (key, fn) => Effect.promise(() => query.ask(key, fn)),
          peek: (key) => Effect.sync(() => query.peek(key)),
          readFresh: (key, fn) =>
            Effect.tryPromise({
              try: (signal) => query.readFresh(key, fn, signal),
              catch: renderFailure,
            }),
          invalidate: (key) => Effect.sync(() => query.invalidate(key)),
        }),
      )
    : layerQueryClients;
  const layer = layerBibliographyRender.pipe(
    Layer.provide(
      Layer.mergeAll(
        queryLayer,
        NodeFileSystem.layer,
        Layer.succeed(
          Profile,
          stubService<Profile["Service"]>("Profile", {
            state: Effect.succeed(profileState),
            changes: options.profile.changed.pipe(
              Stream.map(() => ({ ...profileState })),
            ),
          }),
        ),
        Layer.succeed(
          ZoteroReads,
          stubService<ZoteroReads["Service"]>("ZoteroReads", {
            events: options.db.changed.pipe(
              Stream.map(() => ({ _tag: "changed" as const })),
            ),
          }),
        ),
        Layer.succeed(
          PandocEngine,
          stubService<PandocEngine["Service"]>("PandocEngine", {
            getStatus: options.pandocEngine.binary.getStatus,
            getEngine: options.pandocEngine.binary.getEngine,
            changes: options.pandocEngine.binary.changes,
          }),
        ),
        Layer.succeed(
          ZoteroPref,
          stubService<ZoteroPref["Service"]>("ZoteroPref", {
            current: Effect.sync(prefSnapshot),
            changes: options.zoteroPref.moves.pipe(
              Stream.map(() => ({ ...prefSnapshot(), prefs: new Map() })),
            ),
          }),
        ),
        Layer.succeed(
          PluginSettings,
          stubService<PluginSettings["Service"]>("PluginSettings", {
            current: options.settings.current,
            changes: options.settings.changes,
          }),
        ),
      ),
    ),
  );
  const runtime = buildRuntime(
    layer.pipe(Layer.provideMerge(Layer.succeedContext(context))),
    stack,
  );
  await runtime.context();
  const cache = plainBibliographyRender(runtime);
  const owned = stack.move();
  return Object.assign(cache, {
    runtime,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}
