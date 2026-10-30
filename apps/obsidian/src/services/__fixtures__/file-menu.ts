// Drive Obsidian's `file-menu` event through the real `registerFileMenu`.
import type {
  App,
  EventRef,
  Menu,
  MetadataCache,
  TAbstractFile,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { registerFileMenu } from "@/services/file-menu";
import type {
  FileMenuSegment,
  FolderMenuSegment,
} from "@/services/file-menu";

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
  folderSegments: readonly FolderMenuSegment[] = [],
): FileMenuHandler {
  let handler: FileMenuHandler | undefined;
  const app = stubService<App>("App", {
    workspace: Object.assign(stubService<Workspace>("Workspace", {}), {
      on: (name: string, callback: FileMenuHandler) => {
        if (name === "file-menu") handler = callback;
        return stubService<EventRef>("EventRef", {});
      },
    }),
    metadataCache: stubService<MetadataCache>("MetadataCache", {
      getFileCache: () => ({ frontmatter }),
    }),
  });
  registerFileMenu(
    {
      registerEvent: () => {},
      app,
    },
    segments,
    folderSegments,
  );
  if (!handler) throw new Error("file-menu handler was not registered");
  return handler;
}
