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
      diagnostic: {
        code: "literature-note-exists" | "duplicate-literature-notes";
        hint: string;
        indexedKey: string;
        paths: string[];
      };
    };
