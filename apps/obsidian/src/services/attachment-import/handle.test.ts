// The Attachment Import edge handle: each member is one bridge call.
import { it } from "@effect/vitest";
import { Effect, Ref, Stream } from "effect";
import { expect } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { stubService } from "@/lib/__fixtures__/service-stub";

import { bindAttachmentImport } from "./handle";
import type { AttachmentImport, AttachmentSkipSummary } from "./service";

const SUMMARY: AttachmentSkipSummary = {
  blocked: 1,
  refused: 0,
  blockedFolders: ["/outside"],
};

/** A service whose members answer from `folders`. */
function fakeService() {
  const folders = Ref.makeUnsafe<readonly string[]>(["/approved"]);
  const service = stubService<AttachmentImport["Service"]>("AttachmentImport", {
    approvedFolders: Ref.get(folders),
    approveFolder: (folder) =>
      Ref.update(folders, (list) => [...list, folder]).pipe(Effect.as(folder)),
    revokeFolder: (folder) =>
      Ref.update(folders, (list) => list.filter((path) => path !== folder)),
    skipped: Stream.make(SUMMARY),
  });
  return { service };
}

it.effect("resolves each member with the service's answer", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const { service } = fakeService();
    const handle = bindAttachmentImport(bridge, service);

    expect(handle.approvedFolders).toEqual(["/approved"]);
    await expect(handle.approveFolder("/granted")).resolves.toBe("/granted");
    await expect(handle.revokeFolder("/approved")).resolves.toBeUndefined();
    expect(handle.approvedFolders).toEqual(["/granted"]);

    const summaries: AttachmentSkipSummary[] = [];
    const stop = handle.onSkipped((summary) => summaries.push(summary));
    await expect.poll(() => summaries).toEqual([SUMMARY]);
    stop();
  }),
);

it.effect("after release, each member settles as the bridge does", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const { service } = fakeService();
    const handle = bindAttachmentImport(bridge, service);
    await bridge[Symbol.asyncDispose]();

    // The bridge keeps its captured context, so the runs still answer.
    expect(handle.approvedFolders).toEqual(
      bridge.runSync(service.approvedFolders),
    );
    await expect(handle.approveFolder("/late")).resolves.toBe("/late");

    // A subscription opened after release receives nothing, and stops cleanly.
    const summaries: AttachmentSkipSummary[] = [];
    const stop = handle.onSkipped((summary) => summaries.push(summary));
    expect(stop).not.toThrow();
    expect(summaries).toEqual([]);
  }),
);
