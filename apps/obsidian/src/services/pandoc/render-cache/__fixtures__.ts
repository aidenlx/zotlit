/** The real bibliography layer over the dependency ports used by consumer fixtures. */
import { Context, Effect, Layer, PubSub, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import type { PlainPandocEngine } from "@/services/pandoc/plain";
import { layerBibliographyRender } from "@/services/pandoc/render-cache";
import { PandocEngine } from "@/services/pandoc/service";
import type { PlainProfile } from "@/services/profile/plain";
import { Profile } from "@/services/profile/service";
import type { PlainQueryClients } from "@/services/query-client/plain";
import {
  QueryClients,
  layerQueryClients,
} from "@/services/query-client/service";
import type { HeldReadChange } from "@/services/query-client/service";
import type { PlainPluginSettings } from "@/services/settings/plain";
import { PluginSettings } from "@/services/settings/service";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { plainBibliographyRender } from "./plain";

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
  pandocEngine: Pick<PlainPandocEngine, "getStatus" | "changes" | "getEngine">;
  zoteroPref: Pick<
    PlainZoteroPref,
    "dataDir" | "changed" | "data-dir-changed" | "resolved-changed"
  >;
  settings: Pick<PlainPluginSettings, "current" | "changes">;
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
    ? Layer.succeed(QueryClients, {
        current: Effect.succeed(null),
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
        ask: (key, fn) =>
          Effect.tryPromise({
            try: () => query.ask(key, fn),
            catch: (error) => error,
          }),
        peek: (key) => Effect.sync(() => query.peek(key)),
        readFresh: (key, fn, signal) =>
          Effect.tryPromise({
            try: () => query.readFresh(key, fn, signal),
            catch: (error) => error,
          }),
        invalidate: (key) => Effect.sync(() => query.invalidate(key)),
      } as QueryClients["Service"])
    : layerQueryClients;
  const layer = layerBibliographyRender.pipe(
    Layer.provide(
      Layer.mergeAll(
        queryLayer,
        Layer.succeed(Profile, {
          state: Effect.succeed(profileState),
          changes: options.profile.changed.pipe(
            Stream.map(() => ({ ...profileState })),
          ),
        } as unknown as Profile["Service"]),
        Layer.succeed(ZoteroReads, {
          events: options.db.changed.pipe(
            Stream.map(() => ({ _tag: "changed" as const })),
          ),
        } as ZoteroReads["Service"]),
        Layer.succeed(PandocEngine, {
          getStatus: () => Effect.sync(() => options.pandocEngine.getStatus()),
          getEngine: () =>
            Effect.tryPromise({
              try: () => options.pandocEngine.getEngine(),
              catch: (error) => error as Error,
            }),
          changes: options.pandocEngine.changes,
        } as PandocEngine["Service"]),
        Layer.succeed(ZoteroPref, {
          current: Effect.sync(prefSnapshot),
          changes: options.zoteroPref["resolved-changed"].pipe(
            Stream.map(() => ({ ...prefSnapshot(), prefs: new Map() })),
          ),
        } as unknown as ZoteroPref["Service"]),
        Layer.succeed(PluginSettings, {
          current: Effect.sync(() => options.settings.current),
          changes: options.settings.changes,
        } as PluginSettings["Service"]),
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
