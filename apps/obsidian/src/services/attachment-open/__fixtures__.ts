// The opener every ZotLit gesture opens through, over the real Attachment
// resolver and a seeded Zotero database. Obsidian's PDF view and the system
// handler are the host boundaries, so both are recorders.

import { Context, Effect, Layer } from "effect";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { ObsidianEnv } from "@/lib/obsidian-env";
import {
  DATA_DIR,
  openResolver,
} from "@/services/attachment-resolver/__fixtures__";
import type { ResolverHarnessOptions } from "@/services/attachment-resolver/__fixtures__";
import { AttachmentResolver } from "@/services/attachment-resolver/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";

import { layerTargetOpener, TargetOpener } from "./open-target";
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

export interface OpenerHarnessOptions extends Omit<
  ResolverHarnessOptions,
  "rows"
> {
  /** Files the reader finds missing at the open. */
  missing?: readonly string[];
  /** Files whose open the reader fails. */
  broken?: readonly string[];
  native?: NativeOpener;
  settings?: Settings;
}

/**
 * The opener over the real resolver of {@link OPENER_ROWS}, on a runtime that
 * also carries `context` — a test's `TestClock`, for one. The reader records
 * each open, finds no file at the paths in `missing` and fails at the paths
 * in `broken`; the system handler records each link unless `native` takes
 * it; the Notifier records each notice. `close` disposes it.
 */
export async function openOpener(
  {
    missing = [],
    broken = [],
    native,
    settings = defaults,
    ...options
  }: OpenerHarnessOptions = {},
  context: Context.Context<never> = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const opened: { attachment: ObsidianOpenableAttachment; pane: unknown }[] =
    [];
  const handed: string[] = [];
  const harness = await openResolver(
    { rows: OPENER_ROWS, ...options },
    context,
  );
  stack.defer(() => harness.close());
  const notifier = testNotifier();
  const runtime = buildRuntime(
    layerTargetOpener({
      reader: Effect.succeed({
        open: (attachment, pane): Promise<ReaderOutcome> => {
          if (broken.includes(attachment.absolutePath))
            return Promise.reject(new Error("the reader failed"));
          if (missing.includes(attachment.absolutePath))
            return Promise.resolve("file-missing");
          opened.push({ attachment, pane });
          return Promise.resolve("opened");
        },
      }),
      native: native ?? ((url) => void handed.push(url)),
      platform: "linux",
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AttachmentResolver, harness.service),
          Layer.mock(PluginSettings, { current: Effect.sync(() => settings) }),
          Layer.succeed(
            ObsidianEnv,
            stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
              basePath: VAULT,
            }),
          ),
          notifier.layer,
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const opener = runtime.runSync(TargetOpener);
  const owned = stack.move();
  return {
    ...harness,
    opener,
    /** Runs on the opener's runtime, which unload closes. */
    bridge: effectBridge(runtime),
    opened,
    handed,
    notices: notifier.notices,
    close: () => owned.disposeAsync(),
  };
}

/** {@link openOpener} on the test's own context, closed with its Scope. */
export const openerFixture = Effect.fnUntraced(function* (
  options: OpenerHarnessOptions = {},
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openOpener(options, context)),
    (harness) => Effect.promise(() => harness.close()),
  );
});

/** {@link openOpener} for a Promise suite, disposed with `stack`. */
export async function openerHarness(
  stack: AsyncDisposableStack,
  options: OpenerHarnessOptions = {},
) {
  const harness = await openOpener(options);
  stack.defer(() => harness.close());
  return harness;
}
