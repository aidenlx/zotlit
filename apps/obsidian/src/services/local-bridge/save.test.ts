// The write boundary, driven the way the page drives it: the Hono app in
// process over a real Profile service and a fake vault.
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Scope } from "effect";
import { TestClock } from "effect/testing";
import { createHash } from "node:crypto";
import { expect, vi } from "vitest";

import { CONTRACT_VERSION } from "@zotlit/db";
import { LOCAL_BRIDGE_PATHS } from "@zotlit/workbench/bridge";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service";
import type { ResolvedProfile } from "@/services/profile/bindings";
import { Profile } from "@/services/profile/service";
import { Template } from "@/services/template/service";

import { createLocalBridgeApp } from "./app";
import { STABLE_DOCS_ORIGIN } from "./origins";
import type { LocalBridgeReads } from "./reads";
import { makeLocalBridgeSave } from "./save";
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

type SaveRequest = {
  reference: string;
  expected: { state: "absent" } | { state: "revision"; revision: string };
  source: string;
};

/** The JSON body of an answer. */
const json = (res: Response) => Effect.promise(() => res.json());

/**
 * The Local Bridge app over a Profile service built in the case, so the
 * Profile scan sleeps on the case's TestClock. The case's Scope disposes it.
 */
const harness = Effect.fnUntraced(function* (
  options: { files?: Record<string, string>; profileId?: string } = {},
) {
  const context = yield* Effect.context<never>();
  const fixture = yield* Effect.acquireDisposable(
    Effect.tryPromise(() =>
      profileServiceFixture(
        {
          [NOTE_PATH]: NOTE_SOURCE,
          ...(options.files ?? { [BOOKS_PATH]: BOOKS_SOURCE }),
        },
        undefined,
        context,
      ),
    ),
  );
  const services = yield* Effect.promise(() => fixture.runtime.context());
  const saved: string[] = [];
  const sessions = new BridgeSessions(() => {});
  const app = createLocalBridgeApp({
    available: () => true,
    enabled: () => true,
    peerAddress: () => "127.0.0.1",
    allowedOrigins: [STABLE_DOCS_ORIGIN],
    sessions,
    reads: {} as LocalBridgeReads,
    save: yield* makeLocalBridgeSave({
      pluginVersion: "2.1.1",
      onSaved: (profileId) => Effect.sync(() => saved.push(profileId)),
    }).pipe(
      Scope.provide(fixture.runtime.scope),
      Effect.provideContext(services),
    ),
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
    services,
    saved,
    /** One Save, with the TestClock run past the Profile scan it waits on. */
    save: Effect.fnUntraced(function* (request: SaveRequest) {
      const pending = yield* Effect.forkChild(
        Effect.promise(async () =>
          app.request(LOCAL_BRIDGE_PATHS.saveSelectedProfile, {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
              Origin: STABLE_DOCS_ORIGIN,
              Authorization: `Bearer ${credential}`,
            },
          }),
        ),
        { startImmediately: true },
      );
      yield* TestClock.adjust(500);
      yield* TestClock.adjust(500);
      return yield* Fiber.join(pending);
    }),
  };
});

type Harness = Effect.Success<ReturnType<typeof harness>>;

/** The Books document open in an editor holding `text`; its save writes the vault. */
function openInEditor(bridge: Harness, text: string) {
  const view = bridge.host.openInEditor(bridge.host.file(BOOKS_PATH));
  view.edit(text);
  const save = vi.spyOn(view, "save");
  return { view, save };
}

it.effect("writes the exact bytes of the draft and answers its revision", () =>
  Effect.gen(function* () {
    const bridge = yield* harness();

    const res = yield* bridge.save({
      reference: BOOKS_PROFILE,
      expected: { state: "revision", revision: REVISION.books },
      source: BOOKS_EDITED,
    });

    expect(res.status).toBe(200);
    expect(yield* json(res)).toEqual({
      state: "saved",
      revision: REVISION.booksEdited,
    });
    expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_EDITED);
    expect(bridge.saved).toEqual([BOOKS_PROFILE]);
    // A Save changes the template and nothing the template wrote.
    expect(bridge.vault.contents.get(NOTE_PATH)).toBe(NOTE_SOURCE);
  }),
);

it.effect("keeps a document's CRLF line endings, byte for byte", () =>
  Effect.gen(function* () {
    const bridge = yield* harness({
      files: { [BOOKS_PATH]: crlf(BOOKS_SOURCE) },
    });

    const res = yield* bridge.save({
      reference: BOOKS_PROFILE,
      expected: { state: "revision", revision: REVISION.booksCrlf },
      source: crlf(BOOKS_EDITED),
    });

    expect(yield* json(res)).toEqual({
      state: "saved",
      revision: REVISION.booksCrlfEdited,
    });
    const written = bridge.vault.contents.get(BOOKS_PATH);
    expect(written).toBe(crlf(BOOKS_EDITED));
    expect(written).toContain("\r\n");
  }),
);

