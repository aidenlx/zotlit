import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { zoteroPrefFixture } from "./__fixtures__";
import { plainZoteroPref } from "./plain";

// #1705: unload can leave consumers holding the adapter after runtime disposal.
it.effect(
  "keeps released reads and no-op writes after the whole runtime closes",
  () =>
    Effect.gen(function* () {
      const f = yield* zoteroPrefFixture(() =>
        Effect.succeed(
          'user_pref("extensions.zotero.baseAttachmentPath", "/attachments");',
        ),
      );
      const plain = plainZoteroPref(f.runtime);
      // No intervening adapter read: the retained snapshot must include this write.
      plain.setDataDir("/last-data");
      yield* f.runtime.disposeEffect;
      const last = yield* f.pref.current;
      const {
        prefs: _prefs,
        profileDirOverride: _profileDirOverride,
        ...snapshot
      } = last;
      expect(plain).toMatchObject(snapshot);
      expect(plain.dataDir).toBe("/last-data");
      expect(plain.get("baseAttachmentPath")).toBe("/attachments");
      expect(plain.get("missing")).toBeUndefined();
      expect(plain.setDataDir("/after-close")).toBeUndefined();
      expect(plain.setProfileDir("/after-close")).toBeUndefined();
      expect(plain.dataDir).toBe("/last-data");
      expect(f.saved()).toEqual({
        profileDir: "/profile",
        dataDir: "/last-data",
      });
    }),
);
