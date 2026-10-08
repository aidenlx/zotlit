// Drive Obsidian's `file-menu` event through the real `registerFileMenu`.
import type { Menu, TAbstractFile, WorkspaceLeaf } from "obsidian";

import { registerFileMenu } from "@/services/file-menu";
import type { FileMenuSegment } from "@/services/file-menu";

/** Obsidian's own `file-menu` listener shape. */
// oxlint-disable-next-line max-params -- Obsidian's own `file-menu` shape.
export type FileMenuHandler = (
  menu: Menu,
  file: TAbstractFile,
  source: string,
  leaf?: WorkspaceLeaf,
) => void;

/**
 * The `file-menu` listener `registerFileMenu` installs for `segments`, over a
 * vault where every file carries `frontmatter`.
 */
export function fileMenuHandler(
  segments: readonly FileMenuSegment[],
  frontmatter: Record<string, unknown> = {},
): FileMenuHandler {
  let handler: FileMenuHandler | undefined;
  registerFileMenu(
    {
      registerEvent: () => {},
      app: {
        workspace: {
          on: (name: string, cb: FileMenuHandler) => {
            if (name === "file-menu") handler = cb;
            return {};
          },
        },
        metadataCache: { getFileCache: () => ({ frontmatter }) },
      } as never,
    },
    segments,
  );
  if (!handler) throw new Error("file-menu handler was not registered");
  return handler;
}
