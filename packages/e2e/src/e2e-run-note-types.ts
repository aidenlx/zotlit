export interface ManagedFrontmatterReport {
  title?: unknown;
  kind?: unknown;
  spreadTitle?: unknown;
  spreadKind?: unknown;
  manual?: unknown;
  obsolete: boolean;
}

export type CreateOperationReply =
  | { outcome: "created"; path: string; indexedKey: string }
  | {
      outcome: "refused";
      diagnostic: import("../../../apps/obsidian/src/services/note-feature/types.ts").CreateNoteDiagnostic;
    };
