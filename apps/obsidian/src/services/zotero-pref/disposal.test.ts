import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { zoteroPrefFixture } from "./__fixtures__";

// #1705: unload can leave consumers holding the native service after runtime disposal.
it.effect(
  "keeps released reads and no-op writes after the whole runtime closes",
  () =>
    Effect.gen(function* () {
      const f = yield* zoteroPrefFixture(() =>
        Effect.succeed(
          'user_pref("extensions.zotero.baseAttachmentPath", "/attachments");',
        ),
      );
      const pref = f.pref;
      // No intervening native service read: the retained snapshot must include this write.
      yield* pref.setDataDir("/last-data");
      yield* f.runtime.disposeEffect;
      const last = yield* f.pref.current;
      expect(last.dataDir).toBe("/last-data");
      expect(yield* pref.get("baseAttachmentPath")).toBe("/attachments");
      expect(yield* pref.get("missing")).toBeUndefined();
      expect(yield* pref.setDataDir("/after-close")).toBeUndefined();
      expect(yield* pref.setProfileDir("/after-close")).toBeUndefined();
      expect(yield* pref.current).toEqual(last);
      expect(f.saved()).toEqual({
        profileDir: "/profile",
        dataDir: "/last-data",
      });
    }),
);
