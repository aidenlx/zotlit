import { expect, it } from "vitest";

import type { LanguagePack } from "@zotlit/obsidian-i18n";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import chinesePack from "@/lib/i18n/generated/zh-CN.json";
import type { ProfileId } from "@/lib/profile-stamp";
import { selectProfileByMatch } from "@/services/profile-selection";

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

it.each([true, false, undefined])(
  "shares exact match bytes with includeMatch=%s and leaves the source version and match intact",
  async (includeMatch) => {
    await using f = await profileServiceFixture({ [path]: source });
    const plan = await f.profile.prepareShare(id);
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
  },
);

it.each([true, false])(
  "strips only folder bindings and the requested match for share includeMatch=%s",
  async (includeMatch) => {
    await using f = await profileServiceFixture({ [path]: source });
    const plan = await f.profile.prepareShare(id);
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
  },
);

it.each([
  { held: false, includeMatch: true },
  { held: false, includeMatch: false },
  { held: false, includeMatch: undefined },
  { held: true, includeMatch: true },
  { held: true, includeMatch: false },
  { held: true, includeMatch: undefined },
])(
  "imports exact incoming bytes for $held replacement with includeMatch=$includeMatch",
  async ({ held, includeMatch }) => {
    await using f = await profileServiceFixture(
      held ? { [path]: source.replace("1.0.0", "0.9.0") } : {},
    );
    const before = new Map(f.vault.contents);
    const plan = await f.profile.prepareImport(source, { includeMatch });
    const expected =
      beforeMatch + (includeMatch === false ? "" : match) + afterMatch;
    expect(plan.kind).toBe(held ? "replace" : "fresh");
    expect(plan.source).toBe(expected);
    expect(f.vault.contents).toEqual(before);
    const imported = await plan.import();
    expect(f.vault.contents.get(imported.path)).toBe(expected);
    if (includeMatch === false) expect(imported.match.state).toBe("absent");
    else
      expect(imported.match).toMatchObject({
        state: "unevaluable",
        problem: { code: "unknown-library", text: '"group:987654"' },
      });
  },
);

it("keeps an absent match byte-identical on import and applies only selected binding changes", async () => {
  await using f = await profileServiceFixture();
  const absent = beforeMatch + afterMatch;
  expect(
    (await f.profile.prepareImport(absent, { includeMatch: false })).source,
  ).toBe(absent);
  const plan = await f.profile.prepareImport(source, {
    folder: "Recipient",
    stripFolders: true,
    inheritCitationStyle: true,
  });
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
  const imported = await plan.import();
  expect(f.vault.contents.get(imported.path)).toBe(expected);
});

it("imports an unknown collection and tag unchanged as an ordinary nonmatch", async () => {
  await using f = await profileServiceFixture();
  const source = `${beforeMatch}match: 'collections.within("Foreign/Reading") && tags.contains("Unfamiliar tag")'\r\n${afterMatch}`;
  const imported = await (await f.profile.prepareImport(source)).import();
  expect(f.vault.contents.get(imported.path)).toBe(source);
  expect(imported.match.state).toBe("evaluable");
  expect(
    selectProfileByMatch(f.profile.profiles, {
      library: { type: "personal" },
      itemType: "book",
      collections: [["Local", "Reading"]],
      tags: ["Reading"],
    }),
  ).toEqual({ outcome: "unmatched" });
});

it("allows changed Share metadata after omitting an aliased match, while retaining the source", async () => {
  const source = `${beforeMatch}author: &condition 'tags.contains("Reading")'\r\nmatch: *condition\r\n${afterMatch}`;
  await using f = await profileServiceFixture({ [path]: source });
  const plan = await f.profile.prepareShare(id);
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
});

it.each([true, false])(
  "imports after removing both aliased folder bindings with includeMatch=%s",
  async (includeMatch) => {
    const source =
      beforeMatch.replace(
        "folder: Books\r\nimportFolder: Imported\r\n",
        "folder: &notes Books\r\nimportFolder: *notes\r\n",
      ) +
      match +
      afterMatch;
    await using f = await profileServiceFixture();
    const plan = await f.profile.prepareImport(source, {
      stripFolders: true,
      includeMatch,
    });
    const expected =
      beforeMatch.replace("folder: Books\r\nimportFolder: Imported\r\n", "") +
      (includeMatch ? match : "") +
      afterMatch;
    expect(plan.source).toBe(expected);
    const imported = await plan.import();
    expect(f.vault.contents.get(imported.path)).toBe(expected);
  },
);

it("uses the active language for Share and Import match-alias errors", async () => {
  using cleanup = new DisposableStack();
  cleanup.defer(() => runtime.reset());
  runtime.install(chinesePack as LanguagePack);
  const source = `${beforeMatch}author: &condition 'tags.contains("Reading")'\r\nmatch: *condition\r\n${afterMatch}`;
  await using f = await profileServiceFixture({ [path]: source });
  const plan = await f.profile.prepareShare(id);
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
  await expect(
    f.profile.prepareImport(incoming, { folder: "Recipient" }),
  ).rejects.toThrow(m.profile_match_metadata_changed());
});

it("shares after omitting a match and its cleared metadata aliases together", async () => {
  const source = `${beforeMatch}match: &condition "true"\r\nauthor: *condition\r\n${afterMatch}`;
  await using f = await profileServiceFixture({ [path]: source });
  const plan = await f.profile.prepareShare(id);
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
});
