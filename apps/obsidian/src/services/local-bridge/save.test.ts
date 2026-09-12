// The write boundary, driven the way the page drives it: the Hono app in
// process over a real Profile service and a fake vault.

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import { LOCAL_BRIDGE_PATHS } from "@zotlit/workbench/bridge";

import { profileServiceFixture } from "@/services/profile/__fixtures__/service";

import { createLocalBridgeApp } from "./app";
import { STABLE_DOCS_ORIGIN } from "./origins";
import type { LocalBridgeReads } from "./reads";
import { createLocalBridgeSave } from "./save";
import { BridgeSessions } from "./sessions";

const BOOKS_PROFILE = "Bk7Qm2Xr9Tz4";
const BOOKS_PATH = "templates/zotlit-profile.books.md";
const DEFAULT_PATH = "templates/zotlit-profile.default.md";
const NOTE_PATH = "literatures/An exported paper.md";
const NOTE_SOURCE = "---\nzotero-key: MAIN2345\n---\n# An exported paper\n";

/** The manifest line a web-supported Profile carries. */
const CONTRACT_STAMP = `contract: ${CONTRACT_VERSION}`;

/** The Profile document the vault holds, as the page loaded it. */
const BOOKS_SOURCE = `---
id: ${BOOKS_PROFILE}
name: Books
version: 1.0.0
contract: ${CONTRACT_VERSION}
filename: '{{ zt.title }}'
---
# {{ zt.title }}

--- zotlit:annotation ---
{{ zt.text }}
`;
/** The same document after one edit on the page. */
const BOOKS_EDITED = BOOKS_SOURCE.replace(
  "# {{ zt.title }}",
  "# {{ zt.title }}\n\n{{ zt.citationKey }}",
);
/** The draft a first Save of the built-in Default submits. */
const DEFAULT_DRAFT = BOOKS_SOURCE.replace(
  `id: ${BOOKS_PROFILE}\nname: Books`,
  "id: default\nname: Default",
);

const crlf = (source: string): string => source.replaceAll("\n", "\r\n");

/**
 * The revisions of the documents above, each one `shasum -a 256` over the exact
 * bytes rather than the plugin's own hash of them.
 */
const REVISION = {
  books: "fb6852caecea54b786922f956716729cebf41b7ad4c3ae77171094ba6128fffc",
  booksEdited:
    "b2a6dc511ecac6497c79fd02f96eb2e85bca467de477cef4e6a2f5d136499d6e",
  booksCrlf: "ad6bf5cc6c584f012fa76fcdf0f2e0f34b285d6d869816522fe52f4e44033193",
  booksCrlfEdited:
    "6d6e5befd81c1f8cb5c8b22353225c18f322c5036073e469e56fb12ac697d3a2",
  defaultDraft:
    "dc2b9c7053fb0f0c56fb7f07d0477fc912ab65fb491fd6e11d6c00e85b219e54",
} as const;

/** A revision no document in this vault has. */
const STALE_REVISION = "0".repeat(64);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type SaveRequest = {
  reference: string;
  expected: { state: "absent" } | { state: "revision"; revision: string };
  source: string;
};

async function harness(
  options: { files?: Record<string, string>; profileId?: string } = {},
) {
  const fixture = await profileServiceFixture({
    [NOTE_PATH]: NOTE_SOURCE,
    ...(options.files ?? { [BOOKS_PATH]: BOOKS_SOURCE }),
  });
  const saved: string[] = [];
  const sessions = new BridgeSessions(() => {});
  const app = createLocalBridgeApp({
    available: () => true,
    enabled: () => true,
    peerAddress: () => "127.0.0.1",
    allowedOrigins: [STABLE_DOCS_ORIGIN],
    sessions,
    reads: {} as LocalBridgeReads,
    save: createLocalBridgeSave({
      profile: fixture.profile,
      template: fixture.template,
      pluginVersion: "2.1.1",
      onSaved: (profileId) => saved.push(profileId),
    }),
    describeGrant: () => Promise.reject(new Error("not used here")),
  });
  const code = sessions.mintCode({
    origin: STABLE_DOCS_ORIGIN,
    profileId: options.profileId ?? BOOKS_PROFILE,
    item: null,
  });
  const credential = sessions.exchange(code, STABLE_DOCS_ORIGIN)!.credential;

  return {
    ...fixture,
    saved,
    /** One Save, with the timers the Profile scan waits on run for it. */
    async save(request: SaveRequest): Promise<Response> {
      const pending = app.request(LOCAL_BRIDGE_PATHS.saveSelectedProfile, {
        method: "POST",
        body: JSON.stringify(request),
        headers: {
          Origin: STABLE_DOCS_ORIGIN,
          Authorization: `Bearer ${credential}`,
        },
      });
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);
      return await pending;
    },
  };
}

it("writes the exact bytes of the draft and answers its revision", async () => {
  await using bridge = await harness();

  const res = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: REVISION.books },
    source: BOOKS_EDITED,
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({
    state: "saved",
    revision: REVISION.booksEdited,
  });
  expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_EDITED);
  expect(bridge.saved).toEqual([BOOKS_PROFILE]);
  // A Save changes the template and nothing the template wrote.
  expect(bridge.vault.contents.get(NOTE_PATH)).toBe(NOTE_SOURCE);
});

