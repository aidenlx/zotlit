import type { Scope, MarkdownView } from "obsidian";

import type { E2eServices } from "@zotlit/obsidian/e2e";

import type { MutationState } from "@/services/annotation-repository/write";

export interface PairedWriteProbe {
  api: E2eServices["zoteroLocalApi"];
  authorizedSend: E2eServices["zoteroLocalApi"]["authorizedSend"];
  listAnnotations: E2eServices["zoteroLocalApi"]["listAnnotations"];
  calls: number;
  failRead?: boolean;
  reached?: boolean;
  release?: () => void;
  outcome?: { kind: MutationState["kind"] } | null;
  pending?: Promise<void>;
}

export type PairedScope = Scope & {
  handleKey(
    event: KeyboardEvent,
    context: { modifiers: string; key: string; vkey: string },
  ): boolean | undefined;
};

declare module "./page-helpers.ts" {
  interface PageScratch {
    __zlHeldAnnotationQuery?: {
      changed: boolean;
      heldReads: number;
      restore: (() => void) | null;
    };
    __ztQueryGate?: () => void;
    __ztQueryGateHits?: number;
    __ztInkNode?: Element;
    __ztTo?: [number, number];
    __zotlitWriteOutcomeProbe?: PairedWriteProbe;
    __zotlitReloadProbe?: {
      disabled: boolean;
      enabled: boolean;
      error: string | null;
    };
  }
}

export type PairedEditorContent = HTMLElement & {
  cmTile: { root: { view: MarkdownView["editor"]["cm"] } };
};
