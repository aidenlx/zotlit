// Headless locale resolution, consent, device cache, and download for remote Language Packs.

import { languageEndonym } from "./endonyms.js";
// oxlint-disable-next-line import/consistent-type-specifier-style -- inline type imports emit a side-effect ./language-pack.mjs import under tsdown unbundle, dragging that chunk into the browser lifecycle bundle
import type { LanguagePack } from "./language-pack.js";
import { noopLogger, type StructuredLogger } from "./logger.js";
// oxlint-disable-next-line import/consistent-type-specifier-style -- inline type imports emit a side-effect ./runtime.mjs import under tsdown unbundle, dragging the Temporal polyfill into the browser lifecycle bundle
import type { LanguagePackRuntime } from "./runtime.js";
import { validateLanguagePack } from "./validation.js";

export type LanguagePackLifecyclePorts = {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, value: unknown): void;
  getLanguage(): string;
  requestUrl(request: {
    url: string;
  }): Promise<{ status: number; text: string }>;
};

export type RemoteLanguagePack = {
  fileName: string;
};

/** Where a namespace's Language Packs are downloaded from and attributed to. */
export type PackSource = {
  baseUrl: string;
  origin: string;
};

type LocaleKeys<
  BaseLocale extends string,
  Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>>,
> = BaseLocale | Extract<keyof Packs, string>;

export type LocaleCatalog<
  BaseLocale extends string = string,
  Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>> =
    Readonly<Partial<Record<string, RemoteLanguagePack>>>,
> = {
  baseLocale: BaseLocale;
  packs: Packs;
};

export type LanguagePackRestartNotice = {
  fileName: string;
};

export type RemotePackInfo = {
  fileName: string;
  origin: string;
};

/**
 * Where the Language Pack Lifecycle currently stands for the resolved locale.
 * Arms are mutually exclusive; a consumer renders one of them, never derives
 * its own combination of flags.
 */
export type LanguagePackSituation =
  | { kind: "unavailable" }
  | { kind: "offered"; pack: RemotePackInfo }
  | { kind: "installable"; pack: RemotePackInfo }
  | {
      kind: "downloading";
      pack: RemotePackInfo;
      done: Promise<LanguagePackRestartNotice>;
    }
  | { kind: "restart-pending"; pack: RemotePackInfo }
  | { kind: "active"; pack: RemotePackInfo };

export type LanguagePackLifecycle<Locale extends string = string> = {
  locale: Locale;
  /**
   * The resolved language's Endonym, for copy that names the Language Pack's
   * language. Falls back to {@link LanguagePackLifecycle.locale} for a language
   * outside Obsidian's display set.
   */
  endonym: string;
  getSituation(): LanguagePackSituation;
  subscribe(listener: () => void): () => void;
  /**
   * The one door onto a download: records accepted consent, downloads, and
   * caches. Concurrent calls while a download is in flight return the same
   * promise.
   *
   * @throws when no remote pack ships for the locale.
   */
  install(): Promise<LanguagePackRestartNotice>;
  /** Records declined consent, moving `offered` to `installable`. No-op without a remote pack. */
  decline(): void;
  /**
   * Drops every locale's device cache and consent record for this build, so the
   * next start offers a fresh install. A pack applied at startup keeps running
   * until the app restarts; an in-flight download is discarded rather than
   * cached.
   */
  reset(): void;
};

export type CreateLanguagePackLifecycleOptions<
  BaseLocale extends string,
  Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>>,
> = {
  runtime: LanguagePackRuntime;
  pluginVersion: string;
  namespace: string;
  catalog: LocaleCatalog<BaseLocale, Packs>;
  source: PackSource;
  aliases: Readonly<Record<string, NoInfer<LocaleKeys<BaseLocale, Packs>>>>;
  ports: LanguagePackLifecyclePorts;
  logger?: StructuredLogger;
};

const CONSENT_ACCEPTED = "accepted";
const CONSENT_DECLINED = "declined";

export function resolveLocale<
  const BaseLocale extends string,
  const Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>>,
>(
  language: string,
  catalog: LocaleCatalog<BaseLocale, Packs>,
  aliases: Readonly<Record<string, NoInfer<LocaleKeys<BaseLocale, Packs>>>>,
): LocaleKeys<BaseLocale, Packs> {
  if (
    language === catalog.baseLocale ||
    Object.hasOwn(catalog.packs, language)
  ) {
    return language as LocaleKeys<BaseLocale, Packs>;
  }
  return (aliases[language] ?? catalog.baseLocale) as LocaleKeys<
    BaseLocale,
    Packs
  >;
}

export function createLanguagePackLifecycle<
  const BaseLocale extends string,
  const Packs extends Readonly<Partial<Record<string, RemoteLanguagePack>>>,
