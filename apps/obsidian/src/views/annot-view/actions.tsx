import { type App, Menu, Platform } from "obsidian";
import {
  createContext,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { annotationOpenUri, type AnnotViewItem } from "@zotlit/db";
import { resolveAnnotCachePath } from "@zotlit/db/path";

import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";

export interface AnnotActions {
  onMoreOptions(evt: MouseEvent | KeyboardEvent, annot: AnnotViewItem): void;
  onDragStart(evt: DragEvent<HTMLElement>, annot: AnnotViewItem): void;
  onRefresh(): void;
  getImgSrc(annot: AnnotViewItem): string;
  getBacklink(annot: AnnotViewItem): string | undefined;
}

export interface AnnotActionDeps {
  app: App;
  getGroupID: () => number | null;
  getDataDir: () => string;
  refresh: () => Promise<void>;
}

const IMG_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140">' +
    '<rect width="100%" height="100%" fill="rgba(128,128,128,0.18)"/>' +
    '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ' +
    'fill="gray" font-family="sans-serif" font-size="14">Image not cached</text>' +
    "</svg>",
)}`;

function resourceUrl(absolutePath: string): string {
  const encoded = encodeURI(absolutePath);
  return `${Platform.resourcePathPrefix}${encoded.replace(/^\//, "")}?${Date.now()}`;
}

export function createAnnotActions(deps: AnnotActionDeps): AnnotActions {
  const getBacklink = (annot: AnnotViewItem): string | undefined => {
    return annotationOpenUri({
      attachmentKey: annot.parentKey,
      annotationKey: annot.key,
      pageLabel: annot.pageLabel,
      groupID: deps.getGroupID(),
    });
  };

  const getImgSrc = (annot: AnnotViewItem): string => {
    const cachePath = resolveAnnotCachePath(annot, {
      dataDir: deps.getDataDir(),
      groupID: deps.getGroupID(),
    });
    return cachePath ? resourceUrl(cachePath) : IMG_PLACEHOLDER;
  };

  const buildMenu = (annot: AnnotViewItem): Menu => {
    const menu = new Menu();

    const backlink = getBacklink(annot);
    if (backlink) {
      menu.addItem((item) => {
        item
          .setTitle(m.annot_view_menu_copy_backlink())
          .setIcon("link")
          .onClick(() => {
            void toast.promise(navigator.clipboard.writeText(backlink), {
              success: m.annot_view_copied_backlink(),
              error: m.annot_view_copy_failed(),
            });
          });
      });
    }

    if (annot.text != null) {
      menu.addItem((item) => {
        item
          .setTitle(m.annot_view_menu_copy_text())
          .setIcon("copy")
          .onClick(() => {
            void toast.promise(navigator.clipboard.writeText(annot.text!), {
              success: m.annot_view_copied_text(),
              error: m.annot_view_copy_failed(),
            });
          });
      });
    }

    return menu;
  };

  return {
    getBacklink,
    getImgSrc,
    onMoreOptions(evt, annot) {
      const menu = buildMenu(annot);
      if ("nativeEvent" in evt) {
        menu.showAtMouseEvent(evt.nativeEvent as globalThis.MouseEvent);
      }
    },
    onDragStart(evt, annot) {
      const payload = annot.text ?? getBacklink(annot) ?? annot.key;
      evt.dataTransfer.setData("text/plain", payload);
      evt.dataTransfer.dropEffect = "copy";
    },
    onRefresh() {
      void toast.promise(deps.refresh(), {
        loading: m.annot_view_refreshing(),
        success: m.annot_view_refreshed(),
        error: m.annot_view_refresh_failed(),
      });
    },
  };
}

const NOOP_ACTIONS: AnnotActions = {
  onMoreOptions: () => {},
  onDragStart: () => {},
  onRefresh: () => {},
  getImgSrc: () => IMG_PLACEHOLDER,
  getBacklink: () => undefined,
};

export const AnnotActionsContext = createContext<AnnotActions>(NOOP_ACTIONS);
