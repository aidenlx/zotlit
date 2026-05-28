import { FLUENT_FILE_NAME } from "@/constant";
import { logger as appLogger } from "@/lib/logger";
import { type FluentMessageId } from "@/types/fluent";

const FTL_FILES = [FLUENT_FILE_NAME];

export const l10n = new Localization(FTL_FILES);

export function formatValue(
  id: FluentMessageId,
  args?: L10nArgs,
): Promise<string | null> {
  return l10n.formatValue(id, args);
}

const fluentLogger = appLogger.getChild("l10n");

/**
 * Attach the plugin's FTL files to a chrome window's `document.l10n` so
 * `data-l10n-id` attributes set on DOM nodes inside that window (e.g. menu
 * items registered via {@link Zotero.MenuManager.registerMenu}) translate
 * against our messages.
 *
 * Plugin FTLs are already registered globally with `L10nRegistry` by
 * Zotero, but each window's `document.l10n` only consults FTL paths it
 * was given via `<link rel="localization"/>` or this helper.
 *
 * Idempotent — `insertFTLIfNeeded` is a no-op when the link already
 * exists.
 *
 * @see https://github.com/zotero/zotero/blob/3d2f51eeb4e26f0c7b40716d611a6a781e5c2c68/chrome/content/zotero/xpcom/plugins.js#L425-L507
 */
export function attachFluentToWindow(win: Window): void {
  for (const path of FTL_FILES) {
    win.MozXULElement.insertFTLIfNeeded(path);
  }
  fluentLogger.debug("attached fluent files to window", {
    paths: FTL_FILES,
    href: win.location.href,
  });
}

type MenuData<C> = _ZoteroTypes.MenuManager.MenuData<C>;
type ValidTarget = _ZoteroTypes.MenuManager.ValidTarget;
type ContextOf<T extends ValidTarget> =
  _ZoteroTypes.MenuManager.TargetToContextMap[T];

type TypedMenuData<C> = Omit<MenuData<C>, "l10nID" | "menus"> & {
  l10nID?: FluentMessageId;
  menus?: TypedMenuData<C>[];
};

export type TypedMenuOptions<T extends ValidTarget> = Omit<
  _ZoteroTypes.MenuManager.MenuOptions<T>,
  "menus"
> & {
  menus: TypedMenuData<ContextOf<T>>[];
};

export function registerMenu<T extends ValidTarget>(
  options: TypedMenuOptions<T>,
): string | false {
  return Zotero.MenuManager.registerMenu(
    options as _ZoteroTypes.MenuManager.MenuOptions<T>,
  );
}
