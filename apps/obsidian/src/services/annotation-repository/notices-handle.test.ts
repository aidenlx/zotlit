// @vitest-environment happy-dom
// The handle is a Promise edge for code outside Effect, so its cases run on
// plain Vitest over a real runtime and bridge.
import { ButtonComponent, controlsOf } from "@mock/obsidian";
import { Effect, Layer, Stream } from "effect";
import { expect, it } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import type { RecordedNotice } from "@/lib/__fixtures__/notifier";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { ZoteroLocalApi } from "@/services/zotero-local-api/service";

import { layerCapabilityNotices, CapabilityNotices } from "./notices";
import { bindCapabilityNotices } from "./notices-handle";
import { AnnotationRepository } from "./service";

/** Presses the one action of a recorded notice. */
function press(notice: RecordedNotice): void {
  const actions = (
    notice.messages[0] as DocumentFragment
  ).querySelector<HTMLElement>(".zt-notice-actions")!;
  const [button] = controlsOf(actions);
  if (!(button instanceof ButtonComponent)) throw new Error("no action");
  button.click();
}

/**
 * The handle over a runtime of the notices layer, against a Zotero that
 * answers every Allow editing with an Allow it does not remember.
 */
async function open() {
  const stack = new AsyncDisposableStack();
  const ran: string[] = [];
  const asked = { count: 0 };
  const notifier = testNotifier();
  const runtime = buildRuntime(
    layerCapabilityNotices({
      openEditingSettings: () => {
        ran.push("open");
      },
      cardShown: () => false,
      revealAnnotation: () => undefined,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          notifier.layer,
          Layer.mock(AnnotationRepository, {
            capabilityFor: () =>
              Effect.succeed({
                kind: "read-only",
                reason: "zotero-unavailable",
              } as const),
            probe: Effect.sync(() => {
              ran.push("probe");
            }),
            capabilityChanges: Stream.never,
            annotationChanged: Stream.never,
            writeConflicts: Stream.never,
          }),
          Layer.mock(ZoteroLocalApi, {
            authorize: Effect.sync(() => {
              asked.count += 1;
              return { failure: { kind: "not-remembered" } } as const;
            }),
            writeRefusals: Stream.never,
            serverChanges: Stream.never,
            writeRefusalsRetired: Stream.never,
          }),
        ),
      ),
    ),
    stack,
  );
  await runtime.context();
  const bridge = effectBridge(runtime);
  return {
    handle: bindCapabilityNotices(bridge, runtime.runSync(CapabilityNotices)),
    notifier,
    ran,
    asked,
    dispose: () => stack.disposeAsync(),
  };
}

it("resolves each gesture once its work is done", async () => {
  const { handle, notifier, ran, asked, dispose } = await open();

  await handle.showEditingCapability();
  expect(ran).toEqual(["probe", "open"]);

  await handle.allowEditing();
  expect(asked.count).toBe(1);
  expect(notifier.notices).toHaveLength(1);

  handle.reportBlockedGesture("ABCD2345");
  expect(notifier.notices).toHaveLength(2);

  await dispose();
});

it("settles as the bridge does after the runtime is disposed, and a notice's button does nothing", async () => {
  const { handle, notifier, asked, dispose } = await open();
  await handle.allowEditing();
  const notice = notifier.notices[0]!;
  expect(asked.count).toBe(1);

  await dispose();

  // The button's FiberSet closed with the layer: it neither hides the notice
  // nor asks Zotero again.
  press(notice);
  expect(notice.hidden).toBe(false);
  expect(asked.count).toBe(1);

  // The bridge still runs over the released services, so the handle resolves.
  await expect(handle.allowEditing()).resolves.toBeUndefined();
  await expect(handle.showEditingCapability()).resolves.toBeUndefined();
  expect(handle.reportBlockedGesture("ABCD2345")).toBeUndefined();
});
