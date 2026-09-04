import { FLUENT_FILE_NAME } from "@/constant";
import { logger as appLogger } from "@/lib/logger";
import type { FluentMessageId, FluentMessages } from "@/types/fluent";

const FTL_FILES = [FLUENT_FILE_NAME];

export const l10n = new Localization(FTL_FILES);

/** Distributes to `true` for each member of the ID union that takes no inputs, `never` otherwise. */
type InputFreeMembers<I extends FluentMessageId> = I extends FluentMessageId
  ? [FluentMessages[I]] extends [never]
    ? true
    : never
  : never;

/**
 * The argument list a message ID accepts: none for an input-free message,
 * its inputs otherwise. A union mixing both kinds makes the inputs optional.
 */
export type FluentMessageArgs<I extends FluentMessageId> = [
  FluentMessages[I],
] extends [never]
  ? []
  : [InputFreeMembers<I>] extends [never]
    ? [args: FluentMessages[I]]
    : [args?: FluentMessages[I]];

export function formatValue<I extends FluentMessageId>(
  id: I,
  ...[args]: FluentMessageArgs<I>
): Promise<string | null> {
  return l10n.formatValue(id, args as L10nArgs | undefined);
}

/**
 * The JSON string `setL10nArgs` takes for a menu entry's message, typed over
 * that message's inputs. Zotero assigns the value straight to
 * `dataset.l10nArgs`, so it has to arrive serialized.
 */
export function l10nArgs<I extends FluentMessageId>(
  id: I,
  args: FluentMessages[I],
): string {
  void id;
  return JSON.stringify(args);
}

const fluentLogger = appLogger.getChild("l10n");

/**
 * {@link formatValue} for a message the caller cannot render without. A missing
 * message means the FTL file and the code disagree, so it fails loudly instead
 * of rendering blank UI.
 */
export async function requireMessage<I extends FluentMessageId>(
  id: I,
  ...args: FluentMessageArgs<I>
): Promise<string> {
  const message = await formatValue(id, ...args);
  if (message === null) {
    fluentLogger.error("missing FTL message", { id });
    throw new Error(`missing FTL message: ${id}`);
  }
  return message;
}

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
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/plugins.js#L425-L507
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
