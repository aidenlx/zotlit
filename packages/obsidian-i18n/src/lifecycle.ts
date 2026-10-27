// The vocabulary of the Language Pack Lifecycle: which locale a host language
// resolves to, where packs come from, and where a pack's install stands. The
// lifecycle itself (consent, device cache, download) belongs to the host.

export type RemoteLanguagePack = {
  fileName: string;
};

/** Where a namespace's Language Packs are downloaded from and attributed to. */
export type PackSource = {
  baseUrl: string;
  origin: string;
};

export type LocaleKeys<
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
  | { kind: "downloading"; pack: RemotePackInfo }
  | { kind: "restart-pending"; pack: RemotePackInfo }
  | { kind: "active"; pack: RemotePackInfo };

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