>({
  runtime,
  pluginVersion,
  namespace,
  catalog,
  source,
  aliases,
  ports,
  logger = noopLogger,
}: CreateLanguagePackLifecycleOptions<
  BaseLocale,
  Packs
>): LanguagePackLifecycle<LocaleKeys<BaseLocale, Packs>> {
  runtime.reset();
  runtime.setLogger(logger);
  const language = ports.getLanguage();
  const locale = resolveLocale(language, catalog, aliases);
  // Applied before any situation is observable, so the consent copy a first-run
  // user reads is already in their language even with no pack installed.
  runtime.setTargetLocale(locale);
  const endonym = languageEndonym(language) ?? locale;
  const remote = catalog.packs[locale];
  logger.info(
    "Language Pack startup: Obsidian language {language} resolved to locale {locale}",
    { language, locale, endonym, pluginVersion, remote },
  );
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const packCacheKey = (packLocale: string): string =>
    `${namespace}:i18n:pack:${pluginVersion}:${packLocale}`;
  const consentStorageKey = (packLocale: string): string =>
    `${namespace}:i18n:consent:${packLocale}`;

  /**
   * Clears the device cache and consent of every locale the catalog ships,
   * not just the resolved one — a device that changed Obsidian language still
   * holds the packs it consented to before. Cache keys are version-scoped, so
   * this reaches the running build's packs; other releases' caches are already
   * unreachable.
   */
  const clearStoredPacks = (): void => {
    const locales = Object.keys(catalog.packs);
    for (const packLocale of locales) {
      ports.saveLocalStorage(packCacheKey(packLocale), null);
      ports.saveLocalStorage(consentStorageKey(packLocale), null);
    }
    logger.info(
      "Reset Language Packs: cleared the cache and consent of {locales}",
      { locales, pluginVersion },
    );
  };

  if (remote === undefined) {
    logger.info(
      "No Language Pack ships for locale {locale}; using the bundled base pack",
      { locale },
    );
    const situation: LanguagePackSituation = Object.freeze({
      kind: "unavailable",
    });
    return {
      locale,
      endonym,
      getSituation: () => situation,
      subscribe,
      install: () =>
        Promise.reject(
          new Error(`No Language Pack ships for locale ${locale}`),
        ),
      decline: () => {},
      // The bundled base pack is always live, so only other locales' leftovers
      // are there to clear.
      reset: clearStoredPacks,
    };
  }

  const pack: RemotePackInfo = {
    fileName: remote.fileName,
    origin: source.origin,
  };
  const url = `${source.baseUrl}/${remote.fileName}`;
  const cacheKey = packCacheKey(locale);
  const consentKey = consentStorageKey(locale);
  /** Bumped by {@link reset}, so a download started before it never persists. */
  let generation = 0;

  /** Storage for a remote-pack locale; {@link deriveSituation} projects it into the public union. */
  type RemotePackRecord = {
    state: "installed" | "cached" | "none";
    download?: Promise<LanguagePackRestartNotice>;
    offer: boolean;
  };
  const deriveSituation = (record: RemotePackRecord): LanguagePackSituation => {
    if (record.download !== undefined) {
      return { kind: "downloading", pack, done: record.download };
    }
    if (record.state === "cached") return { kind: "restart-pending", pack };
    if (record.state === "installed") return { kind: "active", pack };
    if (record.offer) return { kind: "offered", pack };
    return { kind: "installable", pack };
  };

  let record: RemotePackRecord = { state: "none", offer: false };
  let situation: LanguagePackSituation = Object.freeze(deriveSituation(record));
  const setRecord = (patch: Partial<RemotePackRecord>): void => {
    const previous = record;
    record = { ...previous, ...patch };
    situation = Object.freeze(deriveSituation(record));
    if (patch.state !== undefined && patch.state !== previous.state) {
      logger.debug("Language Pack state is now {state}", {
        state: patch.state,
        locale,
      });
    }
    for (const listener of listeners) listener();
  };

  const startDownload = (): Promise<LanguagePackRestartNotice> => {
    const started = generation;
    const isStale = (): boolean => started !== generation;
    const raw = downloadAndCacheLanguagePack({
      ports,
      fileName: remote.fileName,
      url,
      locale,
      cacheKey,
      logger,
      isStale,
    });
    const download = raw.then(
      (notice) => {
        if (!isStale()) setRecord({ state: "cached", download: undefined });
        return notice;
      },
      (error: unknown) => {
        if (!isStale()) setRecord({ download: undefined });
        throw error;
      },
    );
    // No-op side chain: keeps `download` from tripping unhandledrejection when
    // only the record holds a reference and no caller attaches its own handler.
    download.catch(() => {});
    return download;
  };

  const install = (): Promise<LanguagePackRestartNotice> => {
    if (record.download !== undefined) return record.download;
    try {
      logger.info("Recording Language Pack consent for {locale}", { locale });
      ports.saveLocalStorage(consentKey, CONSENT_ACCEPTED);
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const download = startDownload();
    setRecord({ download, offer: false });
    return download;
  };

  const decline = (): void => {
    logger.info("Language Pack install declined for {locale}", { locale });
    ports.saveLocalStorage(consentKey, CONSENT_DECLINED);
    setRecord({ offer: false });
  };

  const reset = (): void => {
    generation += 1;
    clearStoredPacks();
    // A pack downloaded this session was never applied, so clearing its cache
    // returns the lifecycle to "none"; one applied at startup stays "installed"
    // because it keeps running until the app restarts.
    setRecord({
      state: record.state === "cached" ? "none" : record.state,
      download: undefined,
    });
  };

  const lifecycle: LanguagePackLifecycle<LocaleKeys<BaseLocale, Packs>> = {
    locale,
    endonym,
    getSituation: () => situation,
    subscribe,
    install,
    decline,
    reset,
  };

  const cachedPack = readCachedPack({
    ports,
    cacheKey,
    locale,
    logger,
  });
  if (cachedPack !== undefined) {
    runtime.install(cachedPack);
    record = { state: "installed", offer: false };
    situation = Object.freeze(deriveSituation(record));
    logger.info("Applied the cached Language Pack {locale} from {cacheKey}", {
      locale,
      cacheKey,
    });
    return lifecycle;
  }

  const consent = ports.loadLocalStorage(consentKey);
  logger.debug(
    "No cached Language Pack under {cacheKey}; consent is {consent}",
    { cacheKey, consent },
  );
  if (consent === CONSENT_ACCEPTED) {
    logger.info(
      "Refreshing Language Pack {locale} in the background under existing consent",
      { locale, url },
    );
    const download = startDownload();
    record = { state: "none", download, offer: false };
    situation = Object.freeze(deriveSituation(record));
    return lifecycle;
  }
  if (consent === CONSENT_DECLINED) {
    logger.info(
      "Language Pack {locale} was declined; the settings item is the only entry point",
      { locale },
    );
    return lifecycle;
  }

  logger.info("Offering to install Language Pack {fileName} from {origin}", {
    locale,
    fileName: remote.fileName,
    origin: source.origin,
  });
  record = { state: "none", offer: true };
  situation = Object.freeze(deriveSituation(record));
  return lifecycle;
}

function readCachedPack({
  ports,
  cacheKey,
  locale,
  logger,
}: {
  ports: Pick<
    LanguagePackLifecyclePorts,
    "loadLocalStorage" | "saveLocalStorage"
  >;
  cacheKey: string;
  locale: string;
  logger: StructuredLogger;
}): LanguagePack | undefined {
  const cached = ports.loadLocalStorage(cacheKey);
  if (typeof cached !== "string") return undefined;
  try {
    return validateLanguagePack(cached, { expectedLocale: locale });
  } catch (error) {
    logger.warn(
      "Discarding the cached Language Pack under {cacheKey}: {error}",
      { cacheKey, locale, error },
    );
    return undefined;
  }
}

async function downloadAndCacheLanguagePack({
  ports,
  fileName,
  url,
  locale,
  cacheKey,
  logger,
  isStale,
}: {
  ports: LanguagePackLifecyclePorts;
  fileName: string;
  url: string;
  locale: string;
  cacheKey: string;
  logger: StructuredLogger;
  /** True once a reset has landed, so the response must not be cached. */
  isStale: () => boolean;
}): Promise<LanguagePackRestartNotice> {
  logger.info("Downloading Language Pack {locale} from {url}", {
    locale,
    url,
  });
  try {
    const response = await ports.requestUrl({ url });
    logger.debug("Language Pack download responded {status} ({length} chars)", {
      status: response.status,
      length: response.text.length,
      url,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${url} responded ${response.status}`);
    }
    const pack = validateLanguagePack(response.text, {
      expectedLocale: locale,
    });
    if (isStale()) {
      logger.info(
        "Discarding the downloaded Language Pack {locale}: it was reset mid-download",
        { locale, cacheKey },
      );
      return { fileName };
    }
    ports.saveLocalStorage(cacheKey, response.text);
    logger.info(
      "Cached Language Pack {locale} with {messageCount} messages under {cacheKey}",
      {
        locale,
        cacheKey,
        messageCount: Object.keys(pack.messages).length,
      },
    );
    return { fileName };
  } catch (error) {
    logger.error("Language Pack {locale} install failed: {error}", {
      locale,
      url,
      error,
    });
    throw error;
  }
}
