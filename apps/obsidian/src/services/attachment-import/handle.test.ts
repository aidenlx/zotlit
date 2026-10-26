// The Attachment Import edge handle: each member is one bridge call.
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { expect } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { stubService } from "@/lib/__fixtures__/service-stub";

import { bindAttachmentImport } from "./handle";
import type {
  AttachmentImport,
  AttachmentImportBatch,
  AttachmentImportResult,
  AttachmentSkipSummary,
} from "./service";

const RESULT: AttachmentImportResult = {
  copied: 1,
  skipped: 0,
  missing: 0,
  blocked: 0,
  refused: 0,
};

const SUMMARY: AttachmentSkipSummary = {
  blocked: 1,
  refused: 0,
  blockedFolders: ["/outside"],
};

/** A service whose members count the batch calls. */
function fakeService() {
  const calls = { flush: 0, discard: 0, prepared: [] as string[] };
  const batch: AttachmentImportBatch = {
    decide: (path, origin) => ({
      approved: false,
      path,
      origin,
      reason: "no-trusted-root",
    }),
    resolveLink: (opts) => () => `[[${opts.vaultName}]]`,
    flush: Effect.sync(() => {
      calls.flush++;
      return RESULT;
    }),
    discard: Effect.sync(() => {
      calls.discard++;
    }),
  };
  const service = stubService<AttachmentImport["Service"]>("AttachmentImport", {
    skipped: Stream.make(SUMMARY),
    prepare: (notePath) =>
      Effect.sync(() => {
        calls.prepared.push(notePath);
        return batch;
      }),
  });
  return { service, calls };
}

it.effect("resolves each member with the service's answer", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const { service, calls } = fakeService();
    const handle = bindAttachmentImport(bridge, service);

    const summaries: AttachmentSkipSummary[] = [];
    const stop = handle.onSkipped((summary) => summaries.push(summary));
    await expect.poll(() => summaries).toEqual([SUMMARY]);
    stop();

    const batch = await handle.prepare("Notes/A.md");
    expect(calls.prepared).toEqual(["Notes/A.md"]);
    expect(batch.decide("/x.png", "linked-absolute")).toMatchObject({
      approved: false,
      path: "/x.png",
    });
    expect(
      batch.resolveLink({
        source: batch.decide("/x.png", "linked-absolute"),
        vaultName: "x.png",
      })(),
    ).toBe("[[x.png]]");
    await expect(batch.flush()).resolves.toEqual(RESULT);
    batch.discard();
    expect(calls).toMatchObject({ flush: 1, discard: 1 });
  }),
);

it.effect("after release, each member settles as the bridge does", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const { service, calls } = fakeService();
    const handle = bindAttachmentImport(bridge, service);
    const batch = await handle.prepare("Notes/A.md");
    await bridge[Symbol.asyncDispose]();

    // The bridge keeps its captured context, so the runs still answer.
    await expect(batch.flush()).resolves.toEqual(RESULT);
    batch.discard();
    expect(calls).toMatchObject({ flush: 1, discard: 1 });

    // A subscription opened after release receives nothing, and stops cleanly.
    const summaries: AttachmentSkipSummary[] = [];
    const stop = handle.onSkipped((summary) => summaries.push(summary));
    expect(stop).not.toThrow();
    expect(summaries).toEqual([]);
  }),
);
