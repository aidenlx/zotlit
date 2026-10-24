import { expect } from "vitest";

import { Stream } from "@/lib/effect";
import { Effect } from "@/lib/effect";
import { subscribe } from "@/lib/effect-stream";
import { it } from "@/lib/effect-vitest";
import { layerRcRef } from "@/services/zotero-reads/connection";
import {
  inProcessClient,
  memoryOpener,
  seedWorksSql,
} from "@/services/zotero-reads/test-utils";

import { lookupFixture } from "./__fixtures__";

it.effect(
  "attaches before two immediate revisions and retains throwing listeners (#1705)",
  () =>
    Effect.gen(function* () {
      let revision = 0;
      const f = yield* lookupFixture(
        Effect.map(
          inProcessClient(
            layerRcRef(
              memoryOpener(() =>
                seedWorksSql([
                  { itemID: 1, key: "ITEMKEY1", citationKey: "first" },
                ]),
              ).open,
            ),
          ),
          (client) => ({
            ...client,
            CitationLookup: ((
              ...args: Parameters<typeof client.CitationLookup>
            ) =>
              client.CitationLookup(...args).pipe(
                Effect.map((answer) => ({
                  ...answer,
                  revision: String(++revision),
                })),
              )) as typeof client.CitationLookup,
          }),
        ),
      );
      yield* Effect.promise(() => f.plain.whenResolved());
      const seen: string[] = [];
      let notifications = 0;
      const off = subscribe(
        f.runtime,
        Stream.drop(f.plain.changes, 1),
        (state) => {
          seen.push(state.revision!);
          if (seen.length === 1) throw new Error("listener failed");
        },
      );
      const offEvent = subscribe(f.runtime, f.plain["changed"], () => {
        notifications++;
        if (notifications === 1) throw new Error("event listener failed");
      });
      yield* Effect.promise(() =>
        Promise.all([f.plain.read({}), f.plain.read({})]),
      );
      yield* Effect.promise(async () => {
        await expect.poll(() => seen.length).toBe(2);
      });
      expect(seen).toEqual(["2", "3"]);
      expect(notifications).toBe(2);
      off();
      offEvent();
      yield* Effect.promise(() => f.plain.read({}));
      expect(seen).toEqual(["2", "3"]);
      expect(notifications).toBe(2);
    }),
);
