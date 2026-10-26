import { Effect, Stream } from "effect";
import { afterAll, expect, it, vi } from "vitest";

import { openTestBridge } from "@/lib/__fixtures__/effect-bridge";
import { testEvent } from "@/lib/__fixtures__/event-stream";
import * as m from "@/lib/i18n/generated/messages";
import type {
  LocalApiFailure,
  LocalApiResult,
} from "@/services/zotero-local-api/service";

import type { EditingCapability } from "./capability";
import type { CapabilityNotice } from "./capability-notices";
import { CapabilityNotices } from "./notices";
import { IDLE } from "./write";
import type { MutationState, WriteConflict } from "./write";

const bridge = openTestBridge();
afterAll(() => bridge[Symbol.asyncDispose]());

/** The two dependencies the gesture runs through, each recording its order. */
function seam() {
  const ran: string[] = [];
  let release: (() => void) | null = null;
  const notices = new CapabilityNotices({
    capabilities: {
      capabilityFor: () => Effect.succeed({ kind: "writable" as const }),
      mutationFor: () => Effect.succeed(IDLE),
      capabilityChanges: Stream.never,
      annotationChanged: Stream.never,
      writeConflicts: Stream.never,
      probe: Effect.promise(async () => {
        ran.push("probe");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }),
    },
    bridge,
    writes: {
      authorize: Effect.succeed({ value: undefined }),
      writeRefusals: Stream.never,
      serverChanges: Stream.never,
      writeRefusalsRetired: Stream.never,
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
    (): LocalApiResult<void> => answers.shift() ?? { value: undefined },
  );
  const notices = new CapabilityNotices({
    capabilities: {
      capabilityFor: () =>
        Effect.succeed({ kind: "authorization-required" as const }),
      mutationFor: () => Effect.succeed(IDLE),
      capabilityChanges: Stream.never,
      annotationChanged: Stream.never,
      writeConflicts: Stream.never,
      probe: Effect.void,
    },
    bridge,
    writes: {
      authorize: Effect.sync(authorize),
      writeRefusals: Stream.never,
      serverChanges: Stream.never,
      writeRefusalsRetired: Stream.never,
    },
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

const ATTACHMENT = "ABCD2345";
const ANNOTATION = "EFGH2345";
const CLOSED: EditingCapability = {
  kind: "read-only",
  reason: "zotero-unavailable",
};
const CONFLICT: MutationState = {
  kind: "conflict",
  conflict: {} as WriteConflict,
};

/**
 * The notices listening to the repository and the Local API, with every
 * notice caught where the screen would show it and each event sent by hand.
 */
function watching(options: { cardShown?: boolean } = {}) {
  const shown: { notice: CapabilityNotice; runAction: () => void }[] = [];
  const ran: string[] = [];
  let capability: EditingCapability = CLOSED;
  let mutation: MutationState = IDLE;
  const events = {
    capabilityChanges: testEvent<void>(),
    annotationChanged: testEvent<string>(),
    writeConflicts: testEvent<{
      annotationKey: string;
      attachmentKey: string;
    }>(),
    writeRefusals: testEvent<{ failure: LocalApiFailure; library: string }>(),
    serverChanges: testEvent<string>(),
    writeRefusalsRetired: testEvent<void>(),
  };
  const notices = new CapabilityNotices({
    capabilities: {
      capabilityFor: () => Effect.sync(() => capability),
      mutationFor: () => Effect.sync(() => mutation),
      capabilityChanges: events.capabilityChanges.stream,
      annotationChanged: events.annotationChanged.stream,
      writeConflicts: events.writeConflicts.stream,
      probe: Effect.void,
    },
    bridge,
    writes: {
      authorize: Effect.succeed({ value: undefined }),
      writeRefusals: events.writeRefusals.stream,
      serverChanges: events.serverChanges.stream,
      writeRefusalsRetired: events.writeRefusalsRetired.stream,
    },
    openEditingSettings: () => ran.push("open"),
    cardShown: () => options.cardShown ?? false,
    revealAnnotation: (annotationKey) => ran.push(`reveal ${annotationKey}`),
    showNotice: (notice, runAction) => shown.push({ notice, runAction }),
  });
  return {
    notices,
    shown,
    ran,
    events,
    titles: () => shown.map(({ notice }) => notice.title),
    setCapability: (next: EditingCapability) => {
      capability = next;
    },
    setMutation: (next: MutationState) => {
      mutation = next;
    },
  };
}

it("says why a gesture is blocked once per episode, and opens the settings row from its button", async () => {
  const seam = watching();
  await using _notices = seam.notices;
  await seam.notices.ready;

  seam.notices.reportBlockedGesture(ATTACHMENT);
  seam.notices.reportBlockedGesture(ATTACHMENT);
  expect(seam.shown.map(({ notice }) => notice.action)).toEqual([
    m.notice_capability_open_settings(),
  ]);

  seam.shown[0]!.runAction();
  expect(seam.ran).toEqual(["open"]);

  // Editing works again, which closes the episode: the next block speaks.
  seam.setCapability({ kind: "writable" });
  seam.events.capabilityChanges.emit();
  seam.setCapability(CLOSED);
  seam.notices.reportBlockedGesture(ATTACHMENT);
  expect(seam.shown).toHaveLength(2);
});

it("says a write conflict once while it stands on a card no view shows, and reveals the card", async () => {
  const seam = watching();
  await using _notices = seam.notices;
  await seam.notices.ready;
  const conflict = { annotationKey: ANNOTATION, attachmentKey: ATTACHMENT };

  seam.events.writeConflicts.emit(conflict);
  seam.setMutation(CONFLICT);
  seam.events.annotationChanged.emit(ANNOTATION);
  seam.events.writeConflicts.emit(conflict);
  expect(seam.titles()).toEqual([m.notice_write_conflict()]);

  seam.shown[0]!.runAction();
  expect(seam.ran).toEqual([`reveal ${ANNOTATION}`]);

  // The card settled, so the next conflict on it is news.
  seam.setMutation(IDLE);
  seam.events.annotationChanged.emit(ANNOTATION);
  seam.events.writeConflicts.emit(conflict);
  expect(seam.titles()).toEqual([
    m.notice_write_conflict(),
    m.notice_write_conflict(),
  ]);
});

it("leaves a write conflict to the view that shows its card", async () => {
  const seam = watching({ cardShown: true });
  await using _notices = seam.notices;
  await seam.notices.ready;

  seam.events.writeConflicts.emit({
    annotationKey: ANNOTATION,
    attachmentKey: ATTACHMENT,
  });

  expect(seam.shown).toEqual([]);
});

it("says a read-only library once until a probe retires the refusals", async () => {
  const seam = watching();
  await using _notices = seam.notices;
  await seam.notices.ready;
  const refusal = {
    failure: { kind: "library-read-only" } as const,
    library: "users/0",
  };

  seam.events.writeRefusals.emit(refusal);
  seam.events.writeRefusals.emit(refusal);
  expect(seam.titles()).toEqual([m.notice_write_not_saved()]);
  seam.shown[0]!.runAction();
  expect(seam.ran).toEqual(["open"]);

  seam.events.writeRefusalsRetired.emit();
  seam.events.writeRefusals.emit(refusal);
  expect(seam.shown).toHaveLength(2);
});

it("says a changed Zotero database once per database", async () => {
  const seam = watching();
  await using _notices = seam.notices;
  await seam.notices.ready;

  seam.events.serverChanges.emit("server-a");
  seam.events.serverChanges.emit("server-a");
  seam.events.serverChanges.emit("server-b");

  expect(seam.titles()).toEqual([
    m.notice_write_not_saved(),
    m.notice_write_not_saved(),
  ]);
});
