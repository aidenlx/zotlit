import {
  createContext,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { type AnnotItem } from "./store";

/**
 * App-facing actions the annotation tree fires. Stage 8 swaps {@link mockAnnotActions}
 * for real wiring (template render + drag-insert, img-cache, Zotero reader follow,
 * template-preview details); the leaf components stay decoupled behind this context.
 */
export interface AnnotActions {
  onShowDetails(type: "doc-item" | "annot", itemID: number): void;
  onMoreOptions(evt: MouseEvent | KeyboardEvent, annot: AnnotItem): void;
  onDragStart(evt: DragEvent<HTMLElement>, annot: AnnotItem): void;
  onRefresh(): void;
  onSetFollow(evt: MouseEvent | KeyboardEvent): void;
  getImgSrc(annot: AnnotItem): string;
  getBacklink(annot: AnnotItem): string | undefined;
}

const IMG_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="140">' +
    '<rect width="100%" height="100%" fill="rgba(128,128,128,0.18)"/>' +
    '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" ' +
    'fill="gray" font-family="sans-serif" font-size="14">Area excerpt (mock)</text>' +
    "</svg>",
)}`;

/** Console-logging stand-ins until Stage 8 wires the real plugin services. */
export const mockAnnotActions: AnnotActions = {
  onShowDetails: (type, itemID) =>
    console.log("[annot-view] onShowDetails", type, itemID),
  onMoreOptions: (_evt, annot) =>
    console.log("[annot-view] onMoreOptions", annot.key),
  onDragStart: (evt, annot) => {
    evt.dataTransfer.setData("text/plain", `[mock annotation ${annot.key}]`);
    evt.dataTransfer.dropEffect = "copy";
    console.log("[annot-view] onDragStart", annot.key);
  },
  onRefresh: () => console.log("[annot-view] onRefresh"),
  onSetFollow: () => console.log("[annot-view] onSetFollow"),
  getImgSrc: (annot) => {
    console.log("[annot-view] getImgSrc", annot.key);
    return IMG_PLACEHOLDER;
  },
  getBacklink: (annot) => {
    const page = annot.pageLabel ? `page=${annot.pageLabel}&` : "";
    return `zotero://open/library/items/${annot.parentKey}?${page}annotation=${annot.key}`;
  },
};

export const AnnotActionsContext =
  createContext<AnnotActions>(mockAnnotActions);
