import { formatValue } from "@/lib/l10n.js";
import { logger as appLogger } from "@/lib/logger.js";

const logger = appLogger.getChild(["menus", "reader-page"]);

type ViewEvent = _ZoteroTypes.Reader.EventParams<"createViewContextMenu">;

export async function registerReaderPageMenu(
  pluginID: string,
): Promise<Disposable> {
  logger.debug("registering reader-page menu", { pluginID });
  const label = await formatValue("zotlit-menu-reader-page-open");
  if (label === null) {
    logger.error("missing FTL message for reader page menu");
    throw new Error("missing FTL message for reader page menu");
  }
  logger.debug("loaded reader-page label", { label });

  const handler = ({ append }: ViewEvent): void => {
    append({
      label,
      onCommand: () => {
        logger.info("reader-page menu invoked", { action: "open" });
      },
    });
  };

  Zotero.Reader.registerEventListener(
    "createViewContextMenu",
    handler,
    pluginID,
  );
  logger.debug("registered reader-page menu");
  return {
    [Symbol.dispose]() {
      logger.debug("unregistering reader-page menu");
      Zotero.Reader.unregisterEventListener("createViewContextMenu", handler);
    },
  };
}
