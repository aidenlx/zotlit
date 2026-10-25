// The Language Pack Lifecycle for ZotLit: locale resolution, consent, device
// cache, and download of the pack compiled from this release's Messages.
import {
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Exit } from "effect";
import { HttpClient, HttpClientError } from "effect/http";

import {
  LanguagePackSchemaVersionError,
  languageEndonym,
  resolveLocale,
  validateLanguagePack,
} from "@zotlit/obsidian-i18n";
import type {
  LanguagePackRestartNotice,
  LanguagePackSituation,
  LocaleKeys,
  PackSource,
  RemotePackInfo,
} from "@zotlit/obsidian-i18n";

import { RELEASE_ORIGIN, resourceReleaseUrl } from "@/lib/constants";
import { bridgeLog, withLogCategory } from "@/lib/effect-log";
import { catalog } from "@/lib/i18n/generated/catalog";
import { runtime } from "@/lib/i18n/generated/runtime";
import { ObsidianApp } from "@/lib/obsidian-app";
import { ObsidianEnv } from "@/lib/obsidian-env";

export type { LanguagePackRestartNotice, LanguagePackSituation };

/** A locale ZotLit's Messages compile to. */
export type Locale = LocaleKeys<
  typeof catalog.baseLocale,
  typeof catalog.packs
>;

const NAMESPACE = "zotlit";
const ALIASES = { zh: "zh-CN" } as const;
const CONSENT_ACCEPTED = "accepted";
const CONSENT_DECLINED = "declined";

const packCacheKey = (pluginVersion: string, locale: string): string =>
  `${NAMESPACE}:i18n:pack:${pluginVersion}:${locale}`;
const consentKey = (locale: string): string =>
  `${NAMESPACE}:i18n:consent:${locale}`;

/** No pack ships for the resolved locale, so there is nothing to install. */
export class NoLanguagePack extends Schema.TaggedError<
  NoLanguagePack,
  { readonly brand: unique symbol }
>()("NoLanguagePack", { message: Schema.String }) {}

/** The device storage under Obsidian's `loadLocalStorage` threw. */
export class LanguagePackStorageFailed extends Schema.TaggedError<
  LanguagePackStorageFailed,
  { readonly brand: unique symbol }
