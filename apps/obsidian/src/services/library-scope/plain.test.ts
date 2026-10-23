import { expect, vi } from "vitest";

import { Effect } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";
import { layerRcRef } from "@/services/zotero-reads/connection";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { libraryScopeFixture } from "./__fixtures__";
import type { LibraryScopeState } from "./service";
import { LIBRARY_SCOPE_KEY } from "./service";

const client = () =>
  inProcessClient(
    layerRcRef(
      memoryOpener(
        () =>
          "insert into libraries (libraryID, type) values (1, 'user'); insert into libraries (libraryID, type) values (3, 'group'); insert into groups (groupID, libraryID, name) values (200, 3, 'Lab');",
      ).open,
    ),
  );

it.effect("a throwing subscriber receives both immediate changes (#1705)", () =>
  Effect.gen(function* () {
    const f = yield* libraryScopeFixture(client());
    const changes: LibraryScopeState[] = [];
    const off = f.plain.subscribe((state) => {
      changes.push(state);
      if (changes.length === 1) throw new Error("listener failed");
    });
    f.settings.update({
      [LIBRARY_SCOPE_KEY]: {
        mode: "selected",
        libraries: [{ type: "personal" }],
      },
    });
    f.settings.update({
      [LIBRARY_SCOPE_KEY]: {
        mode: "selected",
        libraries: [{ type: "group", groupID: 200 }],
      },
    });
    yield* Effect.promise(() => expect.poll(() => changes.length).toBe(2));
    expect(
      changes.map((state) =>
        state.current?.available.map((library) => library.libraryID),
      ),
    ).toEqual([[1], [3]]);
    off();
    f.settings.update({ [LIBRARY_SCOPE_KEY]: { mode: "all" } });
    yield* Effect.promise(() =>
      expect.poll(() => f.plain.current?.mode).toBe("all"),
    );
    expect(changes).toHaveLength(2);
  }),
);

it.effect("all adapter methods remain safe after whole-runtime disposal", () =>
  Effect.gen(function* () {
    const f = yield* libraryScopeFixture(client());
    const before = f.plain.current;
    const rows = f.plain.libraryRows;
    const listener = vi.fn();
    f.plain.subscribe(listener);
    yield* Effect.promise(f.close);
    expect(f.plain.current).toBe(before);
    expect(f.plain.libraries).toEqual(before?.available);
    expect(f.plain.libraryRows).toBeNull();
    expect(f.plain.effective).toEqual({ mode: "all" });
    expect(f.plain.invalid).toBe(false);
    expect(f.plain.resolveLibraries(rows!)).toEqual(before);
    f.plain.subscribe(listener)();
    f.plain.on("changed", listener)();
    f.plain.on("libraries-changed", listener)();
    f.settings.update({
      [LIBRARY_SCOPE_KEY]: { mode: "selected", libraries: [] },
    });
    expect(listener).not.toHaveBeenCalled();
  }),
);
