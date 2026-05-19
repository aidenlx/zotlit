import type { FluentMessageId } from "@/types/fluent.js";

const FTL_FILES = ["zotlit.ftl"];

export const l10n = new Localization(FTL_FILES);

export function formatValue(
  id: FluentMessageId,
  args?: L10nArgs,
): Promise<string | null> {
  return l10n.formatValue(id, args);
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
