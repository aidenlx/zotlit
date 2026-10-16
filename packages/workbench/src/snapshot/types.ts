// Public Item Snapshot contract shared by Node export and browser rendering.

import type { SnapshotLibrarySelector, SnapshotProvenance } from "./schema";

export type {
  ItemSnapshot,
  SnapshotLibrarySelector,
  SnapshotProvenance,
  SnapshotUnavailableValue,
} from "./schema";

export interface SnapshotSelection {
  readonly library: SnapshotLibrarySelector;
  readonly key: string;
}

export interface SnapshotVaultTargets {
  readonly notes?: Readonly<Record<string, string>>;
  readonly attachments?: Readonly<Record<string, string>>;
  readonly annotationImages?: Readonly<Record<string, string>>;
}

export interface ExportItemSnapshotOptions {
  readonly provenance: SnapshotProvenance;
  readonly vaultTargets?: SnapshotVaultTargets;
}

export class SnapshotSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotSelectionError";
  }
}
