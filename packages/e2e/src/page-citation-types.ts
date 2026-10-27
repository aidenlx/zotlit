import type { Profiler } from "node:inspector";
import type { Editor, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

import type { E2eServices } from "@zotlit/obsidian/e2e";

import type { AnnotationView } from "@/views/annot-view/view";
import type { ReferencesView } from "@/views/references/view";

export type FileScan = NonNullable<
  Awaited<ReturnType<E2eServices["citationIndex"]["getFileScan"]>>
>;

type WorkerAttached = { targetInfo: { title: string }; sessionId: string };
export type DebugListener = (
  event: unknown,
  method: string,
  params: WorkerAttached,
) => void;

/** Electron's debugger boundary; result overloads cover the protocols this case reads. */
export interface PageDebugger {
  isAttached(): boolean;
  attach(version: string): void;
  detach(): void;
  sendCommand(
    method: "Performance.getMetrics",
  ): Promise<{ metrics: { name: string; value: number }[] }>;
  sendCommand(method: "Profiler.stop"): Promise<{ profile: Profiler.Profile }>;
  sendCommand(
    method: string,
    parameters?: object,
    sessionId?: string,
  ): Promise<unknown>;
  on(event: "message", listener: DebugListener): void;
  removeListener(event: "message", listener: DebugListener): void;
}

export interface CitationScanScratch {
  cleanup: AsyncDisposableStack;
  annotations?: WorkspaceLeaf & { view: AnnotationView };
  file?: TFile;
  leaf?: WorkspaceLeaf & { view: MarkdownView };
  editor?: Editor;
  references?: WorkspaceLeaf & { view: ReferencesView };
  sessions: string[];
}

declare module "./page-helpers.ts" {
  interface PageScratch {
    citationScan?: CitationScanScratch;
  }
}
