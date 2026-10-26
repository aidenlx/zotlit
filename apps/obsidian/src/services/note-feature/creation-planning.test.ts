// Companion targets and the creation Profile, read through the Profile and
// Note Index tags.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";

import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import type { ProfileId } from "@/lib/profile-stamp";
import { NoteIndex } from "@/services/note-index/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileFixture } from "@/services/profile/__fixtures__/reader";
import { Profile } from "@/services/profile/service";
import { defaults } from "@/services/settings/schema";

import {
  resolveCompanionNote,
  resolveCreationProfile,
} from "./creation-planning";

const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const PAPERS = "Rz9Wm4YfH6Kd" as ProfileId;

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

/**
 * The Profile registry `profiles` and the Note Index, whose notes for every
 * key are `notes`, each stamped as `stamps` says.
 */
function services(
  options: {
    profiles?: readonly ProfileFixture[];
    notes?: readonly TFile[];
    stamps?: ReadonlyMap<TFile, string>;
    rememberedProfile?: ProfileId;
  } = {},
) {
  const reader = profileReader(
    Object.assign(
      { ...defaults, profiles: options.profiles ?? [] },
      options.rememberedProfile === undefined
        ? {}
        : { "note.last-used-profile": options.rememberedProfile },
    ),
    {
      getFileCache: (file) => {
        const stamp = options.stamps?.get(file);
        return stamp === undefined
          ? null
          : { frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: stamp } };
      },
    },
  );
  const notesRead: string[] = [];
  return {
    notesRead,
    layer: Layer.mergeAll(
      Layer.mock(Profile, {
        profiles: Effect.sync(() => reader.profiles),
        resolveProfile: (selector) =>
          Effect.sync(() => reader.resolveProfile(selector)),
        profileOf: (file) => Effect.sync(() => reader.profileOf(file)),
      }),
      Layer.mock(NoteIndex, {
        whenIndexed: Effect.void,
        getNotesByItemKey: (key) =>
          Effect.sync(() => {
            notesRead.push(key);
            return [...(options.notes ?? [])];
          }),
      }),
    ),
  };
}

describe("Companion note target", () => {
  it.effect.each([undefined, "default"] as const)(
    "opens an existing unknown stamp with recovery data for URL Profile %s",
    (profile) => {
      const file = noteAt("Paper.md");
      return resolveCompanionNote("ABC23456", { profile }).pipe(
        Effect.map((target) =>
          expect(target).toMatchObject({
            outcome: "existing",
            files: [file],
            diagnostic: {
              code: "unknown-literature-note-profile",
              stamp: "Missing (Rz9Wm4YfH6Kd)",
              path: "Paper.md",
              recovery: { action: "switch-profile" },
            },
          }),
        ),
        Effect.provide(
          services({
            notes: [file],
            stamps: new Map([[file, "Missing (Rz9Wm4YfH6Kd)"]]),
          }).layer,
        ),
      );
    },
  );

  it.effect(
    "returns a matching or unqualified existing note without a kept-Profile notice",
    () => {
      const file = noteAt("Books/Paper.md");
      const duplicate = noteAt("Other/Paper.md");
      return Effect.gen(function* () {
        for (const profile of [undefined, BOOKS]) {
          expect(yield* resolveCompanionNote("ABC23456", { profile })).toEqual({
            outcome: "existing",
            files: [file, duplicate],
            keptProfile: undefined,
          });
        }
      }).pipe(
        Effect.provide(
          services({
            profiles: [{ id: BOOKS, label: "Books" }],
            notes: [file, duplicate],
            stamps: new Map([[file, `Books (${BOOKS})`]]),
          }).layer,
        ),
      );
    },
  );

  it.effect(
    "offers creation only when there is no existing note and the requested Profile resolves",
    () =>
      resolveCompanionNote("ABC23456", { profile: "default" }).pipe(
        Effect.map((target) => expect(target).toEqual({ outcome: "create" })),
        Effect.provide(services().layer),
      ),
  );

  it.effect.each([false, true])(
    "refuses an unknown URL Profile before fallback, including a matching stamp (existing: %s)",
    (existing) => {
      const missing = "Rz9Wm4YfH6Kd" as ProfileId;
      const file = noteAt("Paper.md");
      const fixture = services({
        notes: existing ? [file] : [],
        stamps: new Map([[file, `Missing (${missing})`]]),
      });
      return resolveCompanionNote("ABC23456", { profile: missing }).pipe(
        Effect.map((target) => {
          expect(target).toMatchObject({
            outcome: "refused",
            diagnostic: {
              code: "unknown-literature-note-profile",
              stamp: missing,
              indexedKey: "ABC23456",
            },
          });
          expect(fixture.notesRead).toEqual([]);
        }),
        Effect.provide(fixture.layer),
      );
    },
  );

  it.effect(
    "keeps the stamped Profile and returns the existing note for a conflicting link",
    () => {
      const file = noteAt("Books/Paper.md");
      return resolveCompanionNote("ABC23456", { profile: PAPERS }).pipe(
        Effect.map((target) =>
          expect(target).toEqual({
            outcome: "existing",
            files: [file],
            keptProfile: { selector: BOOKS, label: "Books" },
          }),
        ),
        Effect.provide(
          services({
            profiles: [
              { id: BOOKS, label: "Books" },
              { id: PAPERS, label: "Papers" },
            ],
            notes: [file],
            stamps: new Map([[file, `Old name (${BOOKS})`]]),
          }).layer,
        ),
      );
    },
  );
});

describe("creation Profile", () => {
  it.effect(
    "preselects headless over Default, lets an asked choice override it, and ignores a remembered Profile",
    () =>
      Effect.gen(function* () {
        expect(yield* resolveCreationProfile()).toEqual({
          selector: "default",
          source: "bound",
          shouldAsk: true,
        });
        expect(yield* resolveCreationProfile({ headless: PAPERS })).toEqual({
          selector: PAPERS,
          source: "headless",
          shouldAsk: true,
        });
        expect(
          yield* resolveCreationProfile({ headless: PAPERS, asked: "default" }),
        ).toEqual({ selector: "default", source: "asked", shouldAsk: true });
      }).pipe(
        Effect.provide(
          services({
            profiles: [
              { id: BOOKS, label: "Books" },
              { id: PAPERS, label: "Papers" },
            ],
            rememberedProfile: BOOKS,
          }).layer,
        ),
      ),
  );

  it.effect(
    "reports an invalid explicit selector instead of treating it as absent, even with Default alone",
    () => {
      const missing = "Missing12345" as ProfileId;
      return Effect.gen(function* () {
        expect(
          yield* resolveCreationProfile({ headless: missing }).pipe(
            Effect.provide(
              services({ profiles: [{ id: BOOKS, label: "Books" }] }).layer,
            ),
          ),
        ).toEqual({
          selector: "default",
          source: "bound",
          shouldAsk: true,
          problem: {
            kind: "invalid-selector",
            source: "headless",
            selector: missing,
          },
        });
        const alone = services().layer;
        expect(
          yield* resolveCreationProfile().pipe(Effect.provide(alone)),
        ).toEqual({ selector: "default", source: "bound", shouldAsk: false });
        expect(
          yield* resolveCreationProfile({ asked: missing }).pipe(
            Effect.provide(alone),
          ),
        ).toEqual({
          selector: "default",
          source: "bound",
          shouldAsk: true,
          problem: {
            kind: "invalid-selector",
            source: "asked",
            selector: missing,
          },
        });
      });
    },
  );
});