it.effect(
  "refuses a stale revision with the one the vault holds, and writes nothing",
  () =>
    Effect.gen(function* () {
      const bridge = yield* harness();

      const res = yield* bridge.save({
        reference: BOOKS_PROFILE,
        expected: { state: "revision", revision: STALE_REVISION },
        source: BOOKS_EDITED,
      });

      expect(res.status).toBe(200);
      expect(yield* json(res)).toEqual({
        state: "refused",
        reason: "revision-conflict",
        currentRevision: REVISION.books,
      });
      expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
      expect(bridge.saved).toEqual([]);
    }),
);

it.effect(
  "refuses a Save the open editor's unsaved text has moved past, and writes nothing",
  () =>
    Effect.gen(function* () {
      const bridge = yield* harness();
      const unsaved = `${BOOKS_SOURCE}Unsaved line\n`;
      const editor = openInEditor(bridge, unsaved);

      const res = yield* bridge.save({
        reference: BOOKS_PROFILE,
        expected: { state: "revision", revision: REVISION.books },
        source: BOOKS_EDITED,
      });

      expect(yield* json(res)).toEqual({
        state: "refused",
        reason: "revision-conflict",
        currentRevision: createHash("sha256").update(unsaved).digest("hex"),
      });
      expect(editor.view.getViewData()).toBe(unsaved);
      expect(editor.save).not.toHaveBeenCalled();
      expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
    }),
);

it.effect("writes a Save of an open document through its editor", () =>
  Effect.gen(function* () {
    const bridge = yield* harness();
    const editor = openInEditor(bridge, BOOKS_SOURCE);

    const res = yield* bridge.save({
      reference: BOOKS_PROFILE,
      expected: { state: "revision", revision: REVISION.books },
      source: BOOKS_EDITED,
    });

    expect(yield* json(res)).toEqual({
      state: "saved",
      revision: REVISION.booksEdited,
    });
    expect(editor.view.getViewData()).toBe(BOOKS_EDITED);
    expect(editor.save).toHaveBeenCalledOnce();
    expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_EDITED);
  }),
);

it.effect(
  "ejects the built-in Default on its first Save and refuses a second creation",
  () =>
    Effect.gen(function* () {
      const bridge = yield* harness({ files: {}, profileId: "default" });
      expect(
        bridge.profile.bridge.runSync(bridge.profile.resolveProfile("default"))
          ?.document,
      ).toBeUndefined();

      const first = yield* bridge.save({
        reference: "default",
        expected: { state: "absent" },
        source: DEFAULT_DRAFT,
      });

      expect(yield* json(first)).toEqual({
        state: "saved",
        revision: REVISION.defaultDraft,
      });
      expect(bridge.vault.contents.get(DEFAULT_PATH)).toBe(DEFAULT_DRAFT);
      // The settings tab reads the registry, which carries the ejected document
      // without a reload because the Profile service observed the write.
      expect(
        bridge.profile.bridge.runSync(bridge.profile.resolveProfile("default"))
          ?.document,
      ).toBe("zotlit-profile.default.md");

      const second = yield* bridge.save({
        reference: "default",
        expected: { state: "absent" },
        source: DEFAULT_DRAFT.replace("name: Default", "name: Second"),
      });

      expect(yield* json(second)).toEqual({
        state: "refused",
        reason: "document-exists",
        currentRevision: REVISION.defaultDraft,
      });
      expect(bridge.vault.contents.get(DEFAULT_PATH)).toBe(DEFAULT_DRAFT);
      expect(bridge.saved).toEqual(["default"]);
    }),
);

it.effect(
  "refuses a source that does not parse and one that names another Profile",
  () =>
    Effect.gen(function* () {
      const bridge = yield* harness();

      const unparsable = yield* bridge.save({
        reference: BOOKS_PROFILE,
        expected: { state: "revision", revision: REVISION.books },
        source: "# Not a Profile document",
      });
      const foreign = yield* bridge.save({
        reference: BOOKS_PROFILE,
        expected: { state: "revision", revision: REVISION.books },
        source: DEFAULT_DRAFT,
      });

      expect(yield* json(unparsable)).toEqual({
        state: "refused",
        reason: "invalid-source",
      });
      expect(yield* json(foreign)).toEqual({
        state: "refused",
        reason: "invalid-source",
      });
      expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
      expect(bridge.saved).toEqual([]);
    }),
);

it.effect(
  "refuses an Eta document and one that computes a property in JavaScript",
  () =>
    Effect.gen(function* () {
      const bridge = yield* harness();

      const eta = yield* bridge.save({
        reference: BOOKS_PROFILE,
        expected: { state: "revision", revision: REVISION.books },
        source: BOOKS_SOURCE.replace(
          CONTRACT_STAMP,
          `${CONTRACT_STAMP}\nlanguage: eta`,
        ),
      });
      const javaScript = yield* bridge.save({
        reference: BOOKS_PROFILE,
        expected: { state: "revision", revision: REVISION.books },
        source: BOOKS_SOURCE.replace(
          CONTRACT_STAMP,
          `${CONTRACT_STAMP}\nfrontmatter:\n  - key: status\n    js: '"unread"'\n    merge: keep`,
        ),
      });

      expect(yield* json(eta)).toEqual({
        state: "refused",
        reason: "unsupported-profile",
      });
      expect(yield* json(javaScript)).toEqual({
        state: "refused",
        reason: "unsupported-profile",
      });
      expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
      expect(bridge.saved).toEqual([]);
    }),
);

