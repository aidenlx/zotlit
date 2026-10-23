// The Attachment resolver for real, over an in-process Zotero database seeded
// with the rows a suite names. The resolver's own suite and the opener suites
// build on it, so a lookup answers as the real index answers it. The database
// read is the only seam: it can be held, failed, or left unopened.

import { vi } from "vitest";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { Effect, Stream } from "@/lib/effect";
import { queryClientsFixture } from "@/services/query-client/__fixtures__";
import type { ZoteroPrefEvents } from "@/services/zotero-pref/plain";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { AttachmentResolver } from "./service";

/** The Zotero data directory the seeded `storage:` rows resolve under. */
export const DATA_DIR = "/fixture/zotero-data";

/** Settles on the next `resolutions-changed`. */
export function nextAnnouncement(resolver: AttachmentResolver): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const off = resolver.on("resolutions-changed", () => {
    off();
    resolve();
  });
  return promise;
}

export interface ResolverHarnessOptions {
  platform?: NodeJS.Platform;
  baseAttachmentPath?: string | null;
  /** The rows each database open holds, in open order; `null` fails that open. */
  seeds?: (string | null)[];
  /** The rows of the one database open, when `seeds` is not given. */
  rows?: string;
  /** Build the first index before the test runs. @default true */
  prime?: boolean;
}

/** A real Attachment resolver over the seeded rows, disposed with `stack`. */
export async function resolverHarness(
  stack: AsyncDisposableStack,
  options: ResolverHarnessOptions,
) {
  const seeds = options.seeds ?? [options.rows ?? null];
  const { open } = memoryOpener((n) => seeds[n - 1] ?? null);
  let held: PromiseWithResolvers<void> | null = null;
  let waiting = false;
  let failing = false;
  let failures = 0;
  const reads = stack.use(
    inProcessReadsService(open, {
      wrap: (client) => ({
        ...client,
        AttachmentPathIndex: ((
          ...args: Parameters<typeof client.AttachmentPathIndex>
        ) =>
          Stream.unwrap(
            Effect.promise(async () => {
              if (held !== null) {
                waiting = true;
                await held.promise;
              }
              if (failing) {
                failures += 1;
                return Stream.fail(
                  new DbUnavailable({ message: "the read failed" }),
                ) as Stream.Stream<unknown, unknown>;
              }
              return client.AttachmentPathIndex(...args) as Stream.Stream<
                unknown,
                unknown
              >;
            }),
          )) as typeof client.AttachmentPathIndex,
      }),
    }),
  );
  // Settle the lazy adapter's first source event before testing index events.
  // A missing source is left unopened for the failure scenario.
  if (seeds[0] !== null) {
    const { reads: initial } = await reads.ready;
    await Effect.runPromise(initial.Libraries({}));
    await vi.waitFor(() => {
      if (reads.state !== "ready")
        throw new Error(`reads state is ${reads.state}, not ready`);
    });
  }
  let now = Temporal.Now.instant();
  const queries = stack.use(queryClientsFixture(() => now));

  const prefEvents = createNanoEvents<ZoteroPrefEvents>();
  const zoteroPref = {
    dataDir: DATA_DIR,
    baseAttachmentPath: options.baseAttachmentPath ?? null,
    on: <K extends keyof ZoteroPrefEvents>(event: K, cb: ZoteroPrefEvents[K]) =>
      prefEvents.on(event, cb),
  };

  const resolver = new AttachmentResolver({
    reads,
    queries,
    zoteroPref,
    platform: options.platform ?? "linux",
  });
  stack.use(resolver);
  await resolver.ready;
  if (options.prime ?? true) {
    const announced = nextAnnouncement(resolver);
    resolver.resolve("/");
    await announced;
  }
  return {
    resolver,
    reads,
    queries,
    zoteroPref,
    prefEvents,
    /** Makes every later path index read fail, until set back. */
    failReads: (on: boolean) => {
      failing = on;
    },
    /** How many path index reads failed. */
    get failures() {
      return failures;
    },
    /** Moves the failure cooldown clock forward from the real time. */
    advance: (seconds: number) => {
      now = now.add({ seconds });
    },
    /** Holds the next path index read until `release`. */
    gate: () => {
      held = Promise.withResolvers<void>();
      const gated = held;
      return {
        get waiting() {
          return waiting;
        },
        release: () => gated.resolve(),
      };
    },
  };
}
