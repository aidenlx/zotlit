import type { PDFFileView, PDFViewerHost, PDFViewerController } from "obsidian";
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
    __zotlitCapabilitySubjects?: string[];
    __zotlitCapabilityFor?: import("@zotlit/obsidian/e2e").E2eServices["annotationRepository"]["capabilityFor"];
    originalOpen?: Window["open"];
    workbenchLaunch?: string | URL;
    pixels?: string[];
    pixelsOff?: () => void;
    __zotlitInsertTrial?: InsertTrial;
    __zotlitDragTrial?: DragTrial;
    pageChanges?: number;
    frames?: FrameRecord;
    notices?: { observers: DisposableStack; values: Map<Element, string> };
  }
}

/** PDF.js host fields used by desktop gestures in addition to the plugin seam. */
export interface PagePdfView extends PDFFileView {
  viewer: PagePdfViewerHost;
}
interface PagePdfViewerHost extends PDFViewerHost {
  child: PagePdfController;
}
interface PagePdfController extends PDFViewerController {
  getPage(pageNumber: number):
    | (import("obsidian").PDFPageView & {
        reset(): void;
        draw(): Promise<void>;
      })
    | undefined;
  pdfViewer: NonNullable<
    import("obsidian").PDFViewerController["pdfViewer"]
  > & {
    pdfViewer: {
      container: HTMLElement;
      currentPageNumber: number;
      pagesCount: number;
    };
  };
}

/** Electron BrowserWindow methods used to show a background vault. */
export interface BackgroundWindow {
  showInactive(): void;
  isMinimized(): boolean;
  blur(): void;
  getOpacity(): number;
  setOpacity(opacity: number): void;
  once(event: "restore", listener: () => void): void;
}

export interface CodeMirrorElement extends HTMLElement {
  cmTile?: {
    root: {
      view: import("@codemirror/view").EditorView;
    };
  };
}

export type PreparationService = import("@/lib/effect").Context.Service.Shape<
  typeof import("../../../apps/obsidian/src/services/excerpt-image/prepare.ts").ExcerptPreparation
>;
export interface PreparationTrial {
  preparation: PreparationService;
  originalPreparation: PreparationService["forCard"];
  started: boolean;
  prepareCalls: number;
  finished: number;
  options: Parameters<PreparationService["forCard"]>[0] | null;
  gate: Promise<void>;
  release: () => void;
}

export type MarkdownLeaf = import("obsidian").WorkspaceLeaf & {
  view: import("obsidian").MarkdownView;
};
export type AnnotationLeaf = import("obsidian").WorkspaceLeaf & {
  view: import("../../../apps/obsidian/src/views/annot-view/view.tsx").AnnotationView;
};
export interface InsertTrial extends PreparationTrial {
  layout: ReturnType<import("obsidian").Workspace["getLayout"]>;
  services: import("@zotlit/obsidian/e2e").E2eServices;
  link: import("obsidian").FileManager["generateMarkdownLink"];
  importEnabled: boolean;
  file: import("obsidian").TFile;
  otherFile: import("obsidian").TFile;
  leaf: MarkdownLeaf;
  viewLeaf: AnnotationLeaf;
  view: AnnotationLeaf["view"];
  editor: import("obsidian").Editor;
  assets: number;
  other?: import("obsidian").WorkspaceLeaf;
}
export interface DragTrial extends Omit<
  InsertTrial,
  "otherFile" | "leaf" | "assets"
> {
  mainWin: Window;
  targetLeaf: MarkdownLeaf;
  button: HTMLElement;
  sourceWin: Window & typeof globalThis;
  targetWin: Window & typeof globalThis;
  transfer: DataTransfer;
  nativeTransfer: DataTransfer;
  assetsBeforeStart: number;
  assetsAfterStart: number;
  prepareCallsAfterStart: number;
  activeAtStart: boolean;
  nativeAssetsBefore: number;
  nativeCoords: { x: number; y: number };
  nativePosition: number | null;
  posAtCoords: import("obsidian").Editor["cm"]["posAtCoords"];
  coordinateCalls: {
    coords: { x: number; y: number };
    position: number | null;
  }[];
  expectedCoords: { x: number; y: number };
  directPosition: number | null;
  dropPrevented: boolean;
}

export type FileExplorerView = import("obsidian").View & {
  revealInFolder(file: import("obsidian").TFile): void;
  fileItems: Record<string, { selfEl: HTMLElement }>;
};
