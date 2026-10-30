import { it } from "@effect/vitest";
import { Stream } from "effect";
import { Effect } from "effect";
import { expect, vi } from "vitest";

import { subscribe } from "@/lib/effect-stream";
import { layerRcRef } from "@/services/zotero-reads/connection";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { libraryScopeFixture } from "./__fixtures__";
import { scopeChanges } from "./service";
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
    const off = subscribe(
      f.runtime,
      Stream.drop(f.service.changes, 1),
      (state) => {
        changes.push(state);
        if (changes.length === 1) throw new Error("listener failed");
      },
    );
    f.bridge.runSync(
      f.settings.update({
        [LIBRARY_SCOPE_KEY]: {
          mode: "selected",
          libraries: [{ type: "personal" }],
        },
      }),
    );
    f.bridge.runSync(
      f.settings.update({
        [LIBRARY_SCOPE_KEY]: {
          mode: "selected",
          libraries: [{ type: "group", groupID: 200 }],
        },
      }),
    );
    yield* Effect.promise(() => expect.poll(() => changes.length).toBe(2));
    expect(
      changes.map((state) =>
        state.current?.available.map((library) => library.libraryID),
      ),
    ).toEqual([[1], [3]]);
    off();
    f.bridge.runSync(
      f.settings.update({ [LIBRARY_SCOPE_KEY]: { mode: "all" } }),
    );
    yield* Effect.promise(() =>
      expect.poll(() => f.bridge.runSync(f.service.current)?.mode).toBe("all"),
    );
    expect(changes).toHaveLength(2);
  }),
);

it.effect("all adapter methods remain safe after whole-runtime disposal", () =>
  Effect.gen(function* () {
    const f = yield* libraryScopeFixture(client());
    const before = f.bridge.runSync(f.service.current);
    const rows = f.bridge.runSync(f.service.libraryRows);
    const listener = vi.fn();
    subscribe(f.runtime, Stream.drop(f.service.changes, 1), listener);
    yield* Effect.promise(() => f.close());
    expect(f.bridge.runSync(f.service.current)).toBe(before);
    expect(f.bridge.runSync(f.service.libraries)).toEqual(before?.available);
    expect(f.bridge.runSync(f.service.libraryRows)).toBeNull();
    expect(f.bridge.runSync(f.service.effective)).toEqual({ mode: "all" });
    expect(f.bridge.runSync(f.service.resolveLibraries(rows!))).toEqual(before);
    subscribe(f.runtime, Stream.drop(f.service.changes, 1), listener)();
    subscribe(
      f.runtime,
      scopeChanges(f.service.changes).pipe(
        Stream.map((state) => state.current),
      ),
      listener,
    )();
    subscribe(
      f.runtime,
      f.service.changes.pipe(
        Stream.map((state) => state.all),
        Stream.changes,
        Stream.drop(1),
        Stream.map(() => undefined),
      ),
      listener,
    )();
    f.bridge.runSync(
      f.settings.update({
        [LIBRARY_SCOPE_KEY]: { mode: "selected", libraries: [] },
      }),
    );
    expect(listener).not.toHaveBeenCalled();
  }),
);
