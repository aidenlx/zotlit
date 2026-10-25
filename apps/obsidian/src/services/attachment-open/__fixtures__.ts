// The opener every ZotLit gesture opens through, over the real Attachment
// resolver and a seeded Zotero database. Obsidian's PDF view and the system
// handler are the host boundaries, so both are recorders.

import { Effect } from "effect";

import { testRuntime } from "@/lib/__fixtures__/runtime";
import { effectBridge } from "@/lib/effect-bridge";
import {
  DATA_DIR,
  resolverHarness,
} from "@/services/attachment-resolver/__fixtures__";
import type { ResolverHarnessOptions } from "@/services/attachment-resolver/__fixtures__";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { createTargetOpener } from "./open-target";
import type { NativeOpener, ReaderOutcome } from "./open-target";
import type { ObsidianOpenableAttachment } from "./resolve";

export const VAULT = "/fixture/vault";

/** Where the seeded Attachments keep their files. */
export const FILES = {
  /** The Fixture's Rougier PDF: a linked file inside the vault. */
  rougier: `${VAULT}/attachments/rougier-2014.pdf`,
  /** A Zotero-managed PDF outside the vault. */
  stored: `${DATA_DIR}/storage/PDFSTR22/sakimas song.pdf`,
  /** A group Library's Zotero-managed PDF. */
  grouped: `${DATA_DIR}/storage/RGRGRUP9/shared.pdf`,
} as const;

/**
 * The Attachments an opener meets: the Rougier PDF, and a second Attachment
 * of its file that its path does not choose (`RGRCPYB8`, the higher item ID);
 * a stored PDF; an EPUB Obsidian cannot host; a web link that keeps no file;
 * and a group Library's PDF.
 */
export const OPENER_ROWS = `
  insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
  insert into groups (groupID, libraryID, name)
    values (4200309, 2, 'Shared Reading');
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (20, 1, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'SAKIMA22'),
      (21, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'PDFSTR22'),
      (22, 2, '2025-02-20 12:00:00', '2025-02-20 12:00:00', 1, 'EPUBSTR2'),
      (24, 2, '2025-02-17 12:00:00', '2025-02-17 12:00:00', 1, 'LINKURL2'),
      (30, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RGRGRUP9'),
      (31, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 2, 'RUGIERG9'),
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (60, 2, '2025-02-05 12:00:00', '2025-02-05 12:00:00', 1, 'RGRCPYB8'),
      (61, 1, '2025-02-05 12:00:00', '2025-02-05 12:00:00', 1, 'RUGIERC8');
  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (21, 20, 0, 'application/pdf', 'storage:sakimas song.pdf'),
      (22, 20, 0, 'application/epub+zip', 'storage:sakimas-song.epub'),
      (24, 20, 3, 'text/html', null),
      (30, 31, 0, 'application/pdf', 'storage:shared.pdf'),
      (47, 46, 2, 'application/pdf', '${FILES.rougier}'),
      (60, 61, 2, 'application/pdf', '${FILES.rougier}');
`;

/**
 * The opener over the real resolver of {@link OPENER_ROWS}, a reader that
 * records each open and finds no file at the paths in `missing`, and a system
 * handler that records each link unless `native` takes it.
 */
export async function openerHarness(
  stack: AsyncDisposableStack,
  {
    missing = [],
    native,
    settings = defaults,
    ...options
  }: Omit<ResolverHarnessOptions, "rows"> & {
    missing?: readonly string[];
    native?: NativeOpener;
    settings?: Settings;
  } = {},
) {
  const opened: { attachment: ObsidianOpenableAttachment; pane: unknown }[] =
    [];
  const handed: string[] = [];
  const harness = await resolverHarness(stack, {
    rows: OPENER_ROWS,
    ...options,
  });
  const opener = createTargetOpener({
    attachments: harness.resolver,
    reader: {
      open: (attachment, pane): Promise<ReaderOutcome> => {
        if (missing.includes(attachment.absolutePath))
          return Promise.resolve("file-missing");
        opened.push({ attachment, pane });
        return Promise.resolve("opened");
      },
    },
    native: native ?? ((url) => void handed.push(url)),
    settings: { current: Effect.sync(() => settings) },
    bridge: effectBridge(testRuntime()),
    vaultBasePath: VAULT,
    platform: "linux",
  });
  return { ...harness, opener, opened, handed };
}
