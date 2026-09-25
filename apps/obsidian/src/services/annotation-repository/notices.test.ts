import { expect, it, vi } from "vitest";

import * as m from "@/lib/i18n/generated/messages";
import type { LocalApiResult } from "@/services/zotero-local-api/service";

import type { CapabilityNotice } from "./capability-notices";
import { CapabilityNotices } from "./notices";
import { IDLE } from "./write";

/** The two dependencies the gesture runs through, each recording its order. */
function seam() {
  const ran: string[] = [];
  let release: (() => void) | null = null;
  const notices = new CapabilityNotices({
    capabilities: {
      capabilityFor: () => ({ kind: "writable" }),
      mutationFor: () => IDLE,
      on: () => () => undefined,
      probe: vi.fn(async () => {
        ran.push("probe");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }),
    },
    writes: {
      authorize: async () => ({ value: undefined }),
      on: () => () => undefined,
    },
    openEditingSettings: vi.fn(() => ran.push("open")),
    cardShown: () => true,
    revealAnnotation: vi.fn(() => ran.push("reveal")),
  });
  return {
    notices,
    ran,
    /** Lets the probe in flight answer. */
    answerProbe: () => release?.(),
  };
}

it("re-checks Zotero before it opens the editing settings row", async () => {
  const { notices, ran, answerProbe } = seam();
  await using _notices = notices;
  await notices.ready;

  const gesture = notices.showEditingCapability();
  // The row waits for the probe: it renders the capability, and a stale one
  // would name a state Zotero has already left.
  expect(ran).toEqual(["probe"]);

  answerProbe();
  await gesture;
  expect(ran).toEqual(["probe", "open"]);
});

/**
 * Allow editing against a Zotero that gives these answers in turn, with every
 * notice caught where the screen would show it.
 */
function answering(...answers: LocalApiResult<void>[]) {
  const shown: { notice: CapabilityNotice; runAction: () => void }[] = [];
  const authorize = vi.fn(
    async (): Promise<LocalApiResult<void>> =>
      answers.shift() ?? { value: undefined },
  );
  const notices = new CapabilityNotices({
    capabilities: {
      capabilityFor: () => ({ kind: "authorization-required" }),
      mutationFor: () => IDLE,
      on: () => () => undefined,
      probe: async () => undefined,
    },
    writes: { authorize, on: () => () => undefined },
    openEditingSettings: () => undefined,
    cardShown: () => true,
    revealAnnotation: () => undefined,
    showNotice: (notice, runAction) => shown.push({ notice, runAction }),
  });
  return { notices, shown, authorize };
}

it("says editing is on after Always Allow", async () => {
  const { notices, shown } = answering({ value: undefined });
  await using _notices = notices;

  await notices.allowEditing();

  expect(shown.map(({ notice }) => notice)).toEqual([
    expect.objectContaining({
      title: m.notice_zotero_editing_enabled(),
      action: null,
    }),
  ]);
});

it("says to choose Always Allow after Allow, and asks again only from its button", async () => {
  const { notices, shown, authorize } = answering(
    { failure: { kind: "not-remembered" } },
    { value: undefined },
  );
  await using _notices = notices;

  await notices.allowEditing();
  expect(shown.map(({ notice }) => notice)).toEqual([
    expect.objectContaining({
      title: m.notice_zotero_editing_not_remembered(),
      action: m.capability_enable_editing(),
    }),
  ]);
  // No second request leaves until the user presses the button (ADR 0038).
  expect(authorize).toHaveBeenCalledOnce();

  shown[0]!.runAction();
  await vi.waitFor(() => expect(shown).toHaveLength(2));
  expect(authorize).toHaveBeenCalledTimes(2);
  expect(shown[1]!.notice.title).toBe(m.notice_zotero_editing_enabled());
});

it("says the permission was not saved when this device cannot keep it", async () => {
  const { notices, shown } = answering({ failure: { kind: "not-saved" } });
  await using _notices = notices;

  await notices.allowEditing();

  expect(shown.map(({ notice }) => notice)).toEqual([
    expect.objectContaining({
      title: m.notice_zotero_editing_not_saved(),
      action: null,
    }),
  ]);
});

it("stays silent after Deny, which the capability's own status reports", async () => {
  const { notices, shown } = answering({ failure: { kind: "denied" } });
  await using _notices = notices;

  await notices.allowEditing();

  expect(shown).toEqual([]);
});
