import { formatValue } from "@/lib/l10n.js";
import { logger as appLogger } from "@/lib/logger.js";

const logger = appLogger.getChild(["menus", "reader-annot"]);

type AnnotationEvent =
  _ZoteroTypes.Reader.EventParams<"createAnnotationContextMenu">;

interface Labels {
  merge: string;
  export: string;
}

async function loadLabels(): Promise<Labels> {
  const [merge, exportLabel] = await Promise.all([
    formatValue("zotlit-menu-reader-annot-merge"),
    formatValue("zotlit-menu-reader-annot-export"),
  ]);
  if (merge === null || exportLabel === null) {
    logger.error("missing FTL message for reader annotation menu", {
      merge,
      export: exportLabel,
    });
    throw new Error("missing FTL message for reader annotation menu");
  }
  logger.debug("loaded reader-annot labels", { merge, export: exportLabel });
  return { merge, export: exportLabel };
}

export async function registerReaderAnnotationMenu(
  pluginID: string,
): Promise<Disposable> {
  logger.debug("registering reader-annot menu", { pluginID });
  const labels = await loadLabels();
  const handler = ({ append }: AnnotationEvent): void => {
    append({
      label: labels.merge,
      onCommand: () => {
        logger.info("reader-annot menu invoked", { action: "merge" });
      },
    });
    append({
      label: labels.export,
      onCommand: () => {
        logger.info("reader-annot menu invoked", { action: "export" });
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
