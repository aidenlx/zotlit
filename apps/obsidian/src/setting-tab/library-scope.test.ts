// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import * as m from "@/lib/i18n/generated/messages";
import type {
  AvailableLibrary,
  LibraryScope as SavedLibraryScope,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { defaults } from "@/services/settings/schema";

import { testSettingTab } from "./__fixtures__";
import type { SettingTabContext } from "./context";
import { libraryScopeRow, selectedLibrariesList } from "./library-scope";

const MY_LIBRARY: AvailableLibrary = {
  selector: { type: "personal" },
  libraryID: 1,
  name: null,
};
const LAB_GROUP: AvailableLibrary = {
  selector: { type: "group", groupID: 7 },
  libraryID: 4,
  name: "Reading group",
};

interface ScopeState {
  effective: SavedLibraryScope;
  current: ResolvedLibraryScope | null;
  invalid?: boolean;
  libraries?: readonly AvailableLibrary[];
}

/** The Library scope rows over the scope the test names. */
const setup = Effect.fn("setup")(function* (state: ScopeState) {
  const saved: Parameters<SettingTabContext["settings"]["update"]>[0][] = [];
  let updates = 0;
  const services = yield* Layer.build(
    Layer.mock(LibraryScope, {
      effective: Effect.succeed(state.effective),
      current: Effect.succeed(state.current),
      invalid: Effect.succeed(state.invalid ?? false),
      libraries: Effect.succeed(state.libraries ?? []),
    }),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: testSettingTab(services).tab,
    settings: stubService<SettingTabContext["settings"]>("Settings", {
      update: (patch) =>
        Effect.sync(() => {
          saved.push(patch);
          return defaults;
        }),
    }),
    requestUpdate: () => void (updates += 1),
  });
  return { ctx, saved, updates: () => updates };
});

const resolved = (
  available: readonly AvailableLibrary[],
  unavailable: ResolvedLibraryScope["unavailable"] = [],
): ResolvedLibraryScope => ({
  mode: "selected",
  invalid: false,
  available,
  unavailable,
});

it.effect(
  "locks the scope controls and keeps the saved value while the database is unreadable",
  () =>
    Effect.gen(function* () {
      const { ctx } = yield* setup({
        effective: { mode: "selected", libraries: [{ type: "personal" }] },
        current: null,
      });
      expect(
        (libraryScopeRow(ctx).desc as DocumentFragment).textContent,
      ).toContain(m.settings_library_scope_db_unavailable());

      const list = selectedLibrariesList(ctx);
      expect(list.addItem).toBeUndefined();
      expect(list.onDelete).toBeUndefined();
      // An unreadable database knows of no missing Library, only of none.
      expect(list.items!.map((item) => item.desc)).toEqual([undefined]);
    }),
);

it.effect("warns about a broken saved scope", () =>
  Effect.gen(function* () {
    const { ctx } = yield* setup({
      effective: { mode: "selected", libraries: [{ type: "personal" }] },
      current: resolved([MY_LIBRARY]),
      invalid: true,
    });
    expect(
      (libraryScopeRow(ctx).desc as DocumentFragment).textContent,
    ).toContain(m.settings_library_scope_invalid());
  }),
);

it.effect(
  "names each selected Library, marks a missing one, and saves a removal",
  () =>
    Effect.gen(function* () {
      const { ctx, saved, updates } = yield* setup({
        effective: {
          mode: "selected",
          libraries: [
            { type: "personal" },
            { type: "group", groupID: 7 },
            { type: "group", groupID: 9 },
          ],
        },
        current: resolved(
          [MY_LIBRARY, LAB_GROUP],
          [{ type: "group", groupID: 9 }],
        ),
        libraries: [MY_LIBRARY, LAB_GROUP],
      });
      const list = selectedLibrariesList(ctx);
      expect(list.items!.map((item) => [item.name, item.desc])).toEqual([
        [m.settings_library_scope_personal(), undefined],
        ["Reading group", undefined],
        [
          m.settings_library_scope_group({ groupID: 9 }),
          m.settings_library_scope_unavailable(),
        ],
      ]);

      yield* Effect.promise(async () => list.onDelete?.(2));
      expect(saved).toEqual([
        {
          "zotero.library-scope": {
            mode: "selected",
            libraries: [{ type: "personal" }, { type: "group", groupID: 7 }],
          },
        },
      ]);
      expect(updates()).toBe(1);
    }),
);
