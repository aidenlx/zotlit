import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { planItemFilter, queryItemFrom } from "@zotlit/item-query";
import type { LanguagePack } from "@zotlit/obsidian-i18n";

import { Effect, Fiber } from "@/lib/effect";
import { acquireAsyncDisposable, acquireDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";
import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import chinesePack from "@/lib/i18n/generated/zh-CN.json";
import type { ProfileId } from "@/lib/profile-stamp";

import { profileServiceFixture } from "./__fixtures__/service";

const id = "Bk3Qn7XvT2Lp" as ProfileId;
const path = "templates/zotlit-profile.books.md";
const beforeMatch = `---\r
# Shared by the reading group\r
id: Bk3Qn7XvT2Lp\r
name: 'Books'\r
version: 1.0.0 # release\r
contract: 2\r
filename: '{{ zt.title }}'\r
folder: Books\r
importFolder: Imported\r
citationStyle: null\r
importColoredHighlights: false\r
importAnnotationsAsTemplate: false\r
# Conditions travel by name\r
`;
const match = `match:\r
  and:\r
    - 'library == "group:987654"'\r
    - 'collections.within("Foreign/Reading")'\r
    - 'tags.contains("Unfamiliar tag")'\r
`;
const afterMatch = `# Keep this comment and body\r
---\r
# {{ zt.title }}\n{% managed %}Reading notes{% endmanaged %}\r
--- zotlit:annotation ---\nAnnotation`;
const source = beforeMatch + match + afterMatch;

it.effect.each([true, false, undefined])(
  "shares exact match bytes with includeMatch=%s and leaves the source version and match intact",
  (includeMatch) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture({ [path]: source }, undefined, context),
      );
      const plan = yield* Effect.promise(() => f.profile.prepareShare(id));
      const output = plan.render({
        version: "1.0.1",
        author: "",
        description: "",
        includeFolders: true,
        includeMatch,
      });
      expect(output).toBe(
        beforeMatch.replace("version: 1.0.0", 'version: "1.0.1"') +
          (includeMatch === false ? "" : match) +
          afterMatch,
      );
      expect(f.vault.contents.get(path)).toBe(source);
    }),
);

it.effect.each([true, false])(
  "strips only folder bindings and the requested match for share includeMatch=%s",
  (includeMatch) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture({ [path]: source }, undefined, context),
      );
      const plan = yield* Effect.promise(() => f.profile.prepareShare(id));
      expect(
        plan.render({
          version: "1.0.0",
          author: "",
          description: "",
          includeMatch,
        }),
      ).toBe(
        beforeMatch.replace("folder: Books\r\nimportFolder: Imported\r\n", "") +
          (includeMatch ? match : "") +
          afterMatch,
      );
    }),
);

it.effect.each([
  { held: false, includeMatch: true },
  { held: false, includeMatch: false },
  { held: false, includeMatch: undefined },
  { held: true, includeMatch: true },
  { held: true, includeMatch: false },
  { held: true, includeMatch: undefined },
])(
  "imports exact incoming bytes for $held replacement with includeMatch=$includeMatch",
  ({ held, includeMatch }) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture(
          held ? { [path]: source.replace("1.0.0", "0.9.0") } : {},
          undefined,
          context,
        ),
      );
      const before = new Map(f.vault.contents);
      const plan = yield* Effect.promise(() =>
        f.profile.prepareImport(source, { includeMatch }),
      );
      const expected =
        beforeMatch + (includeMatch === false ? "" : match) + afterMatch;
      expect(plan.kind).toBe(held ? "replace" : "fresh");
      expect(plan.source).toBe(expected);
      expect(f.vault.contents).toEqual(before);
      const imported = yield* settled(() => plan.import());
      expect(f.vault.contents.get(imported.path)).toBe(expected);
      // An unknown Library is an ordinary nonmatch.
      expect(imported.match.state).toBe(
        includeMatch === false ? "absent" : "evaluable",
      );
    }),
);

it.effect(
  "keeps an absent match byte-identical on import and applies only selected binding changes",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture(undefined, undefined, context),
      );
      const absent = beforeMatch + afterMatch;
      expect(
        (yield* Effect.promise(() =>
          f.profile.prepareImport(absent, { includeMatch: false }),
        )).source,
      ).toBe(absent);
      const plan = yield* Effect.promise(() =>
        f.profile.prepareImport(source, {
          folder: "Recipient",
          stripFolders: true,
          inheritCitationStyle: true,
        }),
      );
      const expected =
        beforeMatch
          .replace(
            "folder: Books\r\nimportFolder: Imported\r\n",
            'folder: "Recipient"\r\n',
          )
          .replace("citationStyle: null\r\n", "") +
        match +
        afterMatch;
      expect(plan.source).toBe(expected);
      const imported = yield* settled(() => plan.import());
      expect(f.vault.contents.get(imported.path)).toBe(expected);
    }),
);

