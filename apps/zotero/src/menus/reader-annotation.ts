import { formatValue } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import { exploreInObsidian, readerTopLevelItem } from "./obsidian.js";

const logger = appLogger.getChild(["menus", "reader-annot"]);

type AnnotationEvent =
  _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">;

export async function registerReaderAnnotationMenu(
  pluginID: string,
): Promise<Disposable> {
  logger.debug("registering reader-annot menu", { pluginID });

  const exploreLabel = await formatValue("zotlit-menu-reader-annot-explore");
  if (exploreLabel === null) {
    logger.error("missing FTL message for reader annotation explore menu");
    throw new Error("missing FTL message for reader annotation explore menu");
  }

  const handler = ({ reader, params, append }: AnnotationEvent): void => {
    append({
      label: exploreLabel,
      onCommand: () => {
        const item = readerTopLevelItem(reader);
        if (item === null) return;
        exploreInObsidian(item, params.currentID);
      },
    });
  };

  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    handler,
    pluginID,
  );
  logger.debug("registered reader-annot menu");
  return {
    [Symbol.dispose]() {
      logger.debug("unregistering reader-annot menu");
      Zotero.Reader.unregisterEventListener(
        "createAnnotationContextMenu",
        handler,
      );
    },
  };
}
