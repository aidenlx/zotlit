import { requireLabel } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import { copyObjectKeys } from "./copy-key.js";
import { exploreInObsidian, readerTopLevelItem } from "./obsidian.js";

const logger = appLogger.getChild(["menus", "reader-annot"]);

type AnnotationEvent =
  _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">;

export async function registerReaderAnnotationMenu(
  pluginID: string,
): Promise<Disposable> {
  logger.debug("registering reader-annot menu", { pluginID });

  const exploreLabel = await requireLabel("zotlit-menu-reader-annot-explore");
  const copyLabel = await requireLabel("zotlit-menu-reader-annot-copy-key");

  const handler = ({ reader, params, append }: AnnotationEvent): void => {
    append({
      label: exploreLabel,
      onCommand: () => {
        const item = readerTopLevelItem(reader);
        if (item === null) return;
        exploreInObsidian(item, params.currentID);
      },
    });
    append({
      label: copyLabel,
      onCommand: () => {
        const item = readerTopLevelItem(reader);
        if (item === null) return;
        copyObjectKeys([{ key: params.currentID, libraryID: item.libraryID }]);
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
