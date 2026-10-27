// What the Welcome View banner shows, as one decision over its state.
import { describe, expect, it } from "vitest";

import { bannerBadge, bannerSections } from "./presentation";
import type { WelcomeState } from "./presentation";

/** A set-up vault: connected, with the literature-notes folder, never dismissed. */
const SET_UP: WelcomeState = {
  migrationPending: false,
  dismissed: false,
  requested: false,
  requests: 0,
  stepsShown: false,
  converted: false,
  connection: { status: "connected", path: "~/Zotero", itemCount: 3 },
  literatureFolder: "literatures",
  literatureFolderExists: true,
  templateConversionPending: false,
  templateFolder: "templates",
  templateConversionResult: null,
  v1TemplatesPresent: false,
  notFound: false,
  version: "2.2.0",
  updatePending: false,
  noticesEnabled: true,
};
const RESULT = { document: "templates/Default.md", trashed: 4 };

describe("bannerSections", () => {
  it.each<[string, Partial<WelcomeState>, ReturnType<typeof bannerSections>]>([
    ["nothing once setup is complete", {}, null],
    [
      "the steps while the folder is missing",
      { literatureFolderExists: false },
      {
        steps: "open",
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the folder step alone while the Library View says Zotero is not found",
      {
        literatureFolderExists: false,
        connection: { status: "missing" },
        notFound: true,
      },
      {
        steps: "open",
        connect: false,
        conversion: null,
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the Connect step while only a refresh failed",
      { connection: { status: "missing" } },
      {
        steps: "open",
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "nothing while the connection is checked",
      { literatureFolderExists: false, connection: { status: "checking" } },
      null,
    ],
    [
      "nothing after a dismissal, setup incomplete",
      { literatureFolderExists: false, dismissed: true },
      null,
    ],
    [
      "the steps on request, setup complete",
      { requested: true },
      {
        steps: "open",
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the conversion offer while it is pending, the done steps folded",
      { templateConversionPending: true },
      {
        steps: "folded",
        connect: true,
        conversion: "offer",
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the conversion result while cleanup remains, the done steps folded",
      { templateConversionResult: { ...RESULT, pendingCleanup: ["a.md"] } },
      {
        steps: "folded",
        connect: true,
        conversion: "result",
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "nothing for a clean conversion result, setup complete",
      { templateConversionResult: { ...RESULT, pendingCleanup: [] } },
      null,
    ],
    [
      "the conversion result on request",
      {
        requested: true,
        templateConversionResult: { ...RESULT, pendingCleanup: [] },
      },
      {
        steps: "open",
        connect: true,
        conversion: "result",
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the Migration Prompt and the Zotero 10 guidance of a v1 upgrade, dismissed before",
      { migrationPending: true, dismissed: true, v1TemplatesPresent: true },
      {
        steps: "folded",
        connect: true,
        conversion: null,
        migration: true,
        companion: true,
        update: false,
      },
    ],
    [
      "the conversion offer in place of the v1 guide",
      {
        migrationPending: true,
        v1TemplatesPresent: true,
        templateConversionPending: true,
      },
      {
        steps: "folded",
        connect: true,
        conversion: "offer",
        migration: false,
        companion: true,
        update: false,
      },
    ],
    [
      "the update alone, setup complete",
      { updatePending: true },
      {
        steps: false,
        connect: false,
        conversion: null,
        migration: false,
        companion: false,
        update: true,
      },
    ],
    [
      "the update alone after a dismissal, setup incomplete",
      { updatePending: true, dismissed: true, literatureFolderExists: false },
      {
        steps: false,
        connect: false,
        conversion: null,
        migration: false,
        companion: false,
        update: true,
      },
    ],
    [
      "nothing for an update while release notices are off",
      { updatePending: true, noticesEnabled: false },
      null,
    ],
    [
      "the update with the steps while setup is incomplete",
      { updatePending: true, literatureFolderExists: false },
      {
        steps: "open",
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
        update: true,
      },
    ],
    [
      "the update with the Migration Prompt of a v1 upgrade",
      { updatePending: true, migrationPending: true, v1TemplatesPresent: true },
      {
        steps: "folded",
        connect: true,
        conversion: null,
        migration: true,
        companion: true,
        update: true,
      },
    ],
    [
      "the update with the conversion offer, the done steps folded",
      { updatePending: true, templateConversionPending: true },
      {
        steps: "folded",
        connect: true,
        conversion: "offer",
        migration: false,
        companion: false,
        update: true,
      },
    ],
    [
      "the update with the steps open on request",
      { updatePending: true, requested: true },
      {
        steps: "open",
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
        update: true,
      },
    ],
    [
      "no steps beside a notice while the connection is checked",
      { templateConversionPending: true, connection: { status: "checking" } },
      {
        steps: false,
        connect: false,
        conversion: "offer",
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the steps open on request while the connection is checked",
      { requested: true, connection: { status: "checking" } },
      {
        steps: "open",
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the result of a conversion run in this session, the done steps folded",
      {
        converted: true,
        templateConversionResult: { ...RESULT, pendingCleanup: [] },
      },
      {
        steps: "folded",
        connect: true,
        conversion: "result",
        migration: false,
        companion: false,
        update: false,
      },
    ],
    [
      "the conversion result of a v1 upgrade, the done steps folded",
      {
        migrationPending: true,
        templateConversionResult: { ...RESULT, pendingCleanup: [] },
      },
      {
        steps: "folded",
        connect: true,
        conversion: "result",
        migration: false,
        companion: true,
        update: false,
      },
    ],
  ])("shows %s", (_, state, sections) => {
    expect(bannerSections({ ...SET_UP, ...state })).toEqual(sections);
  });
});

describe("bannerBadge", () => {
  it.each<[string, Partial<WelcomeState>, string]>([
    ["a fresh install", { literatureFolderExists: false }, "get-started"],
    ["the steps on request", { requested: true }, "get-started"],
    ["an update alone", { updatePending: true }, "updated"],
    [
      "an update beside the conversion offer",
      { updatePending: true, templateConversionPending: true },
      "updated",
    ],
    [
      "an update while setup is incomplete",
      { updatePending: true, literatureFolderExists: false },
      "updated",
    ],
    [
      "an update while release notices are off",
      { updatePending: true, noticesEnabled: false, requested: true },
      "get-started",
    ],
    ["a v1 upgrade", { migrationPending: true }, "upgraded"],
    [
      "a v1 upgrade beside an update",
      { migrationPending: true, updatePending: true },
      "upgraded",
    ],
  ])("names %s", (_, state, badge) => {
    expect(bannerBadge({ ...SET_UP, ...state })).toBe(badge);
  });
});

/**
 * Every combination of what can bring the banner up, so a dismissal is
 * checked against each.
 */
function* combinations(): Generator<Partial<WelcomeState>> {
  const flags = [
    "migrationPending",
    "requested",
    "converted",
    "templateConversionPending",
    "v1TemplatesPresent",
    "updatePending",
    "notFound",
  ] as const;
  for (let mask = 0; mask < 1 << flags.length; mask++) {
    for (const folder of [true, false]) {
      for (const result of [
        null,
        { ...RESULT, pendingCleanup: [] },
        { ...RESULT, pendingCleanup: ["a.md"] },
      ]) {
        const state: Partial<WelcomeState> = {
          literatureFolderExists: folder,
          templateConversionResult: result,
        };
        flags.forEach((flag, i) => {
          state[flag] = (mask & (1 << i)) !== 0;
        });
        yield state;
      }
    }
  }
}

describe("a dismissal", () => {
  /** What the dismiss action writes: the dismissal, and both acknowledgements. */
  const DISMISSED = {
    dismissed: true,
    requested: false,
    converted: false,
    migrationPending: false,
    updatePending: false,
  } as const;

  it("hides the banner in every combination of its sections", () => {
    for (const state of combinations()) {
      const before = { ...SET_UP, ...state };
      expect(
        bannerSections({ ...before, ...DISMISSED }),
        JSON.stringify(state),
      ).toBeNull();
    }
  });

  it("keeps it hidden after a reload, until a later update or a new Migration Prompt", () => {
    for (const state of combinations()) {
      // A reload keeps what plugin data holds; the session's request is gone.
      const reloaded = { ...SET_UP, ...state, ...DISMISSED };
      expect(bannerSections(reloaded)).toBeNull();
      expect(bannerSections({ ...reloaded, updatePending: true })?.update).toBe(
        true,
      );
      expect(
        bannerSections({ ...reloaded, migrationPending: true }),
      ).not.toBeNull();
    }
  });
});
