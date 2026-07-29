import { requireLabel } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import { openInObsidian, readerTopLevelItem } from "./obsidian.js";

const logger = appLogger.getChild(["menus", "reader-page"]);

type ViewEvent = _ZoteroTypes.Reader.EventParams<"createViewContextMenu">;

export async function registerReaderPageMenu(
  pluginID: string,
): Promise<Disposable> {
  logger.debug("registering reader-page menu", { pluginID });
  const label = await requireLabel("zotlit-menu-reader-page-open");
  logger.debug("loaded reader-page label", { label });

  const handler = ({ reader, append }: ViewEvent): void => {
    append({
      label,
      onCommand: () => {
        const item = readerTopLevelItem(reader);
        if (item === null) return;
        openInObsidian("open", item);
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
