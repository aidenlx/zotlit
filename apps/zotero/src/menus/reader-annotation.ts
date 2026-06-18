// import { formatValue } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

const logger = appLogger.getChild(["menus", "reader-annot"]);

type AnnotationEvent =
  _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">;

/**
 * Reader annotation context-menu scaffold. Registers no items today — the
 * "Merge Annotations" item is commented out below until annotation merging
 * returns. The listener stays wired so re-adding an item is a one-spot change.
 */
export async function registerReaderAnnotationMenu(
  pluginID: string,
): Promise<Disposable> {
  logger.debug("registering reader-annot menu", { pluginID });

  // Re-enable with annotation merging:
  // const merge = await formatValue("zotlit-menu-reader-annot-merge");
  // if (merge === null) {
  //   logger.error("missing FTL message for reader annotation menu");
  //   throw new Error("missing FTL message for reader annotation menu");
  // }

  const handler = (_event: AnnotationEvent): void => {
    // _event.append({
    //   label: merge,
    //   onCommand: () => {
    //     logger.info("reader-annot menu invoked", { action: "merge" });
    //   },
    // });
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
