export type LinkMarkdownView = import("obsidian").MarkdownView & {
  metadataEditor?: { containerEl: HTMLElement };
};
export type LinkGesture = "reading" | "properties" | "live-preview" | "source";
export interface LinkSettings {
  "reader.open-annotation-links"?: boolean;
  "citation.annotation-citations"?: boolean;
  "citation.render-annotation-citations"?: boolean;
  "citation.hover-action"?: "off" | "popover" | "page-preview";
}

export interface PassedLink {
  url: string;
  target: string | null;
}
export interface LinkRecorder {
  native: Window["open"];
  passed: PassedLink[];
  stopAnchor: (event: MouseEvent) => void;
}

declare module "./page-helpers.ts" {
  interface PageScratch {
    links?: LinkRecorder;
  }
}