it.effect(
  "imports an unknown collection and tag unchanged as an ordinary nonmatch",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture(undefined, undefined, context),
      );
      const source = `${beforeMatch}match: 'collections.within("Foreign/Reading") && tags.contains("Unfamiliar tag")'\r\n${afterMatch}`;
      const imported = yield* settled(async () =>
        (await f.profile.prepareImport(source)).import(),
      );
      expect(f.vault.contents.get(imported.path)).toBe(source);
      expect(imported.match.state).toBe("evaluable");
      const planned = planItemFilter(
        imported.match.state === "evaluable" ? imported.match.filter : "",
      );
      if (!("matches" in planned)) throw new Error(planned.message);
      expect(
        planned.matches(
          queryItemFrom({
            scan: {
              itemID: 1,
              key: "BOOK2345",
              itemType: "book",
              dateAdded: null,
              dateModified: null,
            },
            groupID: null,
            fields: {},
            custom: {},
            customFieldNames: [],
            creators: [],
            tags: [{ name: "Reading", type: 0 }],
            collections: [["Local", "Reading"]],
          }),
        ),
      ).toBe(false);
    }),
);

it.effect(
  "allows changed Share metadata after omitting an aliased match, while retaining the source",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const source = `${beforeMatch}author: &condition 'tags.contains("Reading")'\r\nmatch: *condition\r\n${afterMatch}`;
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture({ [path]: source }, undefined, context),
      );
      const plan = yield* Effect.promise(() => f.profile.prepareShare(id));
      const options = {
        version: "1.0.0",
        author: "Another author",
        description: "",
        includeFolders: true,
      };
      expect(() => plan.render(options)).toThrow(
        m.profile_match_metadata_changed(),
      );
      expect(plan.render({ ...options, includeMatch: false })).toBe(
        `${beforeMatch}author: &condition "Another author"\r\n${afterMatch}`,
      );
      expect(f.vault.contents.get(path)).toBe(source);
    }),
);

it.effect.each([true, false])(
  "imports after removing both aliased folder bindings with includeMatch=%s",
  (includeMatch) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const source =
        beforeMatch.replace(
          "folder: Books\r\nimportFolder: Imported\r\n",
          "folder: &notes Books\r\nimportFolder: *notes\r\n",
        ) +
        match +
        afterMatch;
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture(undefined, undefined, context),
      );
      const plan = yield* Effect.promise(() =>
        f.profile.prepareImport(source, {
          stripFolders: true,
          includeMatch,
        }),
      );
      const expected =
        beforeMatch.replace("folder: Books\r\nimportFolder: Imported\r\n", "") +
        (includeMatch ? match : "") +
        afterMatch;
      expect(plan.source).toBe(expected);
      const imported = yield* settled(() => plan.import());
      expect(f.vault.contents.get(imported.path)).toBe(expected);
    }),
);

it.effect(
  "uses the active language for Share and Import match-alias errors",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const cleanup = yield* acquireDisposable(() => new DisposableStack());
      cleanup.defer(() => runtime.reset());
      runtime.install(chinesePack as LanguagePack);
      const source = `${beforeMatch}author: &condition 'tags.contains("Reading")'\r\nmatch: *condition\r\n${afterMatch}`;
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture({ [path]: source }, undefined, context),
      );
      const plan = yield* Effect.promise(() => f.profile.prepareShare(id));
      expect(runtime.getLocale()).toBe("zh-CN");
      expect(m.profile_match_metadata_changed()).toBe(
        chinesePack.messages.profile_match_metadata_changed,
      );
      expect(() =>
        plan.render({
          version: "1.0.0",
          author: "Another author",
          description: "",
          includeFolders: true,
        }),
      ).toThrow(m.profile_match_metadata_changed());
      const incoming = `${beforeMatch.replace(
        "folder: Books",
        `folder: &condition 'tags.contains("Reading")'`,
      )}match: *condition\r\n${afterMatch}`;
      yield* Effect.promise(() =>
        expect(
          f.profile.prepareImport(incoming, { folder: "Recipient" }),
        ).rejects.toThrow(m.profile_match_metadata_changed()),
      );
    }),
);

it.effect(
  "shares after omitting a match and its cleared metadata aliases together",
  () =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const source = `${beforeMatch}match: &condition "true"\r\nauthor: *condition\r\n${afterMatch}`;
      const f = yield* acquireAsyncDisposable(() =>
        profileServiceFixture({ [path]: source }, undefined, context),
      );
      const plan = yield* Effect.promise(() => f.profile.prepareShare(id));
      expect(
        plan.render({
          version: "1.0.0",
          author: "",
          description: "",
          includeFolders: true,
          includeMatch: false,
        }),
      ).toBe(beforeMatch + afterMatch);
      expect(f.vault.contents.get(path)).toBe(source);
    }),
);

const settled = Effect.fnUntraced(function* <A>(operation: () => Promise<A>) {
  const pending = yield* Effect.promise(operation).pipe(Effect.forkChild);
  yield* TestClock.adjust(500);
  return yield* Fiber.join(pending);
});