it.effect(
  "refuses a document reference outside this Workbench Connection",
  () =>
    Effect.gen(function* () {
      const bridge = yield* harness();

      const res = yield* bridge.save({
        reference: "default",
        expected: { state: "revision", revision: REVISION.books },
        source: BOOKS_EDITED,
      });

      expect(res.status).toBe(403);
      expect(yield* json(res)).toEqual({
        error: {
          code: "document-reference-refused",
          message: expect.any(String),
        },
      });
      expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
    }),
);

it.effect(
  "refuses an installed Eta dependency without writing the Profile",
  () =>
    Effect.gen(function* () {
      const bridge = yield* harness({
        files: {
          [BOOKS_PATH]: BOOKS_SOURCE,
          "templates/zotlit-partial.byline.md":
            "---\nlanguage: eta\n---\n<%= it.zt.title %>",
        },
      });
      bridge.app.saveLocalStorage = vi.fn();
      yield* Template.use((template) =>
        template.setJavascriptTemplatesEnabled(true),
      ).pipe(Effect.provideContext(bridge.services));
      const res = yield* bridge.save({
        reference: BOOKS_PROFILE,
        expected: { state: "revision", revision: REVISION.books },
        source: BOOKS_EDITED.replace(
          "# {{ zt.title }}",
          "# {{ zt.title }}\n{% render 'byline' %}",
        ),
      });

      expect(yield* json(res)).toEqual({
        state: "refused",
        reason: "unsupported-profile",
      });
      expect(bridge.vault.contents.get(BOOKS_PATH)).toBe(BOOKS_SOURCE);
      expect(bridge.saved).toEqual([]);
    }),
);

/**
 * A Save over a Profile whose resolve and write the test holds, made in a
 * Scope the test closes the way the layer closes at unload.
 */
const heldSave = Effect.fnUntraced(function* (profile: {
  resolveProfile: Effect.Effect<ResolvedProfile | undefined>;
  saveSource: Effect.Effect<{ state: "saved"; revision: string }>;
}) {
  const scope = yield* Scope.make();
  const saved: string[] = [];
  const writes: string[] = [];
  const save = yield* makeLocalBridgeSave({
    pluginVersion: "2.1.1",
    onSaved: (profileId) => Effect.sync(() => saved.push(profileId)),
  }).pipe(
    Scope.provide(scope),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Profile, {
          resolveProfile: () => profile.resolveProfile,
          saveSource: (_selector, source) =>
            Effect.sync(() => writes.push(source)).pipe(
              Effect.andThen(profile.saveSource),
            ),
        }),
        Layer.mock(Template, {
          exportLiteratureNotePackSource: (source) => Effect.succeed(source),
        }),
      ),
    ),
  );
  return {
    saved,
    writes,
    answer: save.saveSelectedProfile(BOOKS_PROFILE, {
      reference: BOOKS_PROFILE,
      expected: { state: "revision", revision: REVISION.books },
      source: BOOKS_EDITED,
    }),
    unload: Scope.close(scope, Exit.void),
  };
});

const booksProfile = stubService<ResolvedProfile>("ResolvedProfile", {});

it.effect(
  "stops a Save that has not started writing when the plugin unloads",
  () =>
    Effect.gen(function* () {
      const resolving = yield* Deferred.make<void>();
      const held = yield* heldSave({
        resolveProfile: Deferred.succeed(resolving, undefined).pipe(
          Effect.andThen(Effect.never),
        ),
        saveSource: Effect.succeed({ state: "saved", revision: "unused" }),
      });
      yield* Deferred.await(resolving);

      yield* held.unload;

      yield* Effect.promise(() => expect(held.answer).rejects.toThrow());
      expect(held.writes).toEqual([]);
      expect(held.saved).toEqual([]);
    }),
);

it.effect(
  "finishes a Save that started writing before the unload, with its answer",
  () =>
    Effect.gen(function* () {
      const writing = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const held = yield* heldSave({
        resolveProfile: Effect.succeed(booksProfile),
        saveSource: Deferred.succeed(writing, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.as({
            state: "saved" as const,
            revision: REVISION.booksEdited,
          }),
        ),
      });
      yield* Deferred.await(writing);
      expect(held.writes).toEqual([BOOKS_EDITED]);

      // The unload interrupts the Save; the close is still waiting on the held
      // write once the interrupt has had virtual time to land.
      const closing = yield* Effect.forkChild(held.unload, {
        startImmediately: true,
      });
      const waited = yield* Fiber.join(closing).pipe(
        Effect.timeoutOption(10),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* TestClock.adjust(10);
      expect(yield* Fiber.join(waited)).toEqual(Option.none());

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(closing);

      expect(yield* Effect.promise(() => held.answer)).toEqual({
        state: "saved",
        revision: REVISION.booksEdited,
      });
      expect(held.saved).toEqual([BOOKS_PROFILE]);
    }),
);
