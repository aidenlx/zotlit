import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { describe, expect } from "vitest";

import { testNotifier } from "@/lib/__fixtures__/notifier";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier } from "@/lib/notifier";
import type { BatchUpdateResult } from "@/services/note-feature/update-batch";

import { showProtocolOutcome } from "./notices";
import { ProtocolOutcome } from "./outcome";

/** The notices `outcome` shows: each one's text and duration. */
const noticesOf = Effect.fn("noticesOf")(function* (outcome: ProtocolOutcome) {
  const notifier = testNotifier();
  yield* showProtocolOutcome(outcome, {}).pipe(
    Effect.provideService(Notifier, notifier.service),
  );
  return notifier.notices.map(({ messages: [message], duration }) => ({
    message,
    duration,
  }));
});

/** A batch update run that ended with `outcome`. */
const updated = (outcome: BatchUpdateResult["outcome"]) =>
  Exit.succeed<BatchUpdateResult>({ outcome });

describe("showProtocolOutcome", () => {
  it.effect.each([
    [ProtocolOutcome.InvalidLink(), m.notice_protocol_invalid()],
    [ProtocolOutcome.DatabaseUnavailable(), m.notice_protocol_db_unavailable()],
    [ProtocolOutcome.ItemNotFound(), m.notice_protocol_item_not_found()],
    [ProtocolOutcome.ProfileImportFailed(), m.notice_profile_action_failed()],
  ] as const)("tells a refused link: %o", ([outcome, message]) =>
    Effect.gen(function* () {
      expect(yield* noticesOf(outcome)).toEqual([
        { message, duration: undefined },
      ]);
    }),
  );

  it.effect("names the Profile ID that names no Profile", () =>
    Effect.gen(function* () {
      const notices = yield* noticesOf(
        ProtocolOutcome.UnknownProfile({ text: "not-a-profile" }),
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("not-a-profile");
    }),
  );

  it.effect.each([
    ProtocolOutcome.ForeignSource(),
    ProtocolOutcome.Opened(),
    ProtocolOutcome.ProfileOpened(),
    ProtocolOutcome.ProfileImportCancelled(),
  ])("shows nothing for %o", (outcome) =>
    Effect.gen(function* () {
      expect(yield* noticesOf(outcome)).toEqual([]);
    }),
  );

  it.effect.each([
    ["db-unavailable", m.batch_update_db_unavailable()],
    ["empty-selection", m.notice_protocol_item_not_found()],
    ["not-found", m.notice_protocol_item_not_found()],
  ] as const)(
    "tells an update-many run's %s outcome for 2 s",
    ([result, message]) =>
      Effect.gen(function* () {
        expect(
          yield* noticesOf(
            ProtocolOutcome.UpdateMany({ exit: updated(result) }),
          ),
        ).toEqual([{ message, duration: 2000 }]);
      }),
  );

  it.effect.each([
    ["db-unavailable", m.batch_update_db_unavailable()],
    ["empty-selection", m.batch_update_all_empty()],
    ["no-library-in-scope", m.batch_all_no_library_in_scope()],
    ["unavailable-target", m.batch_all_library_unavailable()],
    ["collection-not-found", m.notice_collection_not_found()],
  ] as const)(
    "tells an update-all run's %s outcome for 2 s",
    ([result, message]) =>
      Effect.gen(function* () {
        expect(
          yield* noticesOf(
            ProtocolOutcome.UpdateAll({ exit: updated(result) }),
          ),
        ).toEqual([{ message, duration: 2000 }]);
      }),
  );

  it.effect.each(["single-update", "batch-modal"] as const)(
    "shows nothing for an update run that reached its %s",
    (result) =>
      Effect.gen(function* () {
        expect(
          yield* noticesOf(
            ProtocolOutcome.UpdateMany({ exit: updated(result) }),
          ),
        ).toEqual([]);
        expect(
          yield* noticesOf(
            ProtocolOutcome.UpdateAll({ exit: updated(result) }),
          ),
        ).toEqual([]);
      }),
  );

  it.effect("shows nothing for an update run that failed", () =>
    Effect.gen(function* () {
      const exit = Exit.die(new Error("classify failed"));
      expect(yield* noticesOf(ProtocolOutcome.UpdateMany({ exit }))).toEqual(
        [],
      );
      expect(yield* noticesOf(ProtocolOutcome.UpdateAll({ exit }))).toEqual([]);
    }),
  );

  it.effect("tells an import run's failure for 4 s", () =>
    Effect.gen(function* () {
      const exit = Exit.die(new Error("index failed"));
      expect(yield* noticesOf(ProtocolOutcome.ImportNotes({ exit }))).toEqual([
        { message: m.batch_import_failed(), duration: 4000 },
      ]);
      expect(
        yield* noticesOf(ProtocolOutcome.ImportAllNotes({ exit })),
      ).toEqual([{ message: m.batch_import_failed(), duration: 4000 }]);
    }),
  );
});
