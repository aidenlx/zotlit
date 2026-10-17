// What the Welcome View banner shows, as one decision over its state.
import { describe, expect, it } from "vitest";

import { bannerSections } from "./store";
import type { WelcomeState } from "./store";

/** A set-up vault: connected, with the literature-notes folder, never dismissed. */
const SET_UP: WelcomeState = {
  migrationPending: false,
  dismissed: false,
  requested: false,
  connection: { status: "connected", path: "~/Zotero", itemCount: 3 },
  literatureFolder: "literatures",
  literatureFolderExists: true,
  templateConversionPending: false,
  templateFolder: "templates",
  templateConversionResult: null,
  v1TemplatesPresent: false,
  notFound: false,
};
const RESULT = { document: "templates/Default.md", trashed: 4 };

describe("bannerSections", () => {
  it.each<[string, Partial<WelcomeState>, ReturnType<typeof bannerSections>]>([
    ["nothing once setup is complete", {}, null],
    [
      "the steps while the folder is missing",
      { literatureFolderExists: false },
      {
        steps: true,
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
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
        steps: true,
        connect: false,
        conversion: null,
        migration: false,
        companion: false,
      },
    ],
    [
      "the Connect step while only a refresh failed",
      { connection: { status: "missing" } },
      {
        steps: true,
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
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
        steps: true,
        connect: true,
        conversion: null,
        migration: false,
        companion: false,
      },
    ],
    [
      "the conversion offer alone while it is pending, setup complete",
      { templateConversionPending: true },
      {
        steps: false,
        connect: false,
        conversion: "offer",
        migration: false,
        companion: false,
      },
    ],
    [
      "the conversion result while cleanup remains",
      { templateConversionResult: { ...RESULT, pendingCleanup: ["a.md"] } },
      {
        steps: false,
        connect: false,
        conversion: "result",
        migration: false,
        companion: false,
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
        steps: true,
        connect: true,
        conversion: "result",
        migration: false,
        companion: false,
      },
    ],
    [
      "the Migration Prompt and the Zotero 10 guidance of a v1 upgrade, dismissed before",
      { migrationPending: true, dismissed: true, v1TemplatesPresent: true },
      {
        steps: true,
        connect: true,
        conversion: null,
        migration: true,
        companion: true,
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
        steps: true,
        connect: true,
        conversion: "offer",
        migration: false,
        companion: true,
      },
    ],
  ])("shows %s", (_, state, sections) => {
    expect(bannerSections({ ...SET_UP, ...state })).toEqual(sections);
  });
});
