// The release facts an install page's body reads.
//
// `<VersionLedger>` and `<XpiDownload>` are written into the MDX, far below the
// route that loads their data, so the snapshot travels as context rather than
// as props. A page that carries no snapshot — every docs page but the two
// install pages — leaves the value null, and both components render their
// documented degraded form. The provider refreshes the baked snapshot from
// `/api/release-snapshot`; the behaviour lives in
// `src/lib/use-baked-then-fresh.ts`.

import { createContext, use } from "react";
import type { ReactNode } from "react";

import type { ReleaseSnapshot } from "@/lib/release-data.ts";
import { useBakedThenFresh } from "@/lib/use-baked-then-fresh.ts";

const SnapshotContext = createContext<ReleaseSnapshot | null>(null);

export function ReleaseSnapshotProvider({
  snapshot,
  children,
}: {
  snapshot: ReleaseSnapshot | null;
  children: ReactNode;
}) {
  const value = useBakedThenFresh("/api/release-snapshot", snapshot);
  return <SnapshotContext value={value}>{children}</SnapshotContext>;
}

/** The page's release facts, or null when the page carries none. */
export function useReleaseSnapshot(): ReleaseSnapshot | null {
  return use(SnapshotContext);
}