it("keeps a document's CRLF line endings, byte for byte", async () => {
  await using bridge = await harness({
    files: { [BOOKS_PATH]: crlf(BOOKS_SOURCE) },
  });

  const res = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: REVISION.booksCrlf },
    source: crlf(BOOKS_EDITED),
  });

  await expect(res.json()).resolves.toEqual({
    state: "saved",
    revision: REVISION.booksCrlfEdited,
  });
  const written = bridge.vault.contents.get(BOOKS_PATH);
  expect(written).toBe(crlf(BOOKS_EDITED));
  expect(written).toContain("\r\n");
});

it("refuses a stale revision with the one the vault holds, and writes nothing", async () => {
  await using bridge = await harness();

  const res = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: STALE_REVISION },
    source: BOOKS_EDITED,
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({
    state: "refused",
    reason: "revision-conflict",
    currentRevision: REVISION.books,
  });
  expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
  expect(bridge.saved).toEqual([]);
});

it("ejects the built-in Default on its first Save and refuses a second creation", async () => {
  await using bridge = await harness({ files: {}, profileId: "default" });
  expect(bridge.profile.resolveProfile("default")?.document).toBeUndefined();

  const first = await bridge.save({
    reference: "default",
    expected: { state: "absent" },
    source: DEFAULT_DRAFT,
  });

  await expect(first.json()).resolves.toEqual({
    state: "saved",
    revision: REVISION.defaultDraft,
  });
  expect(bridge.vault.contents.get(DEFAULT_PATH)).toBe(DEFAULT_DRAFT);
  // The settings tab reads the registry, which carries the ejected document
  // without a reload because the Profile service observed the write.
  expect(bridge.profile.resolveProfile("default")?.document).toBe(
    "zotlit-profile.default.md",
  );

  const second = await bridge.save({
    reference: "default",
    expected: { state: "absent" },
    source: DEFAULT_DRAFT.replace("name: Default", "name: Second"),
  });

  await expect(second.json()).resolves.toEqual({
    state: "refused",
    reason: "document-exists",
    currentRevision: REVISION.defaultDraft,
  });
  expect(bridge.vault.contents.get(DEFAULT_PATH)).toBe(DEFAULT_DRAFT);
  expect(bridge.saved).toEqual(["default"]);
});

it("refuses a source that does not parse and one that names another Profile", async () => {
  await using bridge = await harness();

  const unparsable = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: REVISION.books },
    source: "# Not a Profile document",
  });
  const foreign = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: REVISION.books },
    source: DEFAULT_DRAFT,
  });

  await expect(unparsable.json()).resolves.toEqual({
    state: "refused",
    reason: "invalid-source",
  });
  await expect(foreign.json()).resolves.toEqual({
    state: "refused",
    reason: "invalid-source",
  });
  expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
  expect(bridge.saved).toEqual([]);
});

it("refuses an Eta document and one that computes a property in JavaScript", async () => {
  await using bridge = await harness();

  const eta = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: REVISION.books },
    source: BOOKS_SOURCE.replace(
      CONTRACT_STAMP,
      `${CONTRACT_STAMP}\nlanguage: eta`,
    ),
  });
  const javaScript = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: REVISION.books },
    source: BOOKS_SOURCE.replace(
      CONTRACT_STAMP,
      `${CONTRACT_STAMP}\nfrontmatter:\n  - key: status\n    js: '"unread"'\n    merge: keep`,
    ),
  });

  await expect(eta.json()).resolves.toEqual({
    state: "refused",
    reason: "unsupported-profile",
  });
  await expect(javaScript.json()).resolves.toEqual({
    state: "refused",
    reason: "unsupported-profile",
  });
  expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
  expect(bridge.saved).toEqual([]);
});

it("refuses a document reference outside this Workbench Connection", async () => {
  await using bridge = await harness();

  const res = await bridge.save({
    reference: "default",
    expected: { state: "revision", revision: REVISION.books },
    source: BOOKS_EDITED,
  });

  expect(res.status).toBe(403);
  await expect(res.json()).resolves.toEqual({
    error: { code: "document-reference-refused", message: expect.any(String) },
  });
  expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
});

it("refuses an installed Eta dependency without writing the Profile", async () => {
  await using bridge = await harness({
    files: {
      [BOOKS_PATH]: BOOKS_SOURCE,
      "templates/zotlit-partial.byline.md":
        "---\nlanguage: eta\n---\n<%= it.zt.title %>",
    },
  });
  bridge.app.saveLocalStorage = vi.fn();
  await bridge.template.setJavascriptTemplatesEnabled(true);
  const res = await bridge.save({
    reference: BOOKS_PROFILE,
    expected: { state: "revision", revision: REVISION.books },
    source: BOOKS_EDITED.replace(
      "# {{ zt.title }}",
      "# {{ zt.title }}\n{% render 'byline' %}",
    ),
  });

  await expect(res.json()).resolves.toEqual({
    state: "refused",
    reason: "unsupported-profile",
  });
  expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
  expect(bridge.saved).toEqual([]);
});
