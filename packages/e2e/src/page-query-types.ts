import type { MarkdownView, WorkspaceLeaf, Modal } from "obsidian";

import type { E2eServices } from "@zotlit/obsidian/e2e";

export type CodeMirrorContent = HTMLElement & {
  cmTile: { root: { view: MarkdownView["editor"]["cm"] } };
};
export interface QueryWorkerRecord {
  spawned: { worker: Worker; name: string | undefined }[];
  Original: typeof Worker;
  terminate: Worker["terminate"];
  ended: WeakSet<Worker>;
  held?: {
    worker: Worker;
    post: Worker["postMessage"];
    pending: [unknown, StructuredSerializeOptions?][];
  };
  heldSnapshot?: boolean;
}
export interface QuerySidebarWatch {
  before: number;
  least: number;
  observer: MutationObserver;
  cleanup: AsyncDisposableStack;
}
declare module "./page-helpers.ts" {
  interface PageScratch {
    zotlitE2EWorkers?: QueryWorkerRecord;
    __zotlitQuerySource?: {
      lease: Awaited<ReturnType<E2eServices["zoteroReads"]["acquireRead"]>>;
      previous: E2eServices["zoteroPref"]["dataDirOverride"];
    };
    zotlitE2EChanged?: number;
    zotlitE2EOffChanged?: () => void;
    zotlitE2ESidebar?: QuerySidebarWatch;
    zotlitE2EClassifyRequests?: {
      requests: { count: number; snapshot: string }[];
      restore: () => void;
    };
    zotlitE2ESegmenterCache?: {
      name: string;
      bytes: Uint8Array<ArrayBuffer>;
    }[];
    zotlitE2EPlugin?: { _loaded: boolean };
    zotlitE2ELogStart?: number;
    zotlitE2EPanes?: { wide: WorkspaceLeaf; narrow: WorkspaceLeaf };
    zotlitE2EPastEdge?: WorkspaceLeaf;
    zotlitE2EHint?: WorkspaceLeaf;
    zotlitE2EBlockLeaf?: WorkspaceLeaf;
  }
}

export interface WorkerDebugger {
  isAttached(): boolean;
  attach(version: string): void;
  detach(): void;
  on(
    event: "message",
    listener: (
      event: Event,
      method: string,
      params: { targetInfo: { title: string }; sessionId: string },
    ) => void,
  ): void;
  removeListener(
    event: "message",
    listener: Parameters<WorkerDebugger["on"]>[1],
  ): void;
  sendCommand(
    method: string,
    params: object,
    session?: string,
  ): Promise<{ exceptionDetails?: object; result?: { value: number[] } }>;
}
export type WorkerTimerGlobal = typeof globalThis & {
  __zotlitTestTimer?: {
    gaps: number[];
    previous: number;
    id: ReturnType<typeof setInterval> | undefined;
  };
};
declare module "./page-helpers.ts" {
  interface PageScratch {
    __zotlitWorkerProbe?: {
      debuggerClient: WorkerDebugger;
      attached: boolean;
      listener: Parameters<WorkerDebugger["on"]>[1];
      session: string;
    };
  }
}

export interface QueryPrintModal extends Modal {
  print(
    el: HTMLElement,
    component: import("obsidian").Component,
    includeName: boolean,
  ): Promise<void>;
  printToPdf(options: {
    filepath: string;
    includeName: boolean;
    pageSize: string;
    landscape: boolean;
    marginsType: number;
    scaleFactor: number;
    scale: number;
    open: boolean;
  }): Promise<void>;
}
export interface PrintedQueryPage {
  ownWindow: boolean;
  views: {
    host: string;
    cards: (string | null)[];
    toolbar: boolean;
    readOnly: boolean;
    clipped: boolean;
    blank: boolean;
  }[];
}
