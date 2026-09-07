// Public Item Snapshot contract shared by Node export and browser rendering.

import type { SnapshotRootDescriptors } from "./descriptors";

export type SnapshotLibrarySelector =
  | { readonly type: "personal" }
  | { readonly type: "group"; readonly groupID: number };

export interface SnapshotSelection {
  readonly library: SnapshotLibrarySelector;
  readonly key: string;
}

export type SnapshotProvenance =
  | {
      readonly kind: "sample";
      readonly id: string;
      readonly source?: string;
    }
  | {
      readonly kind: "connected";
      readonly installationId: string;
      readonly vault: string;
    };

export interface SnapshotVaultTargets {
  readonly notes?: Readonly<Record<string, string>>;
  readonly attachments?: Readonly<Record<string, string>>;
  readonly annotationImages?: Readonly<Record<string, string>>;
}

export interface ExportItemSnapshotOptions {
  readonly provenance: SnapshotProvenance;
  readonly vaultTargets?: SnapshotVaultTargets;
}

export interface SnapshotUnavailableValue {
  readonly path: string;
  readonly reason: string;
}

export interface ItemSnapshot {
  readonly contractVersion: number;
  readonly revision: string;
  readonly item: {
    readonly key: string;
    readonly indexedKey: string;
    readonly itemType: string;
    readonly title: string | null;
    readonly library: SnapshotLibrarySelector;
  };
  readonly provenance: SnapshotProvenance;
  readonly roots: {
    readonly note: Record<string, unknown>;
    readonly filename: Record<string, unknown>;
    readonly annotations: readonly Record<string, unknown>[];
  };
  readonly descriptors: {
    readonly note: SnapshotRootDescriptors;
    readonly filename: SnapshotRootDescriptors;
    readonly annotations: readonly SnapshotRootDescriptors[];
  };
  readonly unavailable: readonly SnapshotUnavailableValue[];
}

export class SnapshotSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotSelectionError";
  }
}
