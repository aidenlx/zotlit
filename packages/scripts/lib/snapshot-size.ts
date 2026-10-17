// oxlint's jest/no-large-snapshots reads inline snapshots only, so the entries
// of a `.snap` file get this check. A whole-output snapshot pins structure,
// not behavior (policies/tautological-tests.md › Bulk output).
import { regex } from "arkregex";

/**
 * The most lines one `.snap` entry may hold. It admits the deliberate contract
 * snapshots (the docs package-swap tree is 551 lines) and rejects a catalog
 * dump.
 */
export const MAX_SNAPSHOT_LINES = 600;

const ENTRY_START = regex("^exports\\[`(?<name>.*)`\\] = `");

export interface LargeSnapshot {
  readonly name: string;
  readonly lines: number;
}

/**
 * The entries of a `.snap` file longer than `maxLines`, counted from the
 * `exports[...]` line through the closing `` `; `` line.
 */
export function largeSnapshots(
  text: string,
  maxLines = MAX_SNAPSHOT_LINES,
): LargeSnapshot[] {
  const large: LargeSnapshot[] = [];
  let open: { name: string; start: number } | undefined;
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const start = open ? null : ENTRY_START.exec(line);
    if (start) open = { name: start.groups.name, start: index };
    if (open && line.endsWith("`;") && (line === "`;" || start)) {
      const count = index - open.start + 1;
      if (count > maxLines) large.push({ name: open.name, lines: count });
      open = undefined;
    }
  }
  return large;
}

/** The message that names each large entry and the way on. */
export function largeSnapshotsMessage(
  files: readonly {
    readonly path: string;
    readonly large: readonly LargeSnapshot[];
  }[],
): string {
  return [
    `These snapshot entries exceed ${MAX_SNAPSHOT_LINES} lines:`,
    ...files.flatMap(({ path, large }) =>
      large.map(({ name, lines }) => `  ${path}: ${name} (${lines} lines)`),
    ),
    "Index the output and assert the keys the test owns instead of snapshotting it whole.",
  ].join("\n");
}
