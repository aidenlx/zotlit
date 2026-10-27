export interface FrameRecord {
  frames: number;
  maxFrameGapMs: number;
  longTasks: number;
  longestTaskMs: number;
  live: boolean;
  observer: PerformanceObserver | null;
}

declare module "./page-helpers.ts" {
  interface PageScratch {
    pixels?: string[];
    pixelsOff?: () => void;
    frames?: FrameRecord;
    notices?: { observers: DisposableStack; values: Map<Element, string> };
  }
}

/** PDF.js host fields used by desktop gestures in addition to the plugin seam. */
export type PagePdfView = import("obsidian").PDFFileView & {
  viewer: {
    child: import("obsidian").PDFViewerController & {
      pdfViewer: {
        pdfViewer: {
          container: HTMLElement;
          currentPageNumber: number;
          pagesCount: number;
        };
      };
    };
  };
};

/** Electron BrowserWindow methods used to show a background vault. */
export interface BackgroundWindow {
  showInactive(): void;
  isMinimized(): boolean;
  blur(): void;
  getOpacity(): number;
  setOpacity(opacity: number): void;
  once(event: "restore", listener: () => void): void;
}