>()("LanguagePackStorageFailed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * The download failed: no connection, a status outside 2xx, or a body that is
 * not a valid pack for the locale.
 */
export class LanguagePackDownloadFailed extends Schema.TaggedError<
  LanguagePackDownloadFailed,
  { readonly brand: unique symbol }
>()("LanguagePackDownloadFailed", {
  message: Schema.String,
  /** The pack comes from a newer lineage than this build reads: update the plugin. */
  updateNeeded: Schema.Boolean,
  cause: Schema.optional(Schema.Defect()),
}) {}

export type LanguagePackInstallError =
  | NoLanguagePack
  | LanguagePackStorageFailed
  | LanguagePackDownloadFailed;

/** The Language Pack Lifecycle for the language Obsidian runs in. */
export class LanguagePack extends Context.Service<
  LanguagePack,
  {
    readonly locale: Locale;
    /**
     * The resolved language's Endonym, for copy that names the Language
     * Pack's language. Falls back to {@link locale} for a language outside
     * Obsidian's display set.
     */
    readonly endonym: string;
    readonly situation: Effect.Effect<LanguagePackSituation>;
    /** The current situation, then each one after it. */
    readonly changes: Stream.Stream<LanguagePackSituation>;
    /**
     * The one door onto a download: records accepted consent, downloads, and
     * caches. A call while a download is in flight joins it. A reset
     * interrupts the download, and so every install joined to it.
     */
    readonly install: Effect.Effect<
      LanguagePackRestartNotice,
      LanguagePackInstallError
    >;
    /** Records declined consent, moving `offered` to `installable`. Does nothing without a remote pack. */
    readonly decline: Effect.Effect<void, LanguagePackStorageFailed>;
    /**
     * Drops every locale's device cache and consent record for this build, so
     * the next start offers a fresh install. A pack applied at startup keeps
     * running until the app restarts; an in-flight download is interrupted
     * before it is cached.
     */
    readonly reset: Effect.Effect<void, LanguagePackStorageFailed>;
    /**
     * The outcome of the consented refresh that startup began, awaited
     * whenever it is read, also after the refresh ended. None when startup
     * began no refresh.
     */
    readonly refresh: Option.Option<
      Effect.Effect<
        Exit.Exit<LanguagePackRestartNotice, LanguagePackInstallError>
      >
    >;
  }
>()("zotlit/language-pack/LanguagePack") {}

/** What startup found on the device, before the plugin's services build. */
export interface LanguagePackStartup {
  readonly pluginVersion: string;
  readonly locale: Locale;
  readonly endonym: string;
  /** Absent when no pack ships for the locale. */
  readonly remote?: {
    readonly pack: RemotePackInfo;
    readonly url: string;
    /**
     * `installed`: the cached pack is running. `refresh`: consent stands but
     * this release's pack is not cached yet. `declined` and `offered` follow
     * the consent record.
     */
    readonly found: "installed" | "refresh" | "declined" | "offered";
  };
}

/**
 * ZotLit's release policy: Language Packs are assets of the Resource Release
 * pinned to the running plugin version, so a build downloads the pack compiled
 * from its own message set.
 *
 * @see docs/adr/0019-runtime-assets-ship-on-a-parallel-resource-release.md
 */
const packSource = (pluginVersion: string): PackSource =>
  typeof __LANGUAGE_PACK_DEV_SERVER__ === "string"
    ? {
        baseUrl: __LANGUAGE_PACK_DEV_SERVER__,
        origin: new URL(__LANGUAGE_PACK_DEV_SERVER__).host,
      }
    : {
        baseUrl: resourceReleaseUrl(pluginVersion),
        origin: RELEASE_ORIGIN,
      };

/** Obsidian's per-device storage, failing typed where it throws. */
const deviceStorage = (
  app: Pick<ObsidianApp["Service"], "loadLocalStorage" | "saveLocalStorage">,
) => ({
  load: (key: string) =>
    Effect.try({
      try: (): unknown => app.loadLocalStorage(key),
      catch: (cause) => storageFailed(cause),
    }),
  save: (key: string, value: unknown) =>
    Effect.try({
      try: () => app.saveLocalStorage(key, value),
      catch: (cause) => storageFailed(cause),
    }),
});

const storageFailed = (cause: unknown) =>
  new LanguagePackStorageFailed({
    message: Error.isError(cause) ? cause.message : String(cause),
    cause,
  });

/**
 * Point the message runtime at Obsidian's language and apply the pack cached
 * for it, before any copy shows. Runs ahead of the service graph, since the
 * plugin's first notices (an old installer, a service that failed to start)
 * already read `m.*`. A storage read that throws fails startup.
 */
export const startLanguagePack = Effect.fn("LanguagePack.start")(function* (
  pluginVersion: string,
) {
  const storage = deviceStorage(yield* ObsidianApp);
  const { language } = yield* ObsidianEnv;
  runtime.reset();
  // The message runtime is synchronous: its diagnostics log through this
  // context's loggers.
  runtime.setLogger(
    bridgeLog({ runSync: Effect.runSyncWith(yield* Effect.context()) }, "i18n"),
  );
  const locale = resolveLocale(language, catalog, ALIASES);
  // Applied before any situation is observable, so the consent copy a
  // first-run user reads is already in their language with no pack installed.
  runtime.setTargetLocale(locale);
  const endonym = languageEndonym(language) ?? locale;
  const remote: { fileName: string } | undefined =
    locale === catalog.baseLocale ? undefined : catalog.packs[locale];
  yield* Effect.logInfo(
    "Language Pack startup: Obsidian language resolved to a locale",
  ).pipe(
    Effect.annotateLogs({ language, locale, endonym, pluginVersion, remote }),
  );
  if (remote === undefined) {
    yield* Effect.logInfo(
      "No Language Pack ships for the locale; using the bundled base pack",
    ).pipe(Effect.annotateLogs({ locale }));
    return { pluginVersion, locale, endonym } satisfies LanguagePackStartup;
  }
  const source = packSource(pluginVersion);
  const pack: RemotePackInfo = {
    fileName: remote.fileName,
    origin: source.origin,
  };
  const url = `${source.baseUrl}/${remote.fileName}`;
  const started = (
    found: NonNullable<LanguagePackStartup["remote"]>["found"],
  ) =>
    ({
      pluginVersion,
      locale,
      endonym,
      remote: { pack, url, found },
    }) satisfies LanguagePackStartup;

  const cacheKey = packCacheKey(pluginVersion, locale);
  const cached = yield* storage.load(cacheKey);
  if (typeof cached === "string") {
    const applied = yield* Effect.try(() =>
      validateLanguagePack(cached, { expectedLocale: locale }),
    ).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Discarding the cached Language Pack").pipe(
          Effect.annotateLogs({ cacheKey, locale, error }),
        ),
      ),
      Effect.option,
    );
    if (Option.isSome(applied)) {
      runtime.install(applied.value);
      yield* Effect.logInfo("Applied the cached Language Pack").pipe(
        Effect.annotateLogs({ locale, cacheKey }),
      );
      return started("installed");
    }
  }

  const consent = yield* storage.load(consentKey(locale));
  yield* Effect.logDebug("No cached Language Pack; read the consent").pipe(
    Effect.annotateLogs({ cacheKey, consent }),
  );
  if (consent === CONSENT_ACCEPTED) {
    yield* Effect.logInfo(
      "Refreshing the Language Pack in the background under existing consent",
    ).pipe(Effect.annotateLogs({ locale, url }));
    return started("refresh");
  }
  if (consent === CONSENT_DECLINED) {
    yield* Effect.logInfo(
      "The Language Pack was declined; the settings item is the only entry point",
    ).pipe(Effect.annotateLogs({ locale }));
    return started("declined");
  }
  yield* Effect.logInfo("Offering to install the Language Pack").pipe(
    Effect.annotateLogs({ locale, fileName: pack.fileName, url }),
  );
  return started("offered");
}, withLogCategory("i18n"));

/** Storage behind a remote pack; {@link situationOf} projects it into the public union. */
interface PackRecord {
  readonly state: "installed" | "cached" | "none";
  readonly downloading: boolean;
  readonly offer: boolean;
}

const situationOf =
  (pack: RemotePackInfo) =>
  (record: PackRecord): LanguagePackSituation => {
    if (record.downloading) return { kind: "downloading", pack };
    if (record.state === "cached") return { kind: "restart-pending", pack };
    if (record.state === "installed") return { kind: "active", pack };
    if (record.offer) return { kind: "offered", pack };
    return { kind: "installable", pack };
  };

const UNAVAILABLE: LanguagePackSituation = { kind: "unavailable" };

/**
 * The lifecycle from where {@link startLanguagePack} left it: a consented
 * refresh downloads in the background on the layer's Scope, which interrupts
 * a download still running at unload.
 */
export function layerLanguagePack(
  startup: LanguagePackStartup,
): Layer.Layer<LanguagePack, never, ObsidianApp | HttpClient.HttpClient> {
  return Layer.effect(
    LanguagePack,
    Effect.gen(function* () {
      const storage = deviceStorage(yield* ObsidianApp);
      const http = yield* HttpClient.HttpClient;
      const { pluginVersion, locale, endonym, remote } = startup;

      /**
       * Clears the device cache and consent of every locale the catalog
       * ships, not just the resolved one: a device that changed Obsidian
       * language still holds the packs it consented to before. Cache keys
       * are version-scoped, so this reaches the running build's packs; other
       * releases' caches are already unreachable.
       */
      const clearStoredPacks = Effect.gen(function* () {
        const locales = Object.keys(catalog.packs);
        for (const packLocale of locales) {
          yield* storage.save(packCacheKey(pluginVersion, packLocale), null);
          yield* storage.save(consentKey(packLocale), null);
        }
        yield* Effect.logInfo(
          "Reset Language Packs: cleared the cache and consent of every locale",
        ).pipe(Effect.annotateLogs({ locales, pluginVersion }));
      });
      const asReset = <E>(effect: Effect.Effect<void, E>) =>
        effect.pipe(
          withLogCategory("i18n"),
          Effect.withSpan("LanguagePack.reset"),
        );

      if (remote === undefined) {
        const situation = yield* SubscriptionRef.make(UNAVAILABLE);
        yield* Effect.addFinalizer(() => PubSub.shutdown(situation.pubsub));
        return LanguagePack.of({
          locale,
          endonym,
          situation: SubscriptionRef.get(situation),
          changes: SubscriptionRef.changes(situation),
          install: Effect.fail(
            new NoLanguagePack({
              message: `No Language Pack ships for locale ${locale}`,
            }),
          ),
          decline: Effect.void,
          // The bundled base pack is always live, so only other locales'
          // leftovers are there to clear.
          reset: asReset(clearStoredPacks),
          refresh: Option.none(),
        });
      }

      const { pack, url, found } = remote;
      const cacheKey = packCacheKey(pluginVersion, locale);
      const record = yield* SubscriptionRef.make<PackRecord>({
        state: found === "installed" ? "installed" : "none",
        downloading: false,
        offer: found === "offered",
      });
      yield* Effect.addFinalizer(() => PubSub.shutdown(record.pubsub));
      const layerScope = yield* Scope.Scope;
      // One download at a time: starting, joining, and resetting take turns.
      const turn = yield* Semaphore.make(1);
      const inFlight = yield* Ref.make(
        Option.none<
          Fiber.Fiber<LanguagePackRestartNotice, LanguagePackInstallError>
        >(),
      );

      const downloadFailed = (error: unknown) =>
        error instanceof LanguagePackDownloadFailed ||
        error instanceof LanguagePackStorageFailed
          ? error
          : new LanguagePackDownloadFailed({
              message: Error.isError(error) ? error.message : String(error),
              updateNeeded:
                error instanceof LanguagePackSchemaVersionError &&
                error.updateNeeded,
              cause: error,
            });

      const fetchPack = http.get(url).pipe(
        Effect.mapError((error) =>
          // The transport's own error names the failure, as `requestUrl` did.
          downloadFailed(
            HttpClientError.isHttpClientError(error) &&
              Error.isError(error.reason.cause)
              ? error.reason.cause
              : error,
          ),
        ),
        Effect.flatMap((response) =>
          Effect.flatMap(
            Effect.mapError(response.text, (error) => downloadFailed(error)),
            (text) => {
              const { status } = response;
              return Effect.logDebug("Language Pack download responded").pipe(
                Effect.annotateLogs({ status, length: text.length, url }),
                Effect.andThen(
                  status < 200 || status >= 300
                    ? Effect.fail(
                        new LanguagePackDownloadFailed({
                          message: `${url} responded ${status}`,
                          updateNeeded: false,
                        }),
                      )
                    : Effect.succeed(text),
                ),
              );
            },
          ),
        ),
      );

      const download: Effect.Effect<
        LanguagePackRestartNotice,
        LanguagePackInstallError
      > = Effect.gen(function* () {
        yield* Effect.logInfo("Downloading the Language Pack").pipe(
          Effect.annotateLogs({ locale, url }),
        );
        const text = yield* fetchPack;
        const validated = yield* Effect.try({
          try: () => validateLanguagePack(text, { expectedLocale: locale }),
          catch: (error) => downloadFailed(error),
        });
        // A reset interrupts the download before this point or after it,
        // never between the write and the state it implies.
        yield* Effect.uninterruptible(
          storage.save(cacheKey, text).pipe(
            Effect.andThen(
              SubscriptionRef.update(record, (current) => ({
                ...current,
                state: "cached" as const,
                downloading: false,
              })),
            ),
          ),
        );
        yield* Effect.logInfo("Cached the Language Pack").pipe(
          Effect.annotateLogs({
            locale,
            cacheKey,
            messageCount: Object.keys(validated.messages).length,
          }),
        );
        return { fileName: pack.fileName };
      }).pipe(
        Effect.tapError((error) =>
          SubscriptionRef.update(record, (current) => ({
            ...current,
            downloading: false,
          })).pipe(
            Effect.andThen(
              Effect.logError("Language Pack install failed").pipe(
                Effect.annotateLogs({ locale, url, error }),
              ),
            ),
          ),
        ),
        Effect.onInterrupt(() =>
          Effect.logInfo(
            "Discarding the Language Pack download: it was reset mid-download",
          ).pipe(Effect.annotateLogs({ locale, cacheKey })),
        ),
        Effect.ensuring(Ref.set(inFlight, Option.none())),
        withLogCategory("i18n"),
      );

      /** The download in flight, started when there is none. */
      const startDownload = turn.withPermits(1)(
        Effect.gen(function* () {
          const running = yield* Ref.get(inFlight);
          if (Option.isSome(running)) return running.value;
          yield* SubscriptionRef.update(record, (current) => ({
            ...current,
            downloading: true,
            offer: false,
          }));
          const fiber = yield* Effect.forkIn(download, layerScope);
          yield* Ref.set(inFlight, Option.some(fiber));
          return fiber;
        }),
      );

      const refresh =
        found === "refresh"
          ? Option.some(Fiber.await(yield* startDownload))
          : Option.none();

      const install = Effect.gen(function* () {
        const running = yield* Ref.get(inFlight);
        if (Option.isNone(running)) {
          yield* Effect.logInfo("Recording Language Pack consent").pipe(
            Effect.annotateLogs({ locale }),
          );
          yield* storage.save(consentKey(locale), CONSENT_ACCEPTED);
        }
        return yield* Fiber.join(yield* startDownload);
      }).pipe(withLogCategory("i18n"), Effect.withSpan("LanguagePack.install"));

      const decline = Effect.gen(function* () {
        yield* Effect.logInfo("Language Pack install declined").pipe(
          Effect.annotateLogs({ locale }),
        );
        yield* storage.save(consentKey(locale), CONSENT_DECLINED);
        yield* SubscriptionRef.update(record, (current) => ({
          ...current,
          offer: false,
        }));
      }).pipe(withLogCategory("i18n"), Effect.withSpan("LanguagePack.decline"));

      const reset = asReset(
        turn.withPermits(1)(
          Effect.gen(function* () {
            const running = yield* Ref.get(inFlight);
            if (Option.isSome(running)) yield* Fiber.interrupt(running.value);
            yield* clearStoredPacks;
            // A pack downloaded this session was never applied, so clearing
            // its cache returns the lifecycle to "none"; one applied at
            // startup stays "installed" because it keeps running until the
            // app restarts.
            yield* SubscriptionRef.update(record, (current) => ({
              ...current,
              state: current.state === "cached" ? "none" : current.state,
              downloading: false,
            }));
          }),
        ),
      );

      const situation = situationOf(pack);
      return LanguagePack.of({
        locale,
        endonym,
        situation: Effect.map(SubscriptionRef.get(record), (current) =>
          situation(current),
        ),
        changes: Stream.map(SubscriptionRef.changes(record), (current) =>
          situation(current),
        ),
        install,
        decline,
        reset,
        refresh,
      });
    }),
  );
}
