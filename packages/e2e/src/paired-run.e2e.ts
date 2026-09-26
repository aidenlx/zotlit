// The Paired Run scenario — ZotLit in a real desktop Obsidian window and a
// real Zotero serving its Local API on the same Fixture. Run it with
// `pnpm e2e`; see packages/e2e/AGENTS.md.
//
// Each run opens a Paired Run of its own (`openPairedEnvironment`): a new
// Fixture, a new purged vault, and a Paired Zotero started on them, all
// disposed when the file ends. Every test therefore starts from the Fixture
// Spec, and a developer's own Paired Run stays as it is.
//
// Skips cleanly (not fails) when no desktop Obsidian answers, decided at module
// scope before collection.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { ANNOTATIONS, ATTACHMENTS } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { keepRendering } from "./background-throttling.ts";
import { verifySavedEditDisplay } from "./excerpt-acceptance.ts";
import { verifyExcerptRefresh } from "./excerpt-refresh.ts";
import {
  verifyExcerptRendering,
  verifyZoteroExcerptParity,
} from "./excerpt-rendering.ts";
import { cli, obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
import { openPairedEnvironment } from "./paired-environment.ts";
import {
  authorizationCount,
  authorize,
  clickAuthorizationDialog,
  denyAnyAuthorizationDialog,
  dismissAuthorizationDialog,
  eraseAnnotations,
  freshAnnotationKey,
  grantRememberedKey,
  heldAnnotationKeys,
  openZoteroRdp,
  readerAnnotation,
  readerSettled,
  readServerID,
  resetAuthorizations,
  restorePrompt,
  storedAnnotation,
  stubPrompt,
  waitForAuthorizationDialog,
  zoteroFetch,
} from "./paired-zotero.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";
import {
  armToolOnFirstPage,
  capabilityOf,
  clientOfFirstPage,
  disarmTool,
  expectEditorKeepsSelections,
  FIRE,
  pageContainerOf,
  pdfViewOf,
  POPUP_EDITOR,
  raiseWindow,
  recomputedSortIndex,
  reopenPdfView,
  settledGesture,
  TAP,
  toolButtonOf,
  watchExcerptPixels,
} from "./reader-gestures.ts";
import { isObsidianReachable } from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

/** The Fixture Attachment this scenario reads, writes and never rewrites. */
const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
/** Its vault-relative path: the Fixture declares it as a `vault`-rooted link. */
const attachmentPath = attachment.path!;
/** Every Annotation the Fixture seeds, by key. */
const SEEDED_KEYS = ANNOTATIONS.map(({ key }) => key);
/** One Annotation the Fixture Spec declares on it, as a read oracle. */
const seededAnnotation = ANNOTATIONS.find(
  ({ parentItemID }) => parentItemID === attachment.itemID,
)!;

/** The name ZotLit's own writes would not use, so a seeded key is telling. */
const APP_NAME = "ZotLit End-to-end Run";

/** Zotero issues exactly 32 characters, from `Zotero.Utilities.randomString`. */
const KEY_SHAPE = expect.stringMatching(
  /^[0-9A-Za-z]{32}$/,
) as unknown as string;

const environment = (await isObsidianReachable(workspaceRoot))
  ? await openPairedEnvironment(workspaceRoot)
  : null;
// File scope, so it runs after every suite's own `afterAll` has used the run.
afterAll(async () => {
  await environment?.[Symbol.asyncDispose]();
}, 120000);
const vaultId = environment?.vaultId ?? null;

function obJson<T>(code: string): Promise<T> {
  return obEval(vaultId!, code).then((reply) => JSON.parse(reply) as T);
}

const baseUrl = environment?.baseUrl ?? null;
const debuggerPort = environment?.debuggerPort ?? null;

describe.skipIf(!baseUrl)("Paired Run", () => {
  const api = baseUrl!;
  let serverID = "";
  let authorizationFixture: { secret: string; rdp: ZoteroRdp } | undefined;

  beforeAll(async () => {
    serverID = await readServerID(api);
    authorizationFixture = {
      // The vault half of the seeded Write Authorization. Each tier that
      // clears Zotero's keys puts a new key into it afterward.
      secret: await obJson<string>(
        `JSON.stringify(app.secretStorage.getSecret('zotlit-zotero-write-authorization'))`,
      ),
      rdp: await openZoteroRdp(debuggerPort!),
    };
  });

  // The run seldom shows the vault's windows, and a hidden window gets no
  // animation frames. The windows close with the vault when the run ends.
  beforeAll(async () => {
    await keepRendering(vaultId!);
  });

  const prepareAuthorizationFixture = async (): Promise<void> => {
    if (!authorizationFixture) return;
    const { secret, rdp } = authorizationFixture;
    await restorePrompt(rdp);
    const key = await grantRememberedKey(api, rdp, {
      serverID,
      appName: "ZotLit Fixture",
    });
    await obEval(
      vaultId!,
      `(function(){const record=JSON.parse(${JSON.stringify(secret)});record.key=${JSON.stringify(key)};app.secretStorage.setSecret('zotlit-zotero-write-authorization',JSON.stringify(record));return true;})()`,
    );
  };

  afterAll(() => {
    authorizationFixture?.rdp[Symbol.dispose]();
  });

  // ── Tier 1 ────────────────────────────────────────────────────────────────
  // The Local API alone, no dialog and no debugging port: the read contract
  // every other tier stands on.
  describe("Tier 1 — the Local API read contract", () => {
    it("refuses browser traffic and answers the same read when allowed", async () => {
      // Zotero closes the connection on an `Origin` header, so the caller sees
      // a network failure with no status at all.
      await expect(
        fetch(new URL("users/0/items?limit=1", api), {
          headers: { Origin: "app://obsidian.md" },
        }),
      ).rejects.toThrow();

      const allowed = await zoteroFetch(api, "users/0/items?limit=1");
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("Zotero-Server-ID")).toBe(serverID);
    });

    it("lists the Fixture Attachment's Annotations under a stable sort", async () => {
      // `itemType=annotation` is load-bearing: without it the children route
      // answers an empty list for an Attachment, whatever it holds.
      // `dateModified` is the route's default sort and an edit reorders it
      // between pages, so every paged read names `dateAdded` instead.
      const keys = await annotationKeys(api, serverID, attachment.key);
      expect(keys).toContain(seededAnnotation.key);
    });

    it("serves another Attachment's Annotations for a key outside Zotero's alphabet", async () => {
      // `0`, `1`, `I` and `O` are not in Zotero's item-key alphabet, and such a
      // key is rejected silently during the lookup. The read does NOT answer an
      // empty list — it drops the parent constraint and answers every
      // Annotation in the library. Measured against Zotero 10.0, schema 44, on
      // 2026-09-17: `items/RGRPDF10/children?itemType=annotation` answered 200
      // with ten records whose `parentItem` spanned three different
      // Attachments. So a malformed key silently serves the wrong document's
      // Annotations, which is why `parseIndexedKey` has to reject one before
      // ZotLit ever sends the request.
      // @see https://github.com/aidenlx/zotlit/issues/1139
      const stray = await annotationParents(api, serverID, "RGRPDF10");
      const own = await annotationParents(api, serverID, attachment.key);
      expect(new Set(stray).size).toBeGreaterThan(1);
      expect(new Set(stray)).not.toEqual(new Set(own));
      expect(stray.length).toBeGreaterThan(own.length);

      // A key Zotero *could* have produced but did not is the empty answer,
      // and that contrast is what makes the case above a silent mix-up rather
      // than an ordinary miss.
      await expect(annotationKeys(api, serverID, "ZZZZZZZZ")).resolves.toEqual(
        [],
      );
    });

    it("answers 412 when the Zotero-Server-ID names another database", async () => {
      const reply = await zoteroFetch(api, "users/0/items?limit=1", {
        headers: { "Zotero-Server-ID": "AAAAAAAAAAAA" },
      });
      expect(reply.status).toBe(412);
    });
  });

  // ── Tier 2 ────────────────────────────────────────────────────────────────
  // The RDP stub (Route A): every authorization branch, driven through a real
  // `POST /api/local/authorize`. The stub picks the branch; the endpoint and
  // `getAuthorizationCount()` are the oracles.
  describe("Tier 2 — the authorization branches", () => {
    let rdp: ZoteroRdp;

    beforeAll(async () => {
      rdp = await openZoteroRdp(debuggerPort!);
    });

    afterEach(async () => {
      const restored = await restorePrompt(rdp);
      expect(restored).toEqual({ original: true, leftovers: [] });
      await resetAuthorizations(rdp);
    });

    afterAll(async () => {
      try {
        await prepareAuthorizationFixture();
      } finally {
        rdp[Symbol.dispose]();
      }
    });

    it("grants a one-time key for Allow", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: false });

      const reply = await authorize(api, { serverID, appName: APP_NAME });

      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: false });
      // The count is of remembered keys only, so a one-time grant leaves it 0.
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("grants a remembered key for Always Allow", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: true });

      const reply = await authorize(api, { serverID, appName: APP_NAME });

      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: true });
      await expect(authorizationCount(rdp)).resolves.toBe(1);
    });

    it("refuses with 403 for Deny", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: false, remember: false });

      const reply = await authorize(api, { serverID, appName: APP_NAME });

      expect(reply.status).toBe(403);
      expect(reply.body).toEqual({ denied: true });
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("answers 429 after five dialog requests in a minute", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: false, remember: false });

      for (let attempt = 0; attempt < 5; attempt++) {
        expect(
          (await authorize(api, { serverID, appName: APP_NAME })).status,
        ).toBe(403);
      }
      const limited = await authorize(api, { serverID, appName: APP_NAME });

      expect(limited.status).toBe(429);
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("keeps a request that never reaches the prompt out of the rate limit", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: true });

      // No Zotero-Server-ID is checked before the body and before the prompt.
      const missingServer = await zoteroFetch(api, "local/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: APP_NAME }),
      });
      expect(missingServer.status).toBe(428);

      const granted = await authorize(api, { serverID, appName: APP_NAME });
      expect(granted.status).toBe(200);
    });

    it("writes with a remembered key, raising no dialog", async () => {
      // Tier 1's "no dialog at all" shape. The key comes from Zotero itself
      // rather than from a hand-written key store; `grantRememberedKey` says
      // why, and proves the authorization is held before the write.
      const key = await grantRememberedKey(api, rdp, {
        serverID,
        appName: APP_NAME,
      });

      const current = await zoteroFetch(
        api,
        `users/0/items/${seededAnnotation.key}`,
        { headers: { "Zotero-Server-ID": serverID } },
      );
      expect(current.status).toBe(200);
      const record = (await current.json()) as {
        version: number;
        data: { annotationComment?: string };
      };
      const original = record.data.annotationComment ?? "";
      // The revert cannot sit in straight-line code: an assertion failure
      // below would leave the seeded Annotation edited and its version bumped,
      // and every later run would inherit that.
      await using revert = new AsyncDisposableStack();
      revert.defer(async () => {
        await restoreAnnotationComment(api, {
          serverID,
          key,
          annotationKey: seededAnnotation.key,
          comment: original,
        });
      });

      const written = await zoteroFetch(
        api,
        `users/0/items/${seededAnnotation.key}`,
        {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            "If-Unmodified-Since-Version": String(record.version),
          },
          body: JSON.stringify({
            annotationComment: `${original}\nEnd-to-end Run`,
          }),
        },
      );
      expect(written.status).toBe(204);
      expect(written.headers.get("Last-Modified-Version")).not.toBeNull();
    });

    it("replaces an Annotation's whole tag list, types kept, under the version precondition", async () => {
      // The probe ADR 0063's tag write stands on (#1231): Zotero replaces the
      // list it receives, so ZotLit sends every tag with its type. A disposable
      // Annotation carries the tags, so the seeded ones stay as the Fixture
      // declares them.
      const key = await grantRememberedKey(api, rdp, {
        serverID,
        appName: APP_NAME,
      });
      const annotationKey = await rdp.json<string>(`(async () => {
        const attachment = ${ATTACHMENT_ITEM};
        const json = await Zotero.Annotations.toJSON(
          attachment.getAnnotations()[0],
        );
        json.key = Zotero.DataObjectUtilities.generateKey();
        delete json.tags;
        const item = await Zotero.Annotations.saveFromJSON(attachment, json);
        item.setTags([
          { tag: "probe-manual", type: 0 },
          { tag: "probe-auto", type: 1 },
          { tag: "probe-removed", type: 0 },
        ]);
        await item.saveTx();
        return item.key;
      })()`);
      await using erase = new AsyncDisposableStack();
      erase.defer(async () => {
        await eraseAnnotations(rdp, [annotationKey]);
      });
      const path = `users/0/items/${annotationKey}`;
      const readTags = async () => {
        const reply = await zoteroFetch(api, path, {
          headers: { "Zotero-Server-ID": serverID },
        });
        expect(reply.status).toBe(200);
        const record = (await reply.json()) as {
          version: number;
          data: { tags: { tag: string; type?: number }[] };
        };
        return {
          version: record.version,
          tags: record.data.tags.toSorted((a, b) => a.tag.localeCompare(b.tag)),
        };
      };
      /**
       * One tag write. `body` puts the version in the body, as ZotLit's
       * request builders do; `header` sends it as If-Unmodified-Since-Version.
       */
      const patchTags = (
        precondition: "body" | "header",
        version: number,
        tags: { tag: string; type: number }[],
      ) =>
        zoteroFetch(api, path, {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            ...(precondition === "header" && {
              "If-Unmodified-Since-Version": String(version),
            }),
          },
          body: JSON.stringify(
            precondition === "body" ? { version, tags } : { tags },
          ),
        });

      const before = await readTags();
      // The wire names an automatic tag's type and omits a manual tag's.
      expect(before.tags).toStrictEqual([
        { tag: "probe-auto", type: 1 },
        { tag: "probe-manual" },
        { tag: "probe-removed" },
      ]);

      const written = await patchTags("body", before.version, [
        { tag: "probe-manual", type: 0 },
        { tag: "probe-auto", type: 1 },
        { tag: "probe-added", type: 0 },
      ]);
      expect(written.status).toBe(204);
      const after = await readTags();
      expect(written.headers.get("Last-Modified-Version")).toBe(
        String(after.version),
      );
      expect(after.version).toBeGreaterThan(before.version);
      expect(after.tags).toStrictEqual([
        { tag: "probe-added" },
        { tag: "probe-auto", type: 1 },
        { tag: "probe-manual" },
      ]);

      // A stale version in either form is refused as plain text naming both
      // versions, with no Last-Modified-Version, and the tags stay as they
      // were. The two forms word the refusal differently.
      const refusals = {
        body: `item version mismatch: expected ${before.version}, found ${after.version}`,
        header: `item has been modified since specified version (expected ${before.version}, found ${after.version})`,
      };
      for (const [precondition, refusal] of Object.entries(refusals)) {
        const stale = await patchTags(
          precondition as keyof typeof refusals,
          before.version,
          [{ tag: "never-stored", type: 0 }],
        );
        expect(stale.status).toBe(412);
        expect(stale.headers.get("Content-Type")).toBe("text/plain");
        expect(stale.headers.get("Last-Modified-Version")).toBeNull();
        expect(await stale.text()).toBe(refusal);
      }
      expect(await readTags()).toStrictEqual(after);
    });
  });

  // ── Tier 3 ────────────────────────────────────────────────────────────────
  // The real dialog (Route B), unstubbed. Zotero's Write Authorization dialog
  // is an ordinary Gecko common dialog and RDP keeps answering while its nested
  // modal event loop spins, so the window can be found and its buttons pressed.
  // Buttons are matched by slot, never by label: this Zotero runs in the host
  // OS locale.
  describe("Tier 3 — Zotero's own dialog", () => {
    let rdp: ZoteroRdp;

    beforeAll(async () => {
      rdp = await openZoteroRdp(debuggerPort!);
    });

    afterEach(async () => {
      // `authorize` blocks inside the modal, so a failed expectation between
      // raising the dialog and answering it would leave the window open and
      // the next case's request queued behind it. Deny, never dismissal —
      // dismissal grants Always Allow.
      await denyAnyAuthorizationDialog(rdp);
      await resetAuthorizations(rdp);
    });

    afterAll(async () => {
      try {
        await prepareAuthorizationFixture();
      } finally {
        rdp[Symbol.dispose]();
      }
    });

    it("grants a one-time key when the dialog's first button is pressed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await clickAuthorizationDialog(rdp, "accept");

      const reply = await pending;
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: false });
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("grants Always Allow when the dialog's second button is pressed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      // The window existing is itself the "Zotero's own dialog was reached"
      // assertion — nothing here is stubbed.
      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await clickAuthorizationDialog(rdp, "cancel");

      const reply = await pending;
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: true });
      await expect(authorizationCount(rdp)).resolves.toBe(1);
    });

    it("refuses when the dialog's third button is pressed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await clickAuthorizationDialog(rdp, "extra1");

      const reply = await pending;
      expect(reply.status).toBe(403);
      expect(reply.body).toEqual({ denied: true });
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("grants Always Allow when the dialog is dismissed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await dismissAuthorizationDialog(rdp);

      const reply = await pending;
      // Deliberate, and it contradicts the spec, ADR 0038 and issue #1144,
      // which all read a dismissed dialog as a refusal. Gecko's common dialog
      // sets `buttonNumClicked = 1` as the dismissal result and slot 1 is
      // Always Allow, so dismissing grants a persistent authorization. This
      // asserts what Zotero does, not what the spec assumed.
      // @see https://github.com/aidenlx/zotlit/issues/1139
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: true });
      await expect(authorizationCount(rdp)).resolves.toBe(1);
    });
  });

  // ── Tier 4 ────────────────────────────────────────────────────────────────
  // The native concurrency boundary. Each case pauses one Zotero operation at
  // a controlled completion point, then drives the competing operation through
  // the real Reader or Local API before it releases the first one.
  describe("Tier 4 — native concurrent writes", () => {
    let rdp: ZoteroRdp;
    let key = "";
    let cleanup: AsyncDisposableStack | null = null;

    beforeAll(async () => {
      const resources = new AsyncDisposableStack();
      cleanup = resources;
      rdp = resources.use(await openZoteroRdp(debuggerPort!));
      const pdfDigestBefore = await digestAttachmentPdf();
      expect(pdfDigestBefore).toHaveLength(64);
      resources.defer(async () => {
        expect(await digestAttachmentPdf()).toBe(pdfDigestBefore);
      });
      const readerWasOpen = await isZoteroReaderOpen(rdp);
      const readerTabID = await openZoteroReader(rdp);
      if (!readerWasOpen) {
        resources.defer(async () => {
          await closeZoteroReader(rdp, readerTabID);
        });
      }
      resources.defer(async () => {
        await resetAuthorizations(rdp);
      });
      await resetAuthorizations(rdp);
      resources.defer(async () => {
        await restorePrompt(rdp);
      });
      key = await grantRememberedKey(api, rdp, {
        serverID,
        appName: `${APP_NAME} concurrency`,
      });
      resources.defer(async () => {
        await eraseConcurrencyAnnotations(rdp);
      });
      resources.defer(async () => {
        await restoreConcurrencyHooks(rdp);
      });
    }, 120000);

    afterEach(async () => {
      await restoreConcurrencyHooks(rdp);
    });

    afterAll(async () => {
      try {
        await cleanup?.disposeAsync();
      } finally {
        await prepareAuthorizationFixture();
      }
    }, 120000);

    it("records whether a native PATCH loses a concurrent Reader comment", async () => {
      const annotation = await createConcurrencyAnnotation(
        rdp,
        "Concurrency PATCH baseline",
      );
      const readerComment = "Reader concurrent comment";
      const apiComment = "Local API concurrent comment";
      const paused = await pauseReaderCommentSave(
        rdp,
        annotation.key,
        readerComment,
      );
      expect(paused).toEqual({
        version: annotation.version,
        comment: readerComment,
      });

      const patched = await zoteroFetch(
        api,
        `users/0/items/${annotation.key}`,
        {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            "If-Unmodified-Since-Version": String(annotation.version),
          },
          body: JSON.stringify({ annotationComment: apiComment }),
        },
      );
      expect(patched.status).toBe(204);

      const readerOutcome = await releaseReaderCommentSave(rdp, annotation.key);
      expect(readerOutcome).toEqual({ ok: true });
      const final = await readAnnotationState(api, serverID, annotation.key);

      // Zotero 10.0 acknowledges both writes, but the API value stands. The
      // Reader's distinct accepted value is gone without a conflict response.
      expect(final).toMatchObject({
        status: 200,
        comment: apiComment,
      });
      expect(final.version).toBeGreaterThan(annotation.version);
      expect(final.comment).not.toBe(readerComment);
      console.info("Native PATCH concurrency evidence", {
        initialVersion: annotation.version,
        apiStatus: patched.status,
        readerOutcome,
        final,
        readerComment,
        apiComment,
      });
    }, 120000);

    it("records whether DELETE honors a Reader change after its version check", async () => {
      const annotation = await createConcurrencyAnnotation(
        rdp,
        "Concurrency DELETE baseline",
      );
      const readerComment = "Reader comment before paused delete";
      await pauseAnnotationErase(rdp, annotation.key);

      const deleting = zoteroFetch(api, `users/0/items/${annotation.key}`, {
        method: "DELETE",
        headers: {
          "Zotero-Server-ID": serverID,
          "Zotero-API-Key": key,
          "If-Unmodified-Since-Version": String(annotation.version),
        },
      });
      expect(
        await waitFor(() => annotationErasePaused(rdp, annotation.key)),
      ).toBe(true);

      await saveReaderComment(rdp, annotation.key, readerComment);
      const afterReader = await readAnnotationState(
        api,
        serverID,
        annotation.key,
      );
      expect(afterReader).toMatchObject({
        status: 200,
        comment: readerComment,
      });
      expect(afterReader.version).toBeGreaterThan(annotation.version);

      await releaseAnnotationErase(rdp, annotation.key);
      const deleted = await deleting;
      expect(deleted.status).toBe(204);
      const final = await readAnnotationState(api, serverID, annotation.key);
      expect(final).toEqual({
        status: 404,
        version: null,
        comment: null,
      });
      console.info("Native DELETE concurrency evidence", {
        initialVersion: annotation.version,
        afterReader,
        deleteStatus: deleted.status,
        final,
        readerComment,
      });
    }, 120000);
  });

  describe.skipIf(!debuggerPort || !vaultId)(
    "excerpt rendering with readers closed",
    () => {
      it("renders the deterministic matrix with Zotero open and no reader", async () => {
        using rdp = await openZoteroRdp(debuggerPort!);
        expect(await rdp.json<number>("Zotero.Reader._readers.length")).toBe(0);
        await verifyExcerptRendering(vaultId!);
        await verifyZoteroExcerptParity(vaultId!);
        expect(await rdp.json<number>("Zotero.Reader._readers.length")).toBe(0);
      }, 120000);
    },
  );

  // ── ZotLit's surfaces ─────────────────────────────────────────────────────
  // Tier 1's shape applied to the plugin: the prompt answers Always Allow for
  // the whole block, so no test here is about the dialog. Every ZotLit write is
  // read back out of Zotero, never out of ZotLit's own state.
  describe.skipIf(!debuggerPort || !vaultId)(
    "ZotLit and Zotero on one Fixture",
    () => {
      let rdp: ZoteroRdp;
      let createdKey = "";
      let readerTabID = "";
      let pdfDigestBefore = "";
      let workspaceLayout = "";
      let cleanup: AsyncDisposableStack;

      beforeAll(async () => {
        cleanup = new AsyncDisposableStack();
        rdp = cleanup.use(await openZoteroRdp(debuggerPort!));
        await prepareAuthorizationFixture();
        workspaceLayout = await obEval(
          vaultId!,
          "JSON.stringify(app.workspace.getLayout())",
        );
        cleanup.defer(async () => {
          await obEval(
            vaultId!,
            `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(workspaceLayout)}));return true;})()`,
          );
        });
        // The PDF is a `vault`-rooted linked file, so it is only readable where
        // the run's vault stands — which is exactly this block's gate.
        pdfDigestBefore = await digestAttachmentPdf();
        // A digest of nothing would make the closing assertion vacuous.
        expect(pdfDigestBefore).toHaveLength(64);
        // A run stopped before its own cleanup, or a create that landed after
        // its test stopped waiting, leaves an Annotation where this run's
        // tools press: the press then selects it and creates nothing.
        await eraseAnnotations(rdp, await madeSince(SEEDED_KEYS));
        // Zotero's Reader is opened on the Attachment before anything is
        // written, so "visible in the Zotero Reader" is a claim about a reader
        // that was already showing the document when the write landed.
        readerTabID = await openZoteroReader(rdp);
        cleanup.defer(async () => {
          await closeZoteroReader(rdp, readerTabID);
        });

        await obEval(
          vaultId!,
          `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(attachmentPath)});await app.workspace.getLeaf('tab').openFile(file);return true;})()`,
        );
        expect(
          await obEvalUntil(
            vaultId!,
            `String(!!app.plugins.plugins.zotlit.services.pdfAnnotationEditor.sessionForPath(${JSON.stringify(attachmentPath)}))`,
            { expected: "true" },
          ),
        ).toBe(true);

        // Two setup preconditions, asserted here so a mis-prepared environment
        // says so instead of timing out later. The Attachment must resolve to
        // its Fixture key — `obsidian-vault open` repoints the linked file at
        // the run's vault, and a bare Fixture build leaves it pointing
        // elsewhere, which draws no marks. And Live Updates must be connected,
        // because the Companion's Freshness Signal is the only thing that
        // invalidates the Zotero Local API partition.
        const resolution = await obJson<{
          kind: string;
          attachmentKey?: string;
        }>(
          `(function(){var s=app.plugins.plugins.zotlit.services;return JSON.stringify(s.attachmentResolver.resolve(app.vault.adapter.getFullPath(${JSON.stringify(attachmentPath)})));})()`,
        );
        expect(
          resolution,
          "the Fixture PDF does not resolve inside the run's vault",
        ).toMatchObject({ kind: "resolved", attachmentKey: attachment.key });
        expect(
          await obEval(
            vaultId!,
            "String(app.plugins.plugins.zotlit.services.localServer.available)",
          ),
          "Live Updates is not listening; a Zotero-side edit cannot reach Obsidian",
        ).toBe("true");

        await obEval(
          vaultId!,
          "app.commands.executeCommandById('zotlit:open-annot-view');true",
        );
        await obEval(
          vaultId!,
          "app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');true",
        );

        // The Annotation Source must be the Local API before any write: a
        // database-backed list refuses writes before it sends anything.
        expect(
          await obEvalUntil(
            vaultId!,
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();const list=await repository.read(${JSON.stringify(attachment.key)});return String(list?.source.kind);})()`,
            { expected: "zotero-local-api" },
          ),
        ).toBe(true);
      }, 120000);

      afterEach(async () => {
        await restoreWriteOutcomeProbe(vaultId!);
      });

      afterAll(async () => {
        await cleanup.disposeAsync();
      }, 120000);

      /** The Obsidian PDF view on the Fixture Attachment, as an eval expression. */
      const pdfView = pdfViewOf(attachmentPath);
      /** The Attachment's Annotations as Zotero holds them, by key. */
      const annotationKeys = () => heldAnnotationKeys(rdp, ATTACHMENT_ITEM);
      /** The Attachment's Annotations beyond `held`, by key. */
      const madeSince = async (held: readonly string[]) =>
        (await annotationKeys()).filter((key) => !held.includes(key));

      /** One seeded Annotation as the Local API answers it. */
      interface StoredMark {
        version: number;
        data: {
          annotationPosition: string;
          annotationSortIndex: string;
          annotationText?: string;
        };
      }

      /**
       * One seeded Annotation a Geometry Edit test moves: Zotero's copy of it
       * off the Local API, what Zotero's open Reader holds of it, the wait for
       * that Reader to be done with it, and the seed put back.
       *
       * @param options.image whether it carries an Excerpt Image the Reader
       *   renders after a position change.
       */
      function seededMark(
        annotationKey: string,
        { image }: { image: boolean },
      ) {
        const path = `users/0/items/${annotationKey}`;
        const seeded = ANNOTATIONS.find(({ key }) => key === annotationKey)!;
        /** The fields a Geometry Edit writes, as the Fixture Spec seeds them. */
        const seed = {
          annotationPosition: JSON.stringify(seeded.position),
          annotationSortIndex: seeded.sortIndex,
          ...(seeded.text !== null && { annotationText: seeded.text }),
        };
        const where = () => ({
          rdp,
          attachmentKey: attachment.key,
          annotationKey,
        });
        const stored = async (): Promise<StoredMark> =>
          (await (
            await zoteroFetch(api, path, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as StoredMark;
        const settled = () => readerSettled(where(), { api, serverID, image });
        return {
          seeded,
          seed,
          stored,
          settled,
          /** The position and quoted text Zotero's open Reader holds. */
          held: () => readerAnnotation(where()),
          /**
           * Puts the seed back through the Local API, against whatever
           * version Zotero holds once its Reader is done, and has ZotLit read
           * it.
           */
          restore: async (): Promise<void> => {
            await settled();
            const current = await stored();
            const drifted = Object.entries(seed).some(
              ([field, value]) =>
                current.data[field as keyof StoredMark["data"]] !== value,
            );
            if (drifted) {
              const apiKey = await obJson<string>(
                "JSON.stringify(JSON.parse(app.secretStorage.getSecret('zotlit-zotero-write-authorization')).key)",
              );
              const restored = await zoteroFetch(api, path, {
                method: "PATCH",
                headers: {
                  "Zotero-Server-ID": serverID,
                  "Zotero-API-Key": apiKey,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ version: current.version, ...seed }),
              });
              expect(restored.status).toBe(204);
              await settled();
            }
            expect((await stored()).data).toMatchObject(seed);
            await obEval(
              vaultId!,
              `(async()=>{await app.plugins.plugins.zotlit.services.annotationRepository.refresh(${JSON.stringify(attachment.key)});return true;})()`,
            );
          },
        };
      }

      /** Presses one key with modifiers on the reader, as Obsidian delivers it. */
      const pressKey = (key: string, modifiers: Record<string, boolean>) =>
        obJson<{ prevented: boolean }>(
          `(function(){const event=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},...${JSON.stringify(modifiers)},bubbles:true,cancelable:true});${pdfView}.containerEl.dispatchEvent(event);return JSON.stringify({prevented:event.defaultPrevented});})()`,
        );

      /**
       * One chord as Obsidian delivers it, through the view's own Scope.
       * The Reader Keymap registers there, which a DOM event dispatched on
       * the container never reaches.
       *
       * @returns whether the Scope took the key, which is what Obsidian
       *   answers by preventing the keystroke's default.
       */
      const pressChord = (
        key: string,
        modifiers: {
          ctrlKey?: boolean;
          metaKey?: boolean;
          shiftKey?: boolean;
        },
      ) =>
        obJson<{ handled: boolean }>(
          `(function(){const event=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},...${JSON.stringify(modifiers)},bubbles:true,cancelable:true});const names=[];if(event.ctrlKey)names.push('Ctrl');if(event.metaKey)names.push('Meta');if(event.altKey)names.push('Alt');if(event.shiftKey)names.push('Shift');const context={modifiers:names.sort().join(','),key:event.key,vkey:'Key'+event.key.toUpperCase()};const handled=${pdfView}.scope.handleKey(event,context)===false;return JSON.stringify({handled});})()`,
        );

      /** This host's own undo and redo chords. */
      const platformKey = process.platform === "darwin" ? "metaKey" : "ctrlKey";
      const undoKey = () => pressChord("z", { [platformKey]: true });
      const redoKey = () =>
        pressChord("z", { [platformKey]: true, shiftKey: true });

      /** Settles when every open PDF view has answered its last history key. */
      const stepSettled = () =>
        obEval(
          vaultId!,
          "(async()=>{const editor=app.plugins.plugins.zotlit.services.pdfAnnotationEditor;await Promise.all(editor.bindings.map((binding)=>binding.stepped));return 'stepped';})()",
        );

      /**
       * Drags from one client point to another with the pointer held, then
       * releases.
       */
      async function dragPointer(
        from: { x: number; y: number },
        to: { x: number; y: number },
      ): Promise<void> {
        await obEval(
          vaultId!,
          `(function(){${FIRE}const container=${pdfView}.containerEl;fire('pointerdown',${from.x},${from.y});fire('pointermove',${(from.x + to.x) / 2},${(from.y + to.y) / 2},container);fire('pointermove',${to.x},${to.y},container);fire('pointerup',${to.x},${to.y},container);fire('click',${to.x},${to.y},container);return true;})()`,
        );
      }

      /**
       * Whether the stored position's one rect is `expected`, side by side.
       *
       * @param tolerance how far a side may stray: three decimals by default,
       *   more for a rect reached by a drag measured in client pixels.
       */
      const rectIs = (
        position: string,
        expected: readonly number[],
        tolerance = 5e-4,
      ) => {
        const [rect] = (JSON.parse(position) as { rects: number[][] }).rects;
        return (
          rect?.length === 4 &&
          rect.every(
            (value, index) => Math.abs(value - expected[index]!) < tolerance,
          )
        );
      };

      it("creates an Annotation that reaches Zotero, the page overlay and the card", async () => {
        const created = await obJson<{ kind: string; annotationKey?: string }>(
          `(async()=>{const outcome=await app.plugins.plugins.zotlit.services.annotationRepository.createAnnotation(${JSON.stringify(attachment.key)},${JSON.stringify(
            {
              type: "highlight",
              color: "#5fb236",
              comment: "End-to-end Run create",
              text: "End-to-end Run",
              pageLabel: "1",
              // Zotero orders by this string; the shape is page|offset|top.
              sortIndex: "00000|000100|00100",
              position: {
                pageIndex: 0,
                rects: [[100, 600, 300, 620]],
              },
            },
          )});return JSON.stringify(outcome);})()`,
        );
        expect(created.kind).toBe("created");
        createdKey = created.annotationKey!;
        cleanup.defer(async () => {
          await rdp.json(`(async () => {
            const item = Zotero.Items.getByLibraryAndKey(
              Zotero.Libraries.userLibraryID,
              ${JSON.stringify(createdKey)},
            );
            if (item) await item.eraseTx();
            return "erased";
          })()`);
        });

        // Zotero is the oracle: the record is read straight off the Local API,
        // not out of ZotLit's cache.
        const stored = await zoteroFetch(api, `users/0/items/${createdKey}`, {
          headers: { "Zotero-Server-ID": serverID },
        });
        expect(stored.status).toBe(200);
        const record = (await stored.json()) as {
          data: { parentItem: string; annotationComment: string };
        };
        expect(record.data.parentItem).toBe(attachment.key);
        expect(record.data.annotationComment).toBe("End-to-end Run create");

        // The Zotero Reader oracle. Zotero's reader draws from the Annotations
        // its own open item holds, so asking the reader instance that is
        // already showing this Attachment is a claim about that surface rather
        // than about storage — and it is the finest-grained thing the reader
        // exposes to RDP without reaching into its iframe.
        expect(
          await waitFor(() => readerHoldsAnnotation(rdp, createdKey)),
        ).toBe(true);

        // The Obsidian page: an overlay mark carrying the Annotation's key.
        expect(
          await obEvalUntil(
            vaultId!,
            `String(app.workspace.getLeavesOfType('pdf').some(({view})=>view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')))`,
            { expected: "true" },
          ),
        ).toBe(true);

        // The Annotation Card, in the Annotation View.
        expect(
          await obEvalUntil(
            vaultId!,
            `String(app.workspace.getLeavesOfType('zotero-annotation-view').some(({view})=>view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')))`,
            { expected: "true" },
          ),
        ).toBe(true);
      }, 120000);

      it("edits that Annotation and the edit reaches the same three surfaces", async () => {
        // A colour edit, not a comment edit. The criterion names the Zotero
        // Reader, the Obsidian page and the Annotation Card for the edit as
        // well as the create, and a comment cannot appear on the page overlay
        // — a mark paints colour and geometry, never text. Colour is the one
        // edit all three surfaces can show.
        const edited = "#a28ae5";
        const state = await obJson<{ kind: string }>(
          `(async()=>{const state=await app.plugins.plugins.zotlit.services.annotationRepository.patchColor(${JSON.stringify(createdKey)},${JSON.stringify(edited)});return JSON.stringify(state);})()`,
        );
        expect(state.kind).toBe("idle");

        // Zotero holds it, read straight off the Local API.
        expect(
          await waitFor(
            async () =>
              (await annotationColor(api, serverID, createdKey)) === edited,
          ),
        ).toBe(true);
        // The Zotero Reader shows it.
        expect(
          await waitFor(() => readerAnnotationColor(rdp, createdKey, edited)),
        ).toBe(true);
        // The Obsidian page's overlay mark paints it.
        expect(
          await obEvalUntil(
            vaultId!,
            `String(app.workspace.getLeavesOfType('pdf').map(leaf=>leaf.view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')).find(Boolean)?.getAttribute('fill'))`,
            { expected: edited },
          ),
        ).toBe(true);
        // The Annotation Card's swatch carries it.
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){var card=app.workspace.getLeavesOfType('zotero-annotation-view').map(leaf=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')).find(Boolean);if(!card)return 'no card';return String(card.getAttribute('data-annot-color')===${JSON.stringify(edited)});})()`,
            { expected: "true" },
          ),
        ).toBe(true);
      }, 120000);

      it("adds and removes tags on the card, and Zotero holds the list", async () => {
        // The card's own gestures: the tag toggle opens the editor, Enter adds
        // the typed name, a chip's remove button drops it, and the toggle's
        // second press ends the session with its one write. The session ends
        // through the toggle rather than through a blur: a window without the
        // system focus sends no focus events.
        const {
          press,
          toggle,
          editorOpen,
          cardTags,
          editorChips,
          type,
          remove,
        } = cardTagEditor(createdKey);
        const storedTags = () => annotationTags(api, serverID, createdKey);
        const poll = { timeout: 10_000, interval: 250 };
        const kept = "End-to-end Run tag, kept whole";
        const dropped = "End-to-end Run tag dropped";
        const typed = "End-to-end Run tag left typed";

        expect(await storedTags()).toStrictEqual([]);
        expect(await press(toggle)).toBe(true);
        expect(await editorOpen()).toBe(true);
        // Each chip is the signal that Enter added its name.
        await type(kept, { enter: true });
        await expect.poll(editorChips, poll).toEqual([kept]);
        await type(dropped, { enter: true });
        await expect.poll(editorChips, poll).toEqual([kept, dropped]);
        // Nothing reaches Zotero while the session stands.
        expect(await storedTags()).toStrictEqual([]);
        expect(await press(toggle)).toBe(true);

        await expect
          .poll(storedTags, poll)
          .toEqual([`${dropped}:0`, `${kept}:0`]);
        await expect
          .poll(async () => (await cardTags()).toSorted(), poll)
          .toEqual([dropped, kept]);

        expect(await press(toggle)).toBe(true);
        expect(await editorOpen()).toBe(true);
        expect(await remove(dropped)).toBe("removed");
        await expect.poll(editorChips, poll).toEqual([kept]);
        // The toggle ends the session with the text still in the field.
        await type(typed, { enter: false });
        expect(await press(toggle)).toBe(true);

        await expect
          .poll(storedTags, poll)
          .toEqual([`${typed}:0`, `${kept}:0`]);
        await expect
          .poll(async () => (await cardTags()).toSorted(), poll)
          .toEqual([typed, kept]);
      }, 120000);

      it("shows the card's new tags from the moment its tag editor closes", async () => {
        const { press, toggle, editorOpen, cardTags, editorChips, type } =
          cardTagEditor(createdKey);
        const poll = { timeout: 10_000, interval: 250 };
        const added = "End-to-end Run tag drawn at once";
        await setAnnotationTags(rdp, createdKey, []);
        await expect.poll(cardTags, poll).toEqual([]);

        expect(await press(toggle)).toBe(true);
        expect(await editorOpen()).toBe(true);
        await type(added, { enter: true });
        await expect.poll(editorChips, poll).toEqual([added]);

        // Each state of the card's tag row, from the toggle that ends the
        // session until ZotLit has read its write back, recorded in one turn.
        // The old, empty row drawn between the closed editor and the new chip
        // is the flicker this guards.
        const shown = await obJson<string[]>(
          `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const key=${JSON.stringify(createdKey)};const card=()=>app.workspace.getLeavesOfType('zotero-annotation-view').map((leaf)=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key='+JSON.stringify(key)+']')).find(Boolean);const row=()=>card()?.querySelector('.zt-annot-tag-input')?'editor':'chips:'+[...(card()?.querySelectorAll('[aria-pressed]')??[])].map((chip)=>chip.textContent).join('|');const shown=[row()];const record=()=>{const state=row();if(state!==shown.at(-1))shown.push(state);};const observer=new MutationObserver(record);observer.observe(document.body,{subtree:true,childList:true,characterData:true});card().querySelector(${JSON.stringify(toggle)}).click();const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));for(let waited=0;waited<10000&&!(repository.mutationFor(key).kind==='idle'&&!repository.tagDraftFor(key));waited+=50)await sleep(50);await sleep(300);observer.disconnect();record();return JSON.stringify(shown);})()`,
        );
        expect(shown).toEqual(["editor", `chips:${added}`]);
        expect(await annotationTags(api, serverID, createdKey)).toEqual([
          `${added}:0`,
        ]);
      }, 120000);

      it("adds and removes tags from the Mark Popup, and Zotero holds the list", async () => {
        // The Mark Popup's tag verb opens the same inline editor under the
        // comment; its second press ends the session with its one write. As on
        // the card, the session ends through the verb: a window without the
        // system focus sends no focus events.
        const mark = `${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')`;
        const popup = "document.querySelector('.zt-pdf-mark-popup')";
        const section = `${popup}?.querySelector('[data-zt-section=tags]')`;
        const { editorOpen, editorChips, type, remove } = tagEditorIn(section);
        const pressVerb = () =>
          obEvalUntil(
            vaultId!,
            `(function(){const verb=${popup}?.querySelector('[data-zt-verb=tags]');if(!verb)return 'absent';verb.click();return 'pressed';})()`,
            { expected: "pressed" },
          );
        /** The read-only chips under the comment, by name, while no editor is open. */
        const popupTags = () =>
          obJson<string[] | null>(
            `JSON.stringify((${section})?.querySelector('.zt-annot-tag-input')?null:[...((${section})?.querySelectorAll(':scope > div > span')??[])].map(chip=>chip.textContent).sort())`,
          );
        const storedTags = () => annotationTags(api, serverID, createdKey);
        const poll = { timeout: 10_000, interval: 250 };
        const kept = "End-to-end Run tag, kept whole";
        const removed = "End-to-end Run tag left typed";
        const added = "End-to-end Run tag from the popup";
        // The case's own tags, whatever the cases before it left.
        await setAnnotationTags(rdp, createdKey, [
          { tag: removed },
          { tag: kept },
        ]);

        // A click on the mark's body selects it, as a researcher would. A
        // seeded underline lies under the same point, so the popup's stepper
        // walks the stack to the created mark.
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const rect=(${mark})?.getBoundingClientRect();return String(!!rect&&rect.width>0);})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        await obEval(
          vaultId!,
          `(function(){${FIRE}${TAP}const rect=(${mark}).getBoundingClientRect();tap(rect.left+rect.width/2,rect.top+rect.height/2);return true;})()`,
        );
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){if(!${popup})return 'no popup';if((${mark})?.classList.contains('is-selected'))return 'selected';${popup}.querySelector('[data-zt-verb=stack]')?.click();return 'stepped';})()`,
            { expected: "selected" },
          ),
        ).toBe(true);
        // The tags show read-only under the comment.
        await expect.poll(popupTags, poll).toEqual([removed, kept].toSorted());

        expect(await pressVerb()).toBe(true);
        expect(await editorOpen()).toBe(true);
        // Each chip is the signal that the gesture landed.
        await type(added, { enter: true });
        await expect.poll(editorChips, poll).toContain(added);
        expect(await remove(removed)).toBe("removed");
        await expect.poll(editorChips, poll).not.toContain(removed);
        // Nothing reaches Zotero while the session stands.
        expect(await storedTags()).toStrictEqual([`${removed}:0`, `${kept}:0`]);
        expect(await pressVerb()).toBe(true);

        await expect
          .poll(storedTags, poll)
          .toEqual([`${added}:0`, `${kept}:0`]);
        // The popup closes onto the confirmed tags, and the selection stays.
        await expect.poll(popupTags, poll).toEqual([added, kept].toSorted());
        expect(
          await obEval(
            vaultId!,
            `String(!!(${mark})?.classList.contains('is-selected'))`,
          ),
        ).toBe("true");
      }, 120000);

      describe("the image tool on the first page", () => {
        const tool = toolButtonOf(pdfView, "image");
        const clientOf = clientOfFirstPage(pdfView);

        afterEach(() => disarmTool(vaultId!, { pdfView, tool: "image" }));

        /**
         * Brings page one on screen in a window that lays it out, with the
         * PDF point `at` in the middle of the window, and arms the image tool
         * from the Creation Toolbar. A drag point off screen hit-tests to
         * nothing, and how much of page one shows depends on the window.
         */
        const armOnFirstPage = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { pdfView, tool: "image", at });

        /**
         * Drags a rectangle between two PDF points on page one, clear of every
         * seeded mark, and releases it.
         */
        const drag = (
          [x1, y1]: readonly [number, number],
          [x2, y2]: readonly [number, number],
        ) =>
          obJson<{ preview: string | null }>(
            `(function(){${FIRE}${clientOf}const from=clientOf(${x1},${y1}),to=clientOf(${x2},${y2});const container=${pdfView}.containerEl;const node=fire('pointerdown',from.x,from.y);fire('pointermove',(from.x+to.x)/2,(from.y+to.y)/2,container);fire('pointermove',to.x,to.y,container);const preview=container.querySelector('.zt-pdf-capture-rect')?.getAttribute('opacity')??null;fire('pointerup',to.x,to.y,container);fire('click',to.x,to.y,node);return JSON.stringify({preview});})()`,
          );

        it("creates an image Annotation from a rectangle dragged on the page", async () => {
          await armOnFirstPage([150, 170]);
          const before = await annotationKeys();

          // Drawn in full while the pointer is down: both sides pass ten points.
          expect(await drag([80, 220], [220, 120])).toEqual({ preview: "1" });

          const capturedKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
            created: (keys) => cleanup.defer(() => eraseAnnotations(rdp, keys)),
          });

          // Zotero holds an image at the dragged rect, read off the Local API.
          const stored = (await (
            await zoteroFetch(api, `users/0/items/${capturedKey}`, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as {
            data: {
              annotationType: string;
              annotationPosition: string;
              annotationPageLabel: string;
              annotationSortIndex: string;
              annotationComment: string;
            };
          };
          expect(stored.data).toMatchObject({
            annotationType: "image",
            annotationPageLabel: "1",
            annotationComment: "",
          });
          const position = JSON.parse(stored.data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
          };
          expect(position.pageIndex).toBe(0);
          expect(position.rects, stored.data.annotationPosition).toHaveLength(
            1,
          );
          [80, 120, 220, 220].forEach((value, index) =>
            expect(
              position.rects[0]![index],
              stored.data.annotationPosition,
            ).toBeCloseTo(value, 2),
          );
          // The Sort Index is the one the reader's text structure gives the
          // stored rect.
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds it.
          expect(
            await waitFor(() => readerHoldsAnnotation(rdp, capturedKey)),
          ).toBe(true);
          // The page draws its mark, and the tool stood down after one capture.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(!!${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(capturedKey)}]'))`,
              { expected: "true" },
            ),
          ).toBe(true);
          expect(
            await obEval(vaultId!, `${tool}.getAttribute('aria-pressed')`),
          ).toBe("false");
          // The card shows the Excerpt Image, decoded.
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const card=app.workspace.getLeavesOfType('zotero-annotation-view').map(({view})=>view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(capturedKey)}]')).find(Boolean);const img=card?.querySelector('img');return String(!!img&&img.complete&&img.naturalWidth>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);

        it("creates nothing from a rectangle released under ten points on a side", async () => {
          await armOnFirstPage([85, 350]);
          const before = await annotationKeys();

          // Nine points wide: drawn faint, and released to nothing. Clear of
          // the image the create above may have left until the block ends.
          expect(await drag([80, 400], [89, 300])).toEqual({ preview: "0.2" });
          await obEval(
            vaultId!,
            `(async()=>{await app.plugins.plugins.zotlit.services.pdfAnnotationEditor.bindings.find((candidate)=>candidate.filePath===${JSON.stringify(attachmentPath)}).settled;return true;})()`,
          );

          expect(await annotationKeys()).toEqual(before);
          expect(
            await obEval(
              vaultId!,
              `JSON.stringify({armed:${tool}.getAttribute('aria-pressed'),preview:!!${pdfView}.containerEl.querySelector('.zt-pdf-capture-rect')})`,
            ),
          ).toBe(JSON.stringify({ armed: "true", preview: false }));
          // Escape stands the tool down, so the block goes on unarmed.
          await obEval(
            vaultId!,
            `(function(){${pdfView}.containerEl.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`,
          );
          expect(
            await obEval(vaultId!, `${tool}.getAttribute('aria-pressed')`),
          ).toBe("false");
        }, 120000);
      });

      describe("the ink tool on the first page", () => {
        const tool = toolButtonOf(pdfView, "ink");
        const liveStroke = `${pdfView}.containerEl.querySelector('.zt-pdf-live-stroke')`;
        const clientOf = clientOfFirstPage(pdfView);

        /**
         * Half an ellipse of thirteen PDF points on page one, from (100, 340)
         * over (150, 370) to (200, 340): the left column's body text, which
         * no seeded mark covers.
         */
        const CURVE = Array.from({ length: 13 }, (_, index) => {
          const turn = (index / 12) * Math.PI;
          return [
            100 + 50 * (1 - Math.cos(turn)),
            340 + 30 * Math.sin(turn),
          ] as const;
        });

        /**
         * What the Attachment held when this group began. Each test ends by
         * erasing everything beyond it, a create that landed after the test
         * stopped waiting for it included.
         */
        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          const keys = await madeSince(held);
          // Zotero's Reader renders a new ink's Excerpt Image and saves it
          // onto the item, which would put an item erased first back.
          for (const annotationKey of keys)
            await readerSettled(
              { rdp, attachmentKey: attachment.key, annotationKey },
              { api, serverID, image: true },
            );
          await eraseAnnotations(rdp, keys);
          await disarmTool(vaultId!, { pdfView, tool: "ink" });
        });

        /**
         * Brings page one on screen in a window that lays it out, with the
         * PDF point `at` in the middle of the window, and arms the ink tool
         * from the Creation Toolbar.
         */
        const armInk = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { pdfView, tool: "ink", at });

        /**
         * Presses on the first PDF point and moves through the rest, with
         * the pointer held; the press's node is kept for the click.
         */
        const press = (points: readonly (readonly [number, number])[]) =>
          obEval(
            vaultId!,
            `(function(){${FIRE}${clientOf}const container=${pdfView}.containerEl;const [first,...rest]=${JSON.stringify(points)}.map(([x,y])=>clientOf(x,y));window.__ztInkNode=fire('pointerdown',first.x,first.y);for(const at of rest)fire('pointermove',at.x,at.y,container);return true;})()`,
          );

        /**
         * Releases the held pointer at a PDF point, and clicks after it.
         * Answers, read in the same eval, the Pending Strokes on the page and
         * whether a live stroke stands: a release that creates draws its
         * Pending Stroke before it returns, so `{"pending":0,"live":false}`
         * is a release that queued no create.
         */
        const release = ([x, y]: readonly [number, number]) =>
          obEval(
            vaultId!,
            `(function(){${FIRE}${clientOf}const at=clientOf(${x},${y});const container=${pdfView}.containerEl;fire('pointerup',at.x,at.y,container);fire('click',at.x,at.y,window.__ztInkNode);delete window.__ztInkNode;return JSON.stringify({pending:container.querySelectorAll('.zt-pdf-pending-stroke').length,live:!!${liveStroke}});})()`,
          );
        const DISCARDED = JSON.stringify({ pending: 0, live: false });

        /** Presses Escape on the reader, as Obsidian delivers it. */
        const escape = () =>
          obEval(
            vaultId!,
            `(function(){${pdfView}.containerEl.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`,
          );

        /** The one Annotation Zotero holds beyond `before`, once it does. */
        const freshKey = (before: readonly string[]) =>
          freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });

        /** An ink Annotation as the Local API answers it. */
        async function storedInk(key: string) {
          const { data } = (await (
            await zoteroFetch(api, `users/0/items/${key}`, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as {
            data: {
              annotationType: string;
              annotationPosition: string;
              annotationPageLabel: string;
              annotationSortIndex: string;
              annotationComment: string;
            };
          };
          return {
            data,
            position: JSON.parse(data.annotationPosition) as {
              pageIndex: number;
              width: number;
              paths: number[][];
            },
          };
        }

        it("creates an ink Annotation from a stroke drawn on the page, and stays armed", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();

          await press(CURVE);
          // The live stroke starts at the press, and carries the moves once
          // a frame has published them.
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){${clientOf}const stroke=${liveStroke};if(!stroke)return 'none';const [x,y]=stroke.getAttribute('d').split(' ').slice(1,3).map(Number);const at=new DOMPoint(x,y).matrixTransform(stroke.getScreenCTM());const press=clientOf(${CURVE[0]![0]},${CURVE[0]![1]});return JSON.stringify({start:Math.abs(at.x-press.x)<0.5&&Math.abs(at.y-press.y)<0.5,moved:stroke.getAttribute('d').split('L').length>3});})()`,
              { expected: JSON.stringify({ start: true, moved: true }) },
            ),
          ).toBe(true);
          await release(CURVE.at(-1)!);

          const inkKey = await freshKey(before);
          const { data, position } = await storedInk(inkKey);
          expect(data).toMatchObject({
            annotationType: "ink",
            annotationPageLabel: "1",
            annotationComment: "",
          });
          expect(position.pageIndex).toBe(0);
          expect(position.width).toBe(2);
          expect(position.paths, data.annotationPosition).toHaveLength(1);
          const path = position.paths[0]!;
          const points = Array.from({ length: path.length / 2 }, (_, index) => [
            path[2 * index]!,
            path[2 * index + 1]!,
          ]);
          // Chaikin keeps the first point; the close-point filter may drop
          // the last one.
          const [first, last] = [CURVE[0]!, CURVE.at(-1)!];
          expect(points[0]![0]).toBeCloseTo(first[0], 3);
          expect(points[0]![1]).toBeCloseTo(first[1], 3);
          expect(
            Math.hypot(
              points.at(-1)![0]! - last[0],
              points.at(-1)![1]! - last[1],
            ),
          ).toBeLessThan(1);
          for (let index = 1; index < points.length; index++) {
            const [x1, y1] = points[index - 1]!;
            const [x2, y2] = points[index]!;
            expect(
              Math.hypot(x2! - x1!, y2! - y1!),
              `points ${index - 1} and ${index}`,
            ).toBeGreaterThanOrEqual(1);
          }
          const xs = CURVE.map(([x]) => x);
          const ys = CURVE.map(([, y]) => y);
          for (const [x, y] of points) {
            expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-3);
            expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-3);
            expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-3);
            expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-3);
          }
          expect(data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds it.
          expect(await waitFor(() => readerHoldsAnnotation(rdp, inkKey))).toBe(
            true,
          );
          // The page draws its mark, the live stroke is gone, and the tool
          // stays armed for the next stroke.
          expect(
            await obEvalUntil(
              vaultId!,
              `JSON.stringify({mark:!!${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]'),live:!!${liveStroke},armed:${tool}.getAttribute('aria-pressed')})`,
              {
                expected: JSON.stringify({
                  mark: true,
                  live: false,
                  armed: "true",
                }),
              },
            ),
          ).toBe(true);
          // The card shows the Excerpt Image, decoded.
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const card=app.workspace.getLeavesOfType('zotero-annotation-view').map(({view})=>view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(inkKey)}]')).find(Boolean);const img=card?.querySelector('img');return String(!!img&&img.complete&&img.naturalWidth>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);

        it("stores a tap as one point, which the page draws as a dot", async () => {
          const dot = [90, 380] as const;
          await armInk(dot);
          const before = await annotationKeys();

          await press([dot]);
          await release(dot);

          const dotKey = await freshKey(before);
          const { position } = await storedInk(dotKey);
          expect(position.paths).toHaveLength(1);
          expect(position.paths[0]).toHaveLength(2);
          expect(position.paths[0]![0]).toBeCloseTo(dot[0], 3);
          expect(position.paths[0]![1]).toBeCloseTo(dot[1], 3);
          // A move-to and a line-to on the one point, which round caps draw
          // as a dot.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(/^M \\S+ \\S+ L \\S+ \\S+$/.test(${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(dotKey)}]')?.getAttribute('d')??''))`,
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);

        it("draws at the width picked from the ink seat's menu, and keeps the pick over a reopen of the PDF", async () => {
          const inkWidth = `app.plugins.plugins.zotlit.services.settings.current['reader.ink-width']`;
          /**
           * Opens the ink seat's chevron menu and answers the first word of
           * the checked width item; with `pick`, selects the width item that
           * begins with that number, and otherwise closes the menu. The menu
           * is DOM only with Obsidian's native menus off.
           */
          const inkMenu = (pick?: number) =>
            obEval(
              vaultId!,
              `(function(){${pdfView}.containerEl.querySelector('[data-zt-tool="ink-color"]').click();const items=[...document.querySelectorAll('.menu .menu-item')];const label=items.findIndex((item)=>item.classList.contains('is-label'));const word=(item)=>item.textContent.trim().split(/\\s/)[0];const checked=items.slice(label+1).find((item)=>item.querySelector('.mod-checked'));${pick === undefined ? "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));" : `items.slice(label+1).find((item)=>word(item)===${JSON.stringify(String(pick))}).click();`}return checked?word(checked):'none';})()`,
            );
          await using restore = new AsyncDisposableStack();
          const [nativeMenus, width] = (
            await obEval(
              vaultId!,
              `JSON.stringify([app.vault.getConfig('nativeMenus'),${inkWidth}])`,
            ).then((reply) => JSON.parse(reply) as [boolean, number])
          ).map(String);
          restore.defer(async () => {
            await obEval(
              vaultId!,
              `(function(){app.plugins.plugins.zotlit.services.settings.update({'reader.ink-width':${width}});app.vault.setConfig('nativeMenus',${nativeMenus});return true;})()`,
            );
          });
          await obEval(
            vaultId!,
            `app.vault.setConfig('nativeMenus',false);true`,
          );
          const picked = width === "5" ? 8 : 5;
          await armInk([150, 355]);

          // The menu checks the width in hand, and the pick replaces it.
          expect(await inkMenu(picked)).toBe(width);

          // Closed and opened again, the PDF view takes a new binding.
          await reopenPdfView(vaultId!, attachmentPath);
          await armInk([150, 355]);
          expect(await inkMenu()).toBe(String(picked));
          const before = await annotationKeys();
          await press(CURVE);
          await release(CURVE.at(-1)!);

          const inkKey = await freshKey(before);
          expect((await storedInk(inkKey)).position.width).toBe(picked);
          // The page draws the new mark at that width, against the seed's 2.
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const mark=(key)=>${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key="'+key+'"]')?.getAttribute('stroke-width');return JSON.stringify([mark(${JSON.stringify(inkKey)}),mark('4PE492KU')]);})()`,
              { expected: JSON.stringify([String(picked), "2"]) },
            ),
          ).toBe(true);
        }, 120000);

        it("discards a stroke on Escape and stays armed; a second Escape disarms", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();

          await press(CURVE.slice(0, 7));
          expect(
            await obEvalUntil(vaultId!, `String(!!${liveStroke})`, {
              expected: "true",
            }),
          ).toBe(true);
          await escape();
          expect(await release(CURVE[6]!)).toBe(DISCARDED);

          expect(await annotationKeys()).toEqual(before);
          expect(
            await obEval(vaultId!, `${tool}.getAttribute('aria-pressed')`),
          ).toBe("true");
          await escape();
          expect(
            await obEval(vaultId!, `${tool}.getAttribute('aria-pressed')`),
          ).toBe("false");
        }, 120000);

        it("takes touch panning off the page container and shows the crosshair only while armed", async () => {
          await armInk([150, 355]);
          const touchAction = `getComputedStyle(${pageContainerOf(pdfView)}).touchAction`;
          // Over the text layer, whose own rule shows the text cursor.
          const cursor = `getComputedStyle(${pdfView}.viewer.child.getPage(1).div.querySelector('.textLayer span')).cursor`;

          expect(await obEval(vaultId!, touchAction)).toBe("none");
          expect(await obEval(vaultId!, cursor)).toBe("crosshair");
          // A held stroke captures the pointer on the reader, whose own
          // cursor then shows.
          const readerCursor = `getComputedStyle(${pdfView}.containerEl).cursor`;
          await press([[150, 355]]);
          expect(await obEval(vaultId!, readerCursor)).toBe("crosshair");
          await escape();
          expect(await obEval(vaultId!, readerCursor)).not.toBe("crosshair");
          await obEval(
            vaultId!,
            `(function(){${tool}.click();return true;})()`,
          );
          expect(
            await obEval(vaultId!, `${tool}.getAttribute('aria-pressed')`),
          ).toBe("false");
          expect(await obEval(vaultId!, touchAction)).not.toBe("none");
          expect(await obEval(vaultId!, cursor)).not.toBe("crosshair");
        }, 120000);

        it("shows each armed tool's cursor over the page, and keeps it through a held capture or click", async () => {
          await armInk([150, 355]);
          const toolOf = (id: string) =>
            `${pdfView}.containerEl.querySelector('[data-zt-tool="${id}"]')`;
          // The page itself, and the text layer, whose own rule shows the
          // text cursor.
          const cursors = `(function(){const page=${pdfView}.viewer.child.getPage(1).div;return [page,page.querySelector('.textLayer span')].map((node)=>getComputedStyle(node).cursor).join();})()`;
          const readerCursor = `getComputedStyle(${pdfView}.containerEl).cursor`;
          const arm = (id: string) =>
            obEval(
              vaultId!,
              `(function(){const tool=${toolOf(id)};tool.click();return tool.getAttribute('aria-pressed');})()`,
            );

          expect(await obEval(vaultId!, cursors)).toBe("crosshair,crosshair");
          expect(await arm("highlight")).toBe("true");
          expect(await obEval(vaultId!, cursors)).toBe("text,text");
          expect(await arm("underline")).toBe("true");
          expect(await obEval(vaultId!, cursors)).toBe("text,text");
          expect(await arm("image")).toBe("true");
          expect(await obEval(vaultId!, cursors)).toBe("crosshair,crosshair");

          // A held capture takes the pointer on the reader, whose own cursor
          // then shows.
          await press(CURVE.slice(0, 5));
          expect(await obEval(vaultId!, readerCursor)).toBe("crosshair");
          await escape();
          expect(await obEval(vaultId!, readerCursor)).not.toBe("crosshair");

          expect(await arm("image")).toBe("false");
          expect(await obEval(vaultId!, cursors)).not.toContain("crosshair");

          // The note and text tools place at the press; a held click takes
          // the pointer on the reader too. Escape stands the tool down, which
          // lets the press go without placing anything.
          for (const [id, cursor] of [
            ["note", "copy"],
            ["text", "text"],
          ] as const) {
            expect(await arm(id)).toBe("true");
            expect(await obEval(vaultId!, cursors)).toBe(`${cursor},${cursor}`);
            await press(CURVE.slice(0, 1));
            expect(await obEval(vaultId!, readerCursor)).toBe(cursor);
            await escape();
            expect(await obEval(vaultId!, readerCursor)).not.toBe(cursor);
          }
        }, 120000);

        it("stands down from a toolbar press over a page scrolled under the toolbar", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();
          // Where page one's top falls depends on the window's height, so the
          // page is scrolled until its top sits one toggle height above the
          // toggle's middle. The press below measures it in its own eval.
          await obEval(
            vaultId!,
            `(function(){const box=${tool}.getBoundingClientRect();const page=${pdfView}.viewer.child.getPage(1).div.getBoundingClientRect();${pageContainerOf(pdfView)}.scrollTop+=page.top-(box.top+box.height/2)+box.height;return true;})()`,
          );

          // The press lands on the ink toggle, inside the box of the page
          // scrolled up under it, and draws no stroke. A stroke would hold
          // the pointer, which keeps a real click from the toggle.
          expect(
            await obEval(
              vaultId!,
              `(function(){${FIRE}const node=${tool};const box=node.getBoundingClientRect();const x=box.left+box.width/2,y=box.top+box.height/2;const page=${pdfView}.viewer.child.getPage(1).div.getBoundingClientRect();const container=${pdfView}.containerEl;fire('pointerdown',x,y,node);const underPage=page.top<y&&y<page.bottom;fire('pointerup',x,y,node);fire('click',x,y,node);return JSON.stringify({underPage,pending:container.querySelectorAll('.zt-pdf-pending-stroke').length,live:!!${liveStroke},armed:node.getAttribute('aria-pressed')});})()`,
            ),
          ).toBe(
            JSON.stringify({
              underPage: true,
              pending: 0,
              live: false,
              armed: "false",
            }),
          );
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("discards a stroke when a second pointer presses, as a pinch begins", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();

          await press(CURVE.slice(0, 5));
          await obEval(
            vaultId!,
            `(function(){${FIRE}${clientOf}const container=${pdfView}.containerEl;const second=clientOf(180,350);const node=fire('pointerdown',second.x,second.y,undefined,{pointerId:2});for(const [x,y] of ${JSON.stringify(CURVE.slice(5))}){const at=clientOf(x,y);fire('pointermove',at.x,at.y,container);fire('pointermove',at.x,second.y-(at.y-second.y),container,{pointerId:2});}fire('pointerup',second.x,second.y,container,{pointerId:2});return true;})()`,
          );
          expect(await release(CURVE.at(-1)!)).toBe(DISCARDED);

          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("creates a new Annotation from a stroke pressed on the seeded ink, and leaves the seed unselected", async () => {
          const seedMark = `${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key="4PE492KU"]')`;
          await armInk([220, 675]);
          const before = await annotationKeys();

          // Pressed halfway along the seed's own stroke, mapped to the client
          // by the overlay itself, and drawn down and to the right.
          await obEval(
            vaultId!,
            `(function(){${FIRE}const container=${pdfView}.containerEl;const mark=${seedMark};const at=mark.getPointAtLength(mark.getTotalLength()/2).matrixTransform(mark.getScreenCTM());window.__ztInkNode=fire('pointerdown',at.x,at.y);for(let step=1;step<=6;step++)fire('pointermove',at.x+step*6,at.y+step*4,container);fire('pointerup',at.x+36,at.y+24,container);fire('click',at.x+36,at.y+24,window.__ztInkNode);delete window.__ztInkNode;return true;})()`,
          );

          const inkKey = await freshKey(before);
          expect((await storedInk(inkKey)).data.annotationType).toBe("ink");
          expect(
            await obEvalUntil(
              vaultId!,
              `String(!!${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]'))`,
              { expected: "true" },
            ),
          ).toBe(true);
          expect(
            await obEval(
              vaultId!,
              `String(${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected').length)`,
            ),
          ).toBe("0");
        }, 120000);

        it("draws nothing and writes nothing while editing is not live", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();
          const capability = (field: "kind" | "reason") =>
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();return String(repository.capabilityFor(${JSON.stringify(attachment.key)}).${field});})()`;
          {
            await using restoreLocalApi = new AsyncDisposableStack();
            restoreLocalApi.defer(async () => {
              await setLocalApi(rdp, true);
            });
            await setLocalApi(rdp, false);
            expect(
              await obEvalUntil(vaultId!, capability("reason"), {
                expected: "local-api-disabled",
              }),
            ).toBe(true);

            await press(CURVE);
            expect(await obEval(vaultId!, `String(!!${liveStroke})`)).toBe(
              "false",
            );
            expect(await release(CURVE.at(-1)!)).toBe(DISCARDED);
          }

          expect(
            await obEvalUntil(vaultId!, capability("kind"), {
              expected: "writable",
            }),
          ).toBe(true);
          expect(await annotationKeys()).toEqual(before);
        }, 120000);
      });

      /**
       * Runs `gesture` with the Local API turned off, so editing is not live,
       * and answers once editing is live again with the Local API back on.
       */
      const whileEditingNotLive = async (gesture: () => Promise<void>) => {
        {
          await using restoreLocalApi = new AsyncDisposableStack();
          restoreLocalApi.defer(async () => {
            await setLocalApi(rdp, true);
          });
          await setLocalApi(rdp, false);
          expect(
            await obEvalUntil(
              vaultId!,
              capabilityOf(attachment.key, "reason"),
              {
                expected: "local-api-disabled",
              },
            ),
          ).toBe(true);

          await gesture();
          await settledGesture(vaultId!, attachmentPath);
        }
        expect(
          await obEvalUntil(vaultId!, capabilityOf(attachment.key, "kind"), {
            expected: "writable",
          }),
        ).toBe(true);
      };

      describe("the note tool on the first page", () => {
        const tool = toolButtonOf(pdfView, "note");
        const clientOf = clientOfFirstPage(pdfView);
        /**
         * A PDF point on page one clear of every seeded mark and of the image
         * the image block may leave: the left column's body text.
         */
        const CLEAR = [150, 250] as const;
        /** The seeded note's centre, in PDF points on page one. */
        const SEED_NOTE = [577.901, 609.393] as const;

        /**
         * What the Attachment held when this group began. Each test ends by
         * erasing everything beyond it, a create that landed after the test
         * stopped waiting for it included.
         */
        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          await eraseAnnotations(rdp, await madeSince(held));
          await disarmTool(vaultId!, { pdfView, tool: "note" });
        });

        /**
         * Brings page one on screen in a window that lays it out, with the
         * PDF point `at` in the middle of the window, and arms the note tool
         * from the Creation Toolbar.
         */
        const armNote = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { pdfView, tool: "note", at });

        /** A click at a PDF point on page one, as the browser delivers it. */
        const click = ([x, y]: readonly [number, number]) =>
          obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}${clientOf}const at=clientOf(${x},${y});tap(at.x,at.y);return true;})()`,
          );

        it("places a note centred on a click, opens its comment, and stands the tool down", async () => {
          await armNote(CLEAR);
          const before = await annotationKeys();

          await click(CLEAR);

          const noteKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          const data = await storedAnnotation(api, serverID, noteKey);
          expect(data).toMatchObject({
            annotationType: "note",
            annotationColor: "#ffd400",
            annotationPageLabel: "1",
            annotationComment: "",
          });
          const position = JSON.parse(data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
          };
          expect(position.pageIndex).toBe(0);
          expect(position.rects, data.annotationPosition).toHaveLength(1);
          // A 22-point square centred on the click, within the rounding of
          // the client point the click was dispatched at.
          const [x, y] = CLEAR;
          [x - 11, y - 11, x + 11, y + 11].forEach((value, index) =>
            expect(
              Math.abs(position.rects[0]![index]! - value),
              data.annotationPosition,
            ).toBeLessThan(0.1),
          );
          expect(position.rects[0]![2]! - position.rects[0]![0]!).toBeCloseTo(
            22,
            2,
          );
          expect(position.rects[0]![3]! - position.rects[0]![1]!).toBeCloseTo(
            22,
            2,
          );
          expect(data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds it.
          expect(await waitFor(() => readerHoldsAnnotation(rdp, noteKey))).toBe(
            true,
          );
          // The page draws the note glyph, selected; the Mark Popup is open
          // with its comment sheet focused; the tool stood down.
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const mark=${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(noteKey)}]');const focused=document.activeElement;return JSON.stringify({glyph:!!mark?.classList.contains('zt-pdf-annotation-note-icon'),selected:!!mark?.classList.contains('is-selected'),sheet:!!focused?.closest('.popover')&&!!focused?.closest('.cm-content'),armed:${tool}.getAttribute('aria-pressed')});})()`,
              {
                expected: JSON.stringify({
                  glyph: true,
                  selected: true,
                  sheet: true,
                  armed: "false",
                }),
              },
            ),
          ).toBe(true);
        }, 120000);

        it("selects the seeded note under a click and creates nothing", async () => {
          await armNote(SEED_NOTE);
          const before = await annotationKeys();

          // A click on a mark starts no create, so the selection is the end.
          await click(SEED_NOTE);

          expect(
            await obEvalUntil(
              vaultId!,
              `JSON.stringify([...${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected')].map((mark)=>mark.dataset.zoteroAnnotationKey))`,
              { expected: JSON.stringify(["C94NJNYG"]) },
            ),
          ).toBe(true);
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("creates nothing from a click while editing is not live", async () => {
          await armNote(CLEAR);
          const before = await annotationKeys();

          await whileEditingNotLive(async () => {
            await click(CLEAR);
          });

          expect(await annotationKeys()).toEqual(before);
        }, 120000);
      });

      describe("the text tool on the first page", () => {
        const tool = toolButtonOf(pdfView, "text");
        const clientOf = clientOfFirstPage(pdfView);
        /** The Text Draft's textarea, as an eval expression. */
        const draftArea = `${pdfView}.containerEl.querySelector('.zt-pdf-text-draft')`;
        /**
         * A PDF point on page one clear of every seeded mark and of the image
         * the image block may leave: the left column's body text.
         */
        const CLEAR = [150, 250] as const;
        /** The seeded text Annotation's centre, in PDF points on page one. */
        const SEED_TEXT = [479.804, 693.607] as const;

        /**
         * What the Attachment held when this group began. Each test ends by
         * erasing everything beyond it, a create that landed after the test
         * stopped waiting for it included.
         */
        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          const erased = await madeSince(held);
          await eraseAnnotations(rdp, erased);
          await disarmTool(vaultId!, { pdfView, tool: "text" });
          // The next click on the same spot finds no mark once the page has
          // let go of the erased ones.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${JSON.stringify(erased)}.some((key)=>${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key="'+key+'"]')))`,
              { expected: "false" },
            ),
          ).toBe(true);
        });

        /**
         * Brings page one on screen in a window that lays it out, with the
         * PDF point `at` in the middle of the window, and arms the text tool
         * from the Creation Toolbar.
         */
        const armText = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { pdfView, tool: "text", at });

        /**
         * A click at a PDF point on page one, as the browser delivers it,
         * answering whether a Text Draft then stands and whether the text
         * tool is still pressed.
         */
        const click = async ([x, y]: readonly [number, number]) =>
          JSON.parse(
            await obEval(
              vaultId!,
              `(function(){${FIRE}${TAP}${clientOf}const at=clientOf(${x},${y});tap(at.x,at.y);const area=${draftArea};return JSON.stringify({draft:!!area,focused:!!area&&document.activeElement===area,armed:${tool}.getAttribute('aria-pressed')});})()`,
            ),
          ) as { draft: boolean; focused: boolean; armed: string };

        /** Declares `type()` in an eval: `text` typed into the Text Draft as an input does. */
        const TYPE = (text: string) =>
          `const type=()=>{const area=${draftArea};area.value=${JSON.stringify(text)};area.dispatchEvent(new InputEvent('input',{bubbles:true}));return area;};`;

        /** Types `text` into the Text Draft, and leaves the draft open. */
        const typeText = (text: string) =>
          obEval(vaultId!, `(function(){${TYPE(text)}type();return true;})()`);

        /**
         * Types `text` into the Text Draft as an input does, then presses
         * Escape in it.
         */
        const typeAndEscape = (text: string) =>
          obEval(
            vaultId!,
            `(function(){${TYPE(text)}type().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`,
          );

        /**
         * The one text Annotation Zotero holds beyond `before`, once it does,
         * with the comment it stores.
         */
        const freshComment = async (before: readonly string[]) => {
          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          const { annotationType, annotationComment } = await storedAnnotation(
            api,
            serverID,
            textKey,
          );
          return { textKey, annotationType, annotationComment };
        };

        it("creates free text typed on two lines at a click, and stands the tool down at the click", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          // The press opens the draft, focused, and stands the tool down.
          expect(await click(CLEAR)).toEqual({
            draft: true,
            focused: true,
            armed: "false",
          });
          await typeAndEscape("Two lines\nof text");

          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          const data = await storedAnnotation(api, serverID, textKey);
          expect(data).toMatchObject({
            annotationType: "text",
            annotationComment: "Two lines\nof text",
          });
          const position = JSON.parse(data.annotationPosition) as {
            pageIndex: number;
            fontSize: number;
            rotation: number;
            rects: number[][];
          };
          expect(position).toMatchObject({
            pageIndex: 0,
            fontSize: 14,
            rotation: 0,
          });
          expect(position.rects, data.annotationPosition).toHaveLength(1);
          // Zotero's square at the press anchors the box's top-left corner,
          // half a font size up and to the left of the click, within the
          // rounding of the client point the click was dispatched at.
          const [x, y] = CLEAR;
          const [left, , , top] = position.rects[0]!;
          expect(
            Math.abs(left! - (x - 7)),
            data.annotationPosition,
          ).toBeLessThan(0.1);
          expect(
            Math.abs(top! - (y + 7)),
            data.annotationPosition,
          ).toBeLessThan(0.1);
          expect(data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds it in the same box.
          let held: { position: string } | null = null;
          expect(
            await waitFor(async () => {
              held = await readerAnnotation({
                rdp,
                attachmentKey: attachment.key,
                annotationKey: textKey,
              });
              return held !== null;
            }),
          ).toBe(true);
          expect(JSON.parse(held!.position)).toEqual(position);

          // The page draws it on the two lines typed, the draft gone.
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const mark=${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]');return JSON.stringify({lines:mark?[...mark.children].map((line)=>line.textContent):null,draft:!!${draftArea}});})()`,
              {
                expected: JSON.stringify({
                  lines: ["Two lines", "of text"],
                  draft: false,
                }),
              },
            ),
          ).toBe(true);
        }, 120000);

        it("creates the draft a press elsewhere on the page finishes", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Pressed away");
          // A click on the page below the draft, with no tool armed: its
          // press leaves the draft saving.
          const [x, y] = CLEAR;
          expect(
            await obEval(
              vaultId!,
              `(function(){${FIRE}${clientOf}const at=clientOf(${x},${y - 60});const node=fire('pointerdown',at.x,at.y);const saving=!!${draftArea}?.readOnly;fire('pointerup',at.x,at.y,node);fire('click',at.x,at.y,node);return String(saving);})()`,
            ),
          ).toBe("true");

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Pressed away",
          });
        }, 120000);

        it("creates the draft its textarea's blur finishes", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Blurred");
          // The blur as the window delivers it when the focus leaves: a
          // window without the system focus fires none for `blur()`.
          await obEval(
            vaultId!,
            `(function(){${draftArea}.dispatchEvent(new FocusEvent('blur'));return true;})()`,
          );

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Blurred",
          });
        }, 120000);

        it("creates the draft a tool change finishes", async () => {
          await using restore = new AsyncDisposableStack();
          restore.defer(async () => {
            await disarmTool(vaultId!, { pdfView, tool: "note" });
          });
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Tool changed");
          await obEval(
            vaultId!,
            `(function(){${toolButtonOf(pdfView, "note")}.click();return true;})()`,
          );

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Tool changed",
          });
        }, 120000);

        it("creates the draft the PDF view closes on", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Closed on");
          // Closed and opened again in one step, so the next test finds the
          // view it needs.
          await reopenPdfView(vaultId!, attachmentPath);

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Closed on",
          });
        }, 120000);

        it("closes the Mark Popup on the saved text with a second Escape", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("Escaped");
          const { textKey } = await freshComment(before);

          // The saved mark is selected under its popup, and the focus the
          // textarea held stays in the reader.
          const reader = `(function(){const container=${pdfView}.containerEl;const mark=container.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]');return JSON.stringify({selected:!!mark?.classList.contains('is-selected'),popup:!!document.querySelector('.zt-pdf-mark-popup'),draft:!!${draftArea},focus:container.contains(document.activeElement)});})()`;
          expect(
            await obEvalUntil(vaultId!, reader, {
              expected: JSON.stringify({
                selected: true,
                popup: true,
                draft: false,
                focus: true,
              }),
            }),
          ).toBe(true);

          // Escape where the focus is, as the keyboard delivers it.
          await obEval(
            vaultId!,
            "(function(){document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()",
          );
          expect(
            await obEvalUntil(vaultId!, reader, {
              expected: JSON.stringify({
                selected: false,
                popup: false,
                draft: false,
                focus: true,
              }),
            }),
          ).toBe(true);
        }, 120000);

        it("creates nothing from a draft left empty", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          // An empty draft goes in the Escape that finishes it.
          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("");

          expect(await obEval(vaultId!, `String(!!${draftArea})`)).toBe(
            "false",
          );
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("selects the seeded text under a click and creates nothing", async () => {
          // The seed sits too near the page's top to come to the window's
          // middle; a point below it, as high as the seeded note, does.
          await armText([SEED_TEXT[0], 609.393]);
          const before = await annotationKeys();

          // A click on a mark starts no create, so the selection is the end.
          expect((await click(SEED_TEXT)).draft).toBe(false);

          expect(
            await obEvalUntil(
              vaultId!,
              `JSON.stringify([...${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected')].map((mark)=>mark.dataset.zoteroAnnotationKey))`,
              { expected: JSON.stringify(["HRK7BG32"]) },
            ),
          ).toBe(true);
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("creates nothing from a click while editing is not live", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          await whileEditingNotLive(async () => {
            expect((await click(CLEAR)).draft).toBe(false);
          });

          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("types at the font size picked from the text seat's menu, and keeps the pick over a reopen of the PDF", async () => {
          const fontSize = `app.plugins.plugins.zotlit.services.settings.current['reader.text-font-size']`;
          /**
           * Opens the text seat's chevron menu and answers the first word of
           * the checked font-size item; with `pick`, selects the font-size
           * item that begins with that number. The menu is DOM only with
           * Obsidian's native menus off.
           */
          const textMenu = (pick?: number) =>
            obEval(
              vaultId!,
              `(function(){${pdfView}.containerEl.querySelector('[data-zt-tool="text-color"]').click();const items=[...document.querySelectorAll('.menu .menu-item')];const label=items.findIndex((item)=>item.classList.contains('is-label'));const word=(item)=>item.textContent.trim().split(/\\s/)[0];const checked=items.slice(label+1).find((item)=>item.querySelector('.mod-checked'));${pick === undefined ? "" : `items.slice(label+1).find((item)=>word(item)===${JSON.stringify(String(pick))}).click();`}return checked?word(checked):'none';})()`,
            );
          /**
           * Closes the menu with Escape, outside the reader so the reader's
           * own Escape stands no tool down. The menu hears it only once it
           * has settled, and a click while it stands lands on it.
           */
          const closeMenu = () =>
            obEvalUntil(
              vaultId!,
              "(function(){if(document.querySelector('.menu'))document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return String(document.querySelectorAll('.menu').length);})()",
              { expected: "0" },
            );
          await using restore = new AsyncDisposableStack();
          const [nativeMenus, size] = (
            await obEval(
              vaultId!,
              `JSON.stringify([app.vault.getConfig('nativeMenus'),${fontSize}])`,
            ).then((reply) => JSON.parse(reply) as [boolean, number])
          ).map(String);
          restore.defer(async () => {
            await obEval(
              vaultId!,
              `(function(){app.plugins.plugins.zotlit.services.settings.update({'reader.text-font-size':${size}});app.vault.setConfig('nativeMenus',${nativeMenus});return true;})()`,
            );
          });
          await obEval(
            vaultId!,
            `app.vault.setConfig('nativeMenus',false);true`,
          );
          const picked = size === "24" ? 18 : 24;
          await armText(CLEAR);

          // The menu checks the size in hand, and the pick replaces it.
          expect(await textMenu(picked)).toBe(size);

          // Closed and opened again, the PDF view takes a new binding.
          await reopenPdfView(vaultId!, attachmentPath);
          await armText(CLEAR);
          expect(await textMenu()).toBe(String(picked));
          expect(await closeMenu()).toBe(true);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("Sized");

          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          const data = await storedAnnotation(api, serverID, textKey);
          expect(
            (JSON.parse(data.annotationPosition) as { fontSize: number })
              .fontSize,
          ).toBe(picked);
        }, 120000);

        it("creates text in the colour picked from the text seat's menu, and draws it that colour darkened five percent", async () => {
          const setting = (key: string) =>
            `app.plugins.plugins.zotlit.services.settings.current[${JSON.stringify(key)}]`;
          await using restore = new AsyncDisposableStack();
          const [nativeMenus, colors, recent] = await obEval(
            vaultId!,
            `JSON.stringify([app.vault.getConfig('nativeMenus'),${setting("reader.annotation-colors")}??null,${setting("reader.recent-colors")}??null])`,
          ).then((reply) => JSON.parse(reply) as [boolean, unknown, unknown]);
          restore.defer(async () => {
            await obEval(
              vaultId!,
              `(function(){app.plugins.plugins.zotlit.services.settings.update({'reader.annotation-colors':${JSON.stringify(colors)}??undefined,'reader.recent-colors':${JSON.stringify(recent)}??undefined});app.vault.setConfig('nativeMenus',${nativeMenus});return true;})()`,
            );
          });
          await obEval(
            vaultId!,
            `app.vault.setConfig('nativeMenus',false);true`,
          );
          // Zotero's green swatch, which no tool starts on.
          const green = "#5fb236";
          await armText(CLEAR);

          // The swatch is picked from the text seat's chevron menu, which
          // closes on the pick.
          expect(
            await obEval(
              vaultId!,
              `(function(){${pdfView}.containerEl.querySelector('[data-zt-tool="text-color"]').click();const item=[...document.querySelectorAll('.menu .menu-item')].find((one)=>one.querySelector('[style*=${JSON.stringify(green)}]'));item.click();return String(!!item);})()`,
            ),
          ).toBe("true");
          expect(
            await obEvalUntil(
              vaultId!,
              "String(document.querySelectorAll('.menu').length)",
              { expected: "0" },
            ),
          ).toBe(true);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("Green");

          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          expect(
            (await storedAnnotation(api, serverID, textKey)).annotationColor,
          ).toBe(green);
          // Zotero's `darkenHex(green, 5)`: each channel times 0.95, rounded —
          // 0x5f → 0x5a, 0xb2 → 0xa9, 0x36 → 0x33.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]')?.getAttribute('fill'))`,
              { expected: "#5aa933" },
            ),
          ).toBe(true);
        }, 120000);
      });

      describe("free text on the first page", () => {
        /** A text mark's lines, as the page draws them. */
        const linesOf = (key: string) =>
          `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const mark=view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]');if(!mark)return 'none';return JSON.stringify([...mark.children].map((line)=>[line.textContent,Number(line.getAttribute('y')).toFixed(3),Number(line.getComputedTextLength().toFixed(3))]));})()`;

        /**
         * What the Attachment held when this group began. Each test ends by
         * erasing everything beyond it, a create that landed after the test
         * stopped waiting for it included.
         */
        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          await eraseAnnotations(rdp, await madeSince(held));
        });

        it("draws the seeded free text on one line inside its box", async () => {
          await raiseWindow(vaultId!);
          const { position } = seededMark("HRK7BG32", { image: false }).seeded;
          if (!("fontSize" in position)) throw new Error("HRK7BG32 is text");
          const [left, , right] = position.rects[0]!;
          let lines: [string, string, number][] = [];
          expect(
            await waitFor(async () => {
              const answer = await obEval(vaultId!, linesOf("HRK7BG32"));
              if (!answer.startsWith("[")) return false;
              lines = JSON.parse(answer) as typeof lines;
              // A page not yet laid out measures its text as nothing.
              return lines.every(([, , length]) => length > 0);
            }),
          ).toBe(true);
          expect(lines.map(([line]) => line)).toEqual([
            "Making figures is hard :(",
          ]);
          // The box was fitted to the comment in Zotero's font; the page
          // draws it in Obsidian's, and the run still ends inside the box.
          expect(lines[0]![2]).toBeLessThanOrEqual(right! - left!);
        }, 120000);

        it("draws a two-line text Annotation from Zotero as two lines", async () => {
          await raiseWindow(vaultId!);
          const before = await heldAnnotationKeys(rdp, ATTACHMENT_ITEM);
          const apiKey = await obJson<string>(
            "JSON.stringify(JSON.parse(app.secretStorage.getSecret('zotlit-zotero-write-authorization')).key)",
          );
          // Written straight through the Local API, so the page draws a text
          // Annotation Zotero holds, not one ZotLit shaped. The box is 40
          // points high, room for two 14-point lines.
          const written = await zoteroFetch(api, "users/0/items", {
            method: "POST",
            headers: {
              "Zotero-Server-ID": serverID,
              "Zotero-API-Key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([
              {
                annotationType: "text",
                itemType: "annotation",
                parentItem: attachment.key,
                annotationComment: "Two\nlines",
                annotationColor: "#ff6666",
                annotationPageLabel: "1",
                annotationSortIndex: "00000|000000|00602",
                annotationPosition: JSON.stringify({
                  pageIndex: 0,
                  fontSize: 14,
                  rotation: 0,
                  rects: [[60, 150, 200, 190]],
                }),
              },
            ]),
          });
          expect(written.status).toBe(200);
          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          await obEval(
            vaultId!,
            `(async()=>{await app.plugins.plugins.zotlit.services.annotationRepository.refresh(${JSON.stringify(attachment.key)});return true;})()`,
          );

          // Each line starts 1.2 font sizes, 16.8 points, below the last.
          let lines: [string, string, number][] = [];
          expect(
            await waitFor(async () => {
              const answer = await obEval(vaultId!, linesOf(textKey));
              if (!answer.startsWith("[")) return false;
              lines = JSON.parse(answer) as typeof lines;
              return lines.length > 0;
            }),
          ).toBe(true);
          expect(lines.map(([line]) => line)).toEqual(["Two", "lines"]);
          expect(Number(lines[1]![1]) - Number(lines[0]![1])).toBeCloseTo(
            16.8,
            3,
          );
        }, 120000);
      });

      it("saves a Geometry Edit on the seeded image through one repository write", async () => {
        const imageKey = "FDRFQ7C2";
        const image = seededMark(imageKey, { image: true });
        // The seed goes back through the Local API against whatever version
        // Zotero holds then, so a failed assertion leaves no edited image for
        // the next run to inherit.
        await using revert = new AsyncDisposableStack();
        revert.defer(image.restore);

        // The seed's rect is [48.75, 395.509, 570, 743.723] on page index 1:
        // the edit widens it 40 points to the right and lowers its top edge 40
        // points, which moves the Sort Index's distance from the page top.
        const edited = {
          pageIndex: 1,
          rects: [[48.75, 395.509, 610, 703.723]],
        };
        const outcome = await obJson<{
          sortIndex: string | null;
          state: { kind: string };
          announced: string[];
        }>(
          `(async()=>{const s=app.plugins.plugins.zotlit.services;const binding=s.pdfAnnotationEditor.bindings.find(b=>b.filePath===${JSON.stringify(attachmentPath)});const announced=[];const off=s.annotationRepository.on('excerpt-pixels-changed',(record)=>announced.push(record.key));try{const position=${JSON.stringify(edited)};const sortIndex=await binding.sortIndex(position);const state=await s.annotationRepository.patchGeometry(${JSON.stringify(imageKey)},{position,sortIndex},'pointer');return JSON.stringify({sortIndex,state,announced});}finally{off();}})()`,
        );
        expect(outcome.state.kind).toBe("idle");
        expect(outcome.announced).toEqual([imageKey]);

        // Zotero holds the rect and a recomputed Sort Index, read straight
        // off the Local API.
        const stored = await image.stored();
        expect(JSON.parse(stored.data.annotationPosition)).toEqual(edited);
        expect(stored.data.annotationSortIndex).toBe(outcome.sortIndex);
        expect(stored.data.annotationSortIndex).toMatch(
          /^\d{5}\|\d{6}\|\d{5}$/,
        );
        expect(stored.data.annotationSortIndex).not.toBe(
          image.seed.annotationSortIndex,
        );

        // Zotero's open Reader holds the same rect.
        expect(
          await waitFor(
            async () =>
              (await image.held())?.position === JSON.stringify(edited),
          ),
        ).toBe(true);

        // The Obsidian overlay draws the mark in PDF points: 610 - 48.75 wide,
        // 703.723 - 395.509 high.
        await obEval(
          vaultId!,
          `(function(){const leaf=app.workspace.getLeavesOfType('pdf').find(({view})=>view.file?.path===${JSON.stringify(attachmentPath)});const viewer=leaf?.view.viewer.child?.pdfViewer?.pdfViewer;if(viewer)viewer.currentPageNumber=2;return true;})()`,
        );
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){const mark=app.workspace.getLeavesOfType('pdf').map(({view})=>view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]')).find(Boolean);return mark?[mark.getAttribute('width'),Number(mark.getAttribute('height')).toFixed(3)].join(' '):'none';})()`,
            { expected: "561.25 308.214" },
          ),
        ).toBe(true);
      }, 120000);

      describe("Mark Handles on the seeded image", () => {
        const imageKey = "FDRFQ7C2";
        const image = seededMark(imageKey, { image: true });
        const imageMark = `${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]')`;
        const card = `app.workspace.getLeavesOfType('zotero-annotation-view').map(({view})=>view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(imageKey)}]')).find(Boolean)`;

        /**
         * Brings page two on screen and selects the image by a click on its
         * body, as a researcher would, then answers where its bottom-right
         * handle is and how many client pixels one PDF point spans on each
         * axis of the drawn page.
         */
        async function selectImage(): Promise<{
          x: number;
          y: number;
          perX: number;
          perY: number;
        }> {
          await image.settled();
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=2;const rect=${imageMark}?.getBoundingClientRect();return String(!!rect&&rect.width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          await obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}const mark=${imageMark};if(mark.classList.contains('is-selected'))return 'selected';const rect=mark.getBoundingClientRect();const x=rect.left+rect.width/2,y=rect.top+rect.height/2;tap(x,y);return 'clicked';})()`,
          );
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-handle').length)`,
              { expected: "8" },
            ),
          ).toBe(true);
          // Measured in its own eval: the one that acts reads the nodes as
          // they stood before its own events re-drew them. The page jump can
          // still be scrolling, so the handle is read until it stands still.
          // The handle is brought on screen, and counts only once it is the
          // node under its own centre: that is what proves it takes the
          // pointer.
          const measure = `(function(){const view=${pdfView};const node=view.containerEl.querySelector('.zt-pdf-annotation-handle[data-zt-grip="br"]');node.scrollIntoView({block:'nearest',inline:'nearest'});const handle=node.getBoundingClientRect();const x=handle.left+handle.width/2,y=handle.top+handle.height/2;const overlay=${imageMark}.ownerSVGElement;return JSON.stringify({x,y,perX:overlay.getBoundingClientRect().width/overlay.viewBox.baseVal.width,perY:overlay.getBoundingClientRect().height/overlay.viewBox.baseVal.height,onTop:document.elementFromPoint(x,y)===node});})()`;
          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obEval(vaultId!, measure);
              const still =
                next === last && (JSON.parse(next) as { onTop: boolean }).onTop;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as {
            x: number;
            y: number;
            perX: number;
            perY: number;
          };
        }

        /**
         * Whether the image's Annotation Card shows the conflict a Geometry
         * Edit left, with its prompt and its "Apply again" button.
         */
        const conflictShown = async () =>
          (await obEval(
            vaultId!,
            `(function(){const panel=(${card})?.querySelector('.zt-annot-conflict');if(!panel||panel.getBoundingClientRect().width===0)return 'none';return String(panel.textContent.includes("The annotation's position changed in Zotero.")&&[...panel.querySelectorAll('button')].some((node)=>node.textContent==='Apply again'));})()`,
          )) === "true";

        beforeAll(async () => {
          // A Reader opened afresh renders the Excerpt Images it lacks at
          // once, which is what lets each write here wait for that render.
          await closeZoteroReader(rdp, readerTabID);
          readerTabID = await openZoteroReader(rdp);
          await image.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(image.restore);

        it("keeps the popup's comment editor open through a selection and a menu pick inside it", async () => {
          await selectImage();
          await obEval(
            vaultId!,
            `(document.querySelector('.zt-pdf-mark-popup [data-zt-verb="comment"]').click(),true)`,
          );
          expect(
            await obEvalUntil(vaultId!, `String(!!${POPUP_EDITOR})`, {
              expected: "true",
            }),
          ).toBe(true);
          const key = await obJson<string>(
            "JSON.stringify(JSON.parse(app.secretStorage.getSecret('zotlit-zotero-write-authorization')).key)",
          );
          try {
            await expectEditorKeepsSelections(vaultId!);
          } finally {
            // A press outside closes the editor, which saves what it holds;
            // the seed carries no comment, so it is put back either way.
            await obEval(
              vaultId!,
              `(function(){${FIRE}const box=document.querySelector('.workspace-ribbon').getBoundingClientRect();fire('pointerdown',box.left+2,box.top+2);return true;})()`,
            );
            const closed = await obEvalUntil(
              vaultId!,
              `String(!!${POPUP_EDITOR})`,
              { expected: "false" },
            );
            await image.settled();
            await restoreAnnotationComment(api, {
              serverID,
              key,
              annotationKey: imageKey,
              comment: "",
            });
            expect(closed).toBe(true);
          }
        });

        it("resizes the image from its bottom-right handle and saves on release", async () => {
          const handle = await selectImage();
          const { version } = await image.stored();
          await using pixels = await watchExcerptPixels(vaultId!);
          // Twenty points right and thirty points down the page: the right
          // edge moves out to 590 and the bottom edge, PDF's y1, to 365.509.
          const to = {
            x: handle.x + 20 * handle.perX,
            y: handle.y + 30 * handle.perY,
          };
          const pressed = await obJson<{ grip: string; popup: boolean }>(
            `(function(){${FIRE}const node=fire('pointerdown',${handle.x},${handle.y});const container=${pdfView}.containerEl;fire('pointermove',${(handle.x + to.x) / 2},${(handle.y + to.y) / 2},container);fire('pointermove',${to.x},${to.y},container);return JSON.stringify({grip:node.dataset.ztGrip,popup:!!document.querySelector('.zt-pdf-mark-popup')});})()`,
          );
          // The press landed on the drawn handle, and the popup stood aside.
          expect(pressed).toEqual({ grip: "br", popup: false });
          // Nothing is written while the pointer is down.
          expect((await image.stored()).version).toBe(version);

          await obEval(
            vaultId!,
            `(function(){${FIRE}const container=${pdfView}.containerEl;fire('pointerup',${to.x},${to.y},container);fire('click',${to.x},${to.y},container);return true;})()`,
          );

          // Zotero holds the predicted rect, read straight off the Local API.
          const expected = [48.75, 365.509, 590, 743.723];
          expect(
            await waitFor(
              async () =>
                (await image.stored()).data.annotationPosition !==
                image.seed.annotationPosition,
            ),
          ).toBe(true);
          const stored = await image.stored();
          const position = JSON.parse(stored.data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
          };
          expect(position.pageIndex).toBe(1);
          expect(position.rects, stored.data.annotationPosition).toHaveLength(
            1,
          );
          position.rects[0]!.forEach((value, index) =>
            expect(value, stored.data.annotationPosition).toBeCloseTo(
              expected[index]!,
              2,
            ),
          );
          // The Sort Index is the one the reader's text structure gives the
          // stored rect. A bottom-right drag leaves the top edge, which the
          // Sort Index measures, where it was.
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds the same rect.
          expect(
            await waitFor(
              async () =>
                (await image.held())?.position ===
                stored.data.annotationPosition,
            ),
          ).toBe(true);

          // The overlay draws the saved rect, 590 - 48.75 points wide, and the
          // Excerpt Image was told its pixels changed.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(Math.abs(Number(${imageMark}?.getAttribute('width'))-${(position.rects[0]![2]! - position.rects[0]![0]!).toFixed(3)})<0.001)`,
              { expected: "true" },
            ),
          ).toBe(true);
          expect(await pixels.keys()).toContain(imageKey);
        }, 120000);

        it("puts the image's geometry back for the undo key, and drags it out again for redo", async () => {
          // A history ends with the last view of its Attachment, so a reopened
          // view gives this test an empty one.
          await reopenPdfView(vaultId!, attachmentPath);
          const handle = await selectImage();
          // Twenty points right and thirty points down the page, the drag the
          // resize is proved with.
          await dragPointer(handle, {
            x: handle.x + 20 * handle.perX,
            y: handle.y + 30 * handle.perY,
          });
          expect(
            await waitFor(
              async () =>
                (await image.stored()).data.annotationPosition !==
                image.seed.annotationPosition,
            ),
          ).toBe(true);
          await image.settled();
          const dragged = (await image.stored()).data;

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          // Zotero holds the seeded rect and Sort Index again, read straight
          // off the Local API.
          expect(
            await waitFor(
              async () =>
                (await image.stored()).data.annotationPosition ===
                image.seed.annotationPosition,
            ),
          ).toBe(true);
          await image.settled();
          expect((await image.stored()).data.annotationSortIndex).toBe(
            image.seed.annotationSortIndex,
          );
          // Zotero's own Reader holds the rect the undo wrote.
          expect(
            await waitFor(
              async () =>
                (await image.held())?.position ===
                image.seed.annotationPosition,
            ),
          ).toBe(true);
          // The reader landed on the Annotation the step changed.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(!!${imageMark}?.classList.contains('is-selected'))`,
              { expected: "true" },
            ),
          ).toBe(true);

          expect(await redoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(
              async () =>
                (await image.stored()).data.annotationPosition ===
                dragged.annotationPosition,
            ),
          ).toBe(true);
          expect((await image.stored()).data.annotationSortIndex).toBe(
            dragged.annotationSortIndex,
          );
        }, 120000);

        it("writes nothing for a handle released where it was pressed", async () => {
          const handle = await selectImage();
          const { version } = await image.stored();

          await obEval(
            vaultId!,
            `(function(){${FIRE}const node=fire('pointerdown',${handle.x},${handle.y});fire('pointerup',${handle.x},${handle.y},${pdfView}.containerEl);fire('click',${handle.x},${handle.y},node);return true;})()`,
          );

          // Read once the Reader has held one version across two polls, so a
          // write the release started would have landed. The version is the
          // marker: a write of the same rect still bumps it.
          await image.settled();
          const stored = await image.stored();
          expect(stored.version).toBe(version);
          expect(stored.data.annotationPosition).toBe(
            image.seed.annotationPosition,
          );
          // The mark stays selected, with its handles.
          expect(
            await obEval(
              vaultId!,
              `String(${imageMark}.classList.contains('is-selected'))`,
            ),
          ).toBe("true");
        }, 120000);

        it("draws no handle and writes nothing while editing is not live", async () => {
          const before = await selectImage();
          const { version } = await image.stored();
          await using restoreLocalApi = new AsyncDisposableStack();
          restoreLocalApi.defer(async () => {
            await setLocalApi(rdp, true);
            expect(
              await obEvalUntil(
                vaultId!,
                `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();return String(repository.capabilityFor(${JSON.stringify(attachment.key)}).kind);})()`,
                { expected: "writable" },
              ),
            ).toBe(true);
          });
          await setLocalApi(rdp, false);
          expect(
            await obEvalUntil(
              vaultId!,
              `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();return String(repository.capabilityFor(${JSON.stringify(attachment.key)}).reason);})()`,
              { expected: "local-api-disabled" },
            ),
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-handle').length)`,
              { expected: "0" },
            ),
          ).toBe(true);

          // A drag from where the bottom-right handle stood is an ordinary
          // gesture on the page, and the mark stays where it was drawn.
          const to = {
            x: before.x + 20 * before.perX,
            y: before.y + 30 * before.perY,
          };
          const outcome = await obJson<{ width: string; body: boolean }>(
            `(function(){${FIRE}const width=${imageMark}.getAttribute('width');const node=fire('pointerdown',${before.x},${before.y});const container=${pdfView}.containerEl;fire('pointermove',${to.x},${to.y},container);fire('pointerup',${to.x},${to.y},container);return JSON.stringify({width:String(Number(${imageMark}.getAttribute('width'))===Number(width)),body:node.dataset?.ztGrip==='body'});})()`,
          );
          expect(outcome).toEqual({ width: "true", body: false });

          await restoreLocalApi.disposeAsync();
          expect((await image.stored()).version).toBe(version);
        }, 120000);

        it("widens the image by five points for Shift+ArrowRight", async () => {
          await selectImage();
          const { version } = await image.stored();

          expect(await pressKey("ArrowRight", { shiftKey: true })).toEqual({
            prevented: true,
          });

          // The seed's right edge, 570, moves out to 575; nothing else moves.
          const expected = [48.75, 395.509, 575, 743.723];
          expect(
            await waitFor(async () =>
              rectIs((await image.stored()).data.annotationPosition, expected),
            ),
          ).toBe(true);
          const stored = await image.stored();
          expect(stored.version).toBeGreaterThan(version);
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds the same rect, and the overlay draws it.
          expect(
            await waitFor(
              async () =>
                (await image.held())?.position ===
                stored.data.annotationPosition,
            ),
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              `String(Math.abs(Number(${imageMark}?.getAttribute('width'))-526.25)<0.001)`,
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);

        it("nudges the image five points down for Alt+ArrowDown, with the Sort Index of its new top", async () => {
          await selectImage();

          expect(await pressKey("ArrowDown", { altKey: true })).toEqual({
            prevented: true,
          });

          // Five points down the page is five toward PDF's y origin: both
          // edges move, the top edge the Sort Index measures among them.
          const expected = [48.75, 390.509, 570, 738.723];
          expect(
            await waitFor(async () =>
              rectIs((await image.stored()).data.annotationPosition, expected),
            ),
          ).toBe(true);
          const stored = await image.stored();
          expect(stored.data.annotationSortIndex).not.toBe(
            image.seed.annotationSortIndex,
          );
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );
        }, 120000);

        it("lands a conflicted Geometry Edit against Zotero's fresh version when applied again", async () => {
          await using teardown = new AsyncDisposableStack();
          // A conflict left standing by a failed assertion is ended before
          // the seed goes back.
          teardown.defer(async () => {
            await obEval(
              vaultId!,
              `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;if(repository.mutationFor(${JSON.stringify(imageKey)}).kind==='conflict')repository.discardConflict(${JSON.stringify(imageKey)});return true;})()`,
            );
          });
          const handle = await selectImage();
          // Twenty points right from the bottom-right handle: the right edge
          // is to move out from 570 to 590.
          const to = { x: handle.x + 20 * handle.perX, y: handle.y };
          const attempted = [48.75, 395.509, 590, 743.723];
          const pressed = await obJson<{ grip: string }>(
            `(function(){${FIRE}const node=fire('pointerdown',${handle.x},${handle.y});fire('pointermove',${to.x},${to.y},${pdfView}.containerEl);return JSON.stringify({grip:node.dataset.ztGrip});})()`,
          );
          expect(pressed).toEqual({ grip: "br" });

          // Zotero moves the left edge while the pointer is still down, and
          // the release follows at once, before ZotLit reads the change.
          const fresh = [60, 395.509, 570, 743.723];
          await rdp.json<boolean>(`(async () => {
            const attachment = ${ATTACHMENT_ITEM};
            const item = Zotero.Items.getByLibraryAndKey(
              attachment.libraryID,
              ${JSON.stringify(imageKey)},
            );
            item.annotationPosition = JSON.stringify({ pageIndex: 1, rects: [${JSON.stringify(fresh)}] });
            await item.saveTx();
            return true;
          })()`);
          await obEval(
            vaultId!,
            `(function(){${FIRE}const container=${pdfView}.containerEl;fire('pointerup',${to.x},${to.y},container);fire('click',${to.x},${to.y},container);return true;})()`,
          );
          // Read after the release, so no read of ours stands between
          // Zotero's change and the write that meets it.
          const changed = await image.stored();
          expect(rectIs(changed.data.annotationPosition, fresh)).toBe(true);

          // The write met Zotero's newer version: the Annotation Card offers
          // the choice, and Zotero keeps its own rect meanwhile.
          expect(await waitFor(conflictShown)).toBe(true);
          expect(
            rectIs((await image.stored()).data.annotationPosition, fresh),
          ).toBe(true);
          const applyAgain = `(function(){const button=[...(${card})?.querySelectorAll('.zt-annot-conflict button')??[]].find((node)=>node.getBoundingClientRect().width>0&&node.textContent==='Apply again');if(!button)return 'no button';button.click();return 'applied';})()`;

          // Zotero's open Reader saves the image it renders after a position
          // change; a retry sent before that save meets a newer version once
          // more and the card offers the choice again, so each retry waits
          // for the Reader, and is pressed again while the choice stands.
          let landed = false;
          for (let attempt = 0; attempt < 3 && !landed; attempt++) {
            await image.settled();
            const before = (await image.stored()).version;
            expect(await obEval(vaultId!, applyAgain)).toBe("applied");
            // Settled once Zotero holds the attempted rect at a newer
            // version, or once a newer version refused it and the card asks
            // again.
            expect(
              await waitFor(async () => {
                const stored = await image.stored();
                if (stored.version <= before) return false;
                landed = rectIs(stored.data.annotationPosition, attempted);
                return landed || (await conflictShown());
              }),
            ).toBe(true);
          }
          expect(landed).toBe(true);
          // The card lets the choice go once the edit landed.
          expect(await waitFor(async () => !(await conflictShown()))).toBe(
            true,
          );
          expect((await image.stored()).version).toBeGreaterThan(
            changed.version,
          );
        }, 180000);
      });

      it("keeps the create popup's comment sheet open through a selection and a menu pick inside it", async () => {
        await raiseWindow(vaultId!);
        const layer = `${pdfView}?.containerEl.querySelector('.page[data-page-number="1"] .textLayer')`;
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;return String((${layer})?.textContent.length>0);})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        // A drag on the page as the browser leaves it: the press, the text it
        // selected, then the release that settles it into the create popup.
        await obEval(
          vaultId!,
          `(function(){${FIRE}const walker=document.createTreeWalker(${layer},NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())&&!(node.data.length>12&&node.parentElement.getBoundingClientRect().height>0));const range=document.createRange();range.setStart(node,0);range.setEnd(node,8);const box=range.getBoundingClientRect();const x=box.left+2,y=box.top+box.height/2;const pressed=fire('pointerdown',x,y);getSelection().removeAllRanges();getSelection().addRange(range);fire('pointerup',x,y,pressed);return true;})()`,
        );
        expect(
          await obEvalUntil(
            vaultId!,
            `String(!!document.querySelector('.zt-pdf-mark-popup [data-zt-verb="highlight"]'))`,
            { expected: "true" },
          ),
        ).toBe(true);
        await obEval(
          vaultId!,
          `(document.querySelector('.zt-pdf-mark-popup [data-zt-verb="comment"]').click(),true)`,
        );
        expect(
          await obEvalUntil(vaultId!, `String(!!${POPUP_EDITOR})`, {
            expected: "true",
          }),
        ).toBe(true);
        try {
          await expectEditorKeepsSelections(vaultId!);
        } finally {
          // A press outside drops the waiting selection and its draft; nothing
          // reaches Zotero.
          await obEval(
            vaultId!,
            `(function(){${FIRE}const box=document.querySelector('.workspace-ribbon').getBoundingClientRect();fire('pointerdown',box.left+2,box.top+2);return true;})()`,
          );
        }
        expect(
          await obEvalUntil(
            vaultId!,
            `String(!!document.querySelector('.zt-pdf-mark-popup'))`,
            { expected: "false" },
          ),
        ).toBe(true);
      });

      describe("Mark Handles on the seeded ink", () => {
        const inkKey = "4PE492KU";
        const ink = seededMark(inkKey, { image: true });
        const inkMark = `${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]')`;

        interface InkPosition {
          pageIndex: number;
          width: number;
          paths: number[][];
        }
        const seedPosition = ink.seeded.position as InkPosition;

        /**
         * Brings page one on screen and selects the ink by a click inside its
         * stroke box, as a researcher would, then answers where the centre of
         * that box and its bottom-right handle are, and how many client
         * pixels one PDF point spans on each axis of the drawn page.
         */
        async function selectInk(): Promise<{
          body: { x: number; y: number };
          corner: { x: number; y: number };
          perX: number;
          perY: number;
        }> {
          await ink.settled();
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const mark=${inkMark};if(!mark)return 'no mark';mark.scrollIntoView({block:'center',inline:'center'});return String(mark.getBoundingClientRect().width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          await obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}const mark=${inkMark};if(mark.classList.contains('is-selected'))return 'selected';const rect=mark.getBoundingClientRect();const x=rect.left+rect.width/2,y=rect.top+rect.height/2;tap(x,y);return 'clicked';})()`,
          );
          // Ink scales from its four corners only.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-handle').length)`,
              { expected: "4" },
            ),
          ).toBe(true);
          // Measured in its own eval, and read until it stands still: the
          // page jump can still be scrolling.
          const measure = `(function(){const view=${pdfView};const handle=view.containerEl.querySelector('.zt-pdf-annotation-handle[data-zt-grip="br"]').getBoundingClientRect();const box=${inkMark}.getBoundingClientRect();const overlay=${inkMark}.ownerSVGElement;return JSON.stringify({body:{x:box.left+box.width/2,y:box.top+box.height/2},corner:{x:handle.left+handle.width/2,y:handle.top+handle.height/2},perX:overlay.getBoundingClientRect().width/overlay.viewBox.baseVal.width,perY:overlay.getBoundingClientRect().height/overlay.viewBox.baseVal.height});})()`;
          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obEval(vaultId!, measure);
              const still = next === last;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as Awaited<ReturnType<typeof selectInk>>;
        }

        /**
         * The ink Zotero holds once the write and the Reader's render after
         * it have settled, checked against Zotero's open Reader, and the
         * pixel-change announcement for it.
         */
        async function savedInk(
          pixels: Awaited<ReturnType<typeof watchExcerptPixels>>,
        ): Promise<InkPosition> {
          expect(
            await waitFor(
              async () =>
                (await ink.stored()).data.annotationPosition !==
                ink.seed.annotationPosition,
            ),
          ).toBe(true);
          await ink.settled();
          const stored = await ink.stored();
          // The Sort Index is the one the reader's text structure gives the
          // stored position.
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );
          // Zotero's open Reader holds the same position.
          expect((await ink.held())?.position).toBe(
            stored.data.annotationPosition,
          );
          expect(await pixels.keys()).toContain(inkKey);
          return JSON.parse(stored.data.annotationPosition) as InkPosition;
        }

        /**
         * Asserts every stored point sits where `expected` puts the seeded
         * one, within the three-decimal rounding and the client-pixel
         * measure of the drag.
         */
        function expectPoints(
          position: InkPosition,
          expected: (x: number, y: number) => [number, number],
        ): void {
          expect(position.paths).toHaveLength(seedPosition.paths.length);
          seedPosition.paths.forEach((stroke, index) => {
            const moved = position.paths[index]!;
            expect(moved).toHaveLength(stroke.length);
            for (let at = 0; at < stroke.length; at += 2) {
              const [x, y] = expected(stroke[at]!, stroke[at + 1]!);
              expect(
                Math.abs(moved[at]! - x),
                `x of point ${at / 2}`,
              ).toBeLessThan(0.01);
              expect(
                Math.abs(moved[at + 1]! - y),
                `y of point ${at / 2}`,
              ).toBeLessThan(0.01);
            }
          });
        }

        beforeAll(async () => {
          // A Reader opened afresh renders the Excerpt Images it lacks at
          // once, which is what lets each write here wait for that render.
          await closeZoteroReader(rdp, readerTabID);
          readerTabID = await openZoteroReader(rdp);
          await ink.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(ink.restore);

        it("moves every point of the ink by its body's drag, the width kept", async () => {
          const { body, perX, perY } = await selectInk();
          await using pixels = await watchExcerptPixels(vaultId!);
          // Forty pixels right and twenty down the page: down the page is
          // toward PDF's y origin.
          await dragPointer(body, { x: body.x + 40, y: body.y + 20 });
          const dx = 40 / perX;
          const dy = -20 / perY;

          const position = await savedInk(pixels);
          expect(position.pageIndex).toBe(seedPosition.pageIndex);
          expect(position.width).toBe(seedPosition.width);
          expectPoints(position, (x, y) => [x + dx, y + dy]);
          // The overlay draws the saved stroke, whose page units are PDF
          // points counted from the page's left edge.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${inkMark}?.getAttribute('d').startsWith('M ${position.paths[0]![0]} '))`,
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);

        it("takes a click on the stroke and none inside the empty middle of the ink", async () => {
          await ink.settled();
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const mark=${inkMark};if(!mark)return 'no mark';mark.scrollIntoView({block:'center',inline:'center'});return String(mark.getBoundingClientRect().width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          const selected = `String(${inkMark}?.classList.contains('is-selected'))`;

          // Halfway along the drawn stroke, mapped from page units to the
          // client by the overlay itself.
          await obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}const mark=${inkMark};const at=mark.getPointAtLength(mark.getTotalLength()/2).matrixTransform(mark.getScreenCTM());tap(at.x,at.y);return true;})()`,
          );
          expect(
            await obEvalUntil(vaultId!, selected, { expected: "true" }),
          ).toBe(true);

          // The seed is a tick: the top-left of its box, a fifth of the way
          // in and a tenth of the way down, lies inside the box and some
          // fifteen points from either arm. No other mark covers it, so the
          // click is a click-away and deselects.
          await obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}const box=${inkMark}.getBoundingClientRect();const x=box.left+box.width*0.2,y=box.top+box.height*0.1;tap(x,y);return true;})()`,
          );
          expect(
            await obEvalUntil(vaultId!, selected, { expected: "false" }),
          ).toBe(true);
          expect(
            await obEval(
              vaultId!,
              `String(${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected').length)`,
            ),
          ).toBe("0");
        }, 120000);

        it("scales the ink from its bottom-right corner with its proportions and its pen", async () => {
          const { corner, perX } = await selectInk();
          await using pixels = await watchExcerptPixels(vaultId!);
          // Thirty pixels right; the vertical travel is ignored, since the
          // new width alone sets a corner's scale.
          await dragPointer(corner, { x: corner.x + 30, y: corner.y + 10 });
          const points = seedPosition.paths.flat();
          const xs = points.filter((_, index) => index % 2 === 0);
          const ys = points.filter((_, index) => index % 2 === 1);
          const left = Math.min(...xs);
          const top = Math.max(...ys);
          const width = Math.max(...xs) - left;
          const scale = (width + 30 / perX) / width;

          const position = await savedInk(pixels);
          // The top-left corner, opposite the handle, stays put.
          expectPoints(position, (x, y) => [
            left + (x - left) * scale,
            top - (top - y) * scale,
          ]);
          expect(position.width).toBeCloseTo(seedPosition.width * scale, 2);
          expect(
            await obEvalUntil(
              vaultId!,
              `${inkMark}?.getAttribute('stroke-width')`,
              { expected: String(position.width) },
            ),
          ).toBe(true);
        }, 120000);
      });

      describe("Mark Handles on the seeded note and free text", () => {
        const noteKey = "C94NJNYG";
        const textKey = "HRK7BG32";
        const note = seededMark(noteKey, { image: false });
        const text = seededMark(textKey, { image: false });
        const markOf = (key: string) =>
          `${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]')`;
        const clientOf = clientOfFirstPage(pdfView);

        interface TextPosition {
          pageIndex: number;
          fontSize: number;
          rotation: number;
          rects: number[][];
        }
        /** A seeded mark's stored rect, `[x1, y1, x2, y2]` in PDF points. */
        const rectOf = ({
          seeded: { position },
        }: ReturnType<typeof seededMark>) => {
          if (!("rects" in position))
            throw new Error("The seeded mark has no rect");
          return position.rects[0]!;
        };
        const noteRect = rectOf(note);
        const textSeed = text.seeded.position;
        if (!("fontSize" in textSeed)) throw new Error("HRK7BG32 is text");
        const [x1, y1, x2, y2] = rectOf(text);
        /** One line of free text, as Zotero's reader and the page lay it out. */
        const LINE = 1.2 * textSeed.fontSize;

        /**
         * Brings page one on screen, selects the mark by a click at the
         * centre of its stored rect, as a researcher would, and answers how
         * many handles it shows, each handle's client centre, and how many
         * client pixels one PDF point spans on each axis of the drawn page.
         */
        async function select(
          mark: ReturnType<typeof seededMark>,
          handles: number,
        ): Promise<{
          body: { x: number; y: number };
          handles: Record<string, { x: number; y: number }>;
          perX: number;
          perY: number;
        }> {
          const key = mark.seeded.key;
          const [left, bottom, right, top] = rectOf(mark);
          const [cx, cy] = [(left + right) / 2, (bottom + top) / 2];
          await mark.settled();
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const mark=${markOf(key)};if(!mark)return 'no mark';mark.scrollIntoView({block:'center',inline:'center'});return String(mark.getBoundingClientRect().width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          await obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}${clientOf}if(${markOf(key)}.classList.contains('is-selected'))return 'selected';const at=clientOf(${cx},${cy});tap(at.x,at.y);return 'clicked';})()`,
          );
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${markOf(key)}.classList.contains('is-selected'))`,
              { expected: "true" },
            ),
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-handle').length)`,
              { expected: String(handles) },
            ),
          ).toBe(true);
          // Measured in its own eval, and read until it stands still: the
          // page jump can still be scrolling.
          const measure = `(function(){${clientOf}const view=${pdfView};const handles=Object.fromEntries([...view.containerEl.querySelectorAll('.zt-pdf-annotation-handle')].map((node)=>{const rect=node.getBoundingClientRect();return [node.dataset.ztGrip,{x:rect.left+rect.width/2,y:rect.top+rect.height/2}];}));const overlay=${markOf(key)}.ownerSVGElement;return JSON.stringify({body:clientOf(${cx},${cy}),handles,perX:overlay.getBoundingClientRect().width/overlay.viewBox.baseVal.width,perY:overlay.getBoundingClientRect().height/overlay.viewBox.baseVal.height});})()`;
          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obEval(vaultId!, measure);
              const still = next === last;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as Awaited<ReturnType<typeof select>>;
        }

        /**
         * The position Zotero holds once the write and the Reader after it
         * have settled, checked against Zotero's open Reader, with the Sort
         * Index recomputed from it.
         */
        async function savedPosition(
          mark: ReturnType<typeof seededMark>,
        ): Promise<string> {
          expect(
            await waitFor(
              async () =>
                (await mark.stored()).data.annotationPosition !==
                mark.seed.annotationPosition,
            ),
          ).toBe(true);
          await mark.settled();
          const stored = await mark.stored();
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );
          expect((await mark.held())?.position).toBe(
            stored.data.annotationPosition,
          );
          return stored.data.annotationPosition;
        }

        beforeAll(async () => {
          await note.restore();
          await text.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(async () => {
          await note.restore();
          await text.restore();
        });

        /**
         * Evaluates `body` with `context`, a canvas context set to the font
         * the page draws the free text in, measured independently of ZotLit.
         */
        const inTextFont = (body: string) =>
          obEval(
            vaultId!,
            `(function(){const context=document.createElement('canvas').getContext('2d');context.font=${JSON.stringify(`${textSeed.fontSize}px `)}+getComputedStyle(document.body).fontFamily;${body}})()`,
          );

        it("moves the note by its body, with no handle drawn, and keeps its size", async () => {
          const { body, perX, perY } = await select(note, 0);
          // Forty pixels left and twenty down the page, away from the page's
          // right edge, which the seed stands 23 points from: down the page
          // is toward PDF's y origin.
          await dragPointer(body, { x: body.x - 40, y: body.y + 20 });
          const dx = -40 / perX;
          const dy = -20 / perY;

          const saved = await savedPosition(note);
          expect((JSON.parse(saved) as { pageIndex: number }).pageIndex).toBe(
            0,
          );
          expect(
            rectIs(
              saved,
              [
                noteRect[0] + dx,
                noteRect[1] + dy,
                noteRect[2] + dx,
                noteRect[3] + dy,
              ],
              0.01,
            ),
            saved,
          ).toBe(true);
        }, 120000);

        it("nudges the note five points for Alt+ArrowLeft, and resizes nothing for Shift+ArrowLeft", async () => {
          await select(note, 0);
          const { version } = await note.stored();
          // The reader decides a key's Geometry Edit while the key is
          // handled, and takes the key from the page whenever it begins one,
          // so a key left to the page began none.
          expect(await pressKey("ArrowLeft", { shiftKey: true })).toEqual({
            prevented: false,
          });
          await note.settled();
          expect((await note.stored()).version).toBe(version);

          expect(await pressKey("ArrowLeft", { altKey: true })).toEqual({
            prevented: true,
          });
          // The note keeps its size: a resize from the Shift key, landing
          // late, would have changed it.
          const saved = await savedPosition(note);
          expect(
            rectIs(saved, [
              noteRect[0] - 5,
              noteRect[1],
              noteRect[2] - 5,
              noteRect[3],
            ]),
            saved,
          ).toBe(true);
        }, 120000);

        it("moves the free text by its body, its font and turn kept", async () => {
          const { body, perX, perY } = await select(text, 6);
          await dragPointer(body, { x: body.x - 40, y: body.y + 20 });
          const dx = -40 / perX;
          const dy = -20 / perY;

          const saved = await savedPosition(text);
          const position = JSON.parse(saved) as TextPosition;
          expect(position.fontSize).toBe(textSeed.fontSize);
          expect(position.rotation).toBe(textSeed.rotation);
          expect(
            rectIs(saved, [x1 + dx, y1 + dy, x2 + dx, y2 + dy], 0.01),
            saved,
          ).toBe(true);
        }, 120000);

        it("narrows the free text from its right handle, its font kept and its height fitted to the lines", async () => {
          const { handles, perX } = await select(text, 6);
          // Eighty points in: the comment no longer fits one line, so the box
          // keeps the width it was dragged to on release.
          await dragPointer(handles.r!, {
            x: handles.r!.x - 80 * perX,
            y: handles.r!.y + 7,
          });
          // The lines the comment breaks into at that width, word by word as
          // Zotero's render breaks them.
          const width = x2 - x1 - 80;
          const lines = Number(
            await inTextFont(
              `let lines=1,line='';for(const word of ${JSON.stringify(text.seeded.comment)}.split(' ')){const next=line?line+' '+word:word;if(context.measureText(next).width<=${width})line=next;else{lines++;line=word;}}return String(lines);`,
            ),
          );
          expect(lines).toBeGreaterThan(1);

          const saved = await savedPosition(text);
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(
            textSeed.fontSize,
          );
          // The top-left corner stays, and the box hangs one line per line.
          expect(
            rectIs(saved, [x1, y2 - lines * LINE, x2 - 80, y2], 0.01),
            saved,
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              `String(${markOf(textKey)}?.children.length)`,
              { expected: String(lines) },
            ),
          ).toBe(true);
        }, 120000);

        it("fits the free text to its comment's width when its right handle is released on one line", async () => {
          const { handles, perX } = await select(text, 6);
          await dragPointer(handles.r!, {
            x: handles.r!.x + 30 * perX,
            y: handles.r!.y,
          });
          const width = Number(
            await inTextFont(
              `return String(context.measureText(${JSON.stringify(text.seeded.comment)}).width);`,
            ),
          );

          const saved = await savedPosition(text);
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(
            textSeed.fontSize,
          );
          // One line high from the top-left corner, as wide as the comment
          // and 5 points of room.
          expect(
            rectIs(saved, [x1, y2 - LINE, x1 + width + 5, y2], 0.01),
            saved,
          ).toBe(true);
        }, 120000);

        it("scales the free text and its font from its bottom-right corner, the top-left corner kept", async () => {
          const { handles, perX } = await select(text, 6);
          // Fifty-four points in of 162: a scale of two thirds. The vertical
          // travel is ignored, since the width alone sets a corner's scale.
          await dragPointer(handles.br!, {
            x: handles.br!.x - 54 * perX,
            y: handles.br!.y - 30,
          });
          const scale = (x2 - x1 - 54) / (x2 - x1);

          const saved = await savedPosition(text);
          // 14 points scaled by two thirds is 9.33, which Zotero's drag
          // rounds down to the half point.
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(9);
          expect(
            rectIs(saved, [x1, y2 - (y2 - y1) * scale, x2 - 54, y2], 0.01),
            saved,
          ).toBe(true);
        }, 120000);

        it("scales the free text by five points of width for Shift+ArrowDown, its font rounded to the half point", async () => {
          await select(text, 6);
          expect(await pressKey("ArrowDown", { shiftKey: true })).toEqual({
            prevented: true,
          });
          const width = x2 - x1;
          const scale = (width + 5) / width;

          const saved = await savedPosition(text);
          // 14 × 167 / 162 is 14.43, which rounds to 14.5.
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(14.5);
          expect(
            rectIs(saved, [x1, y2 - (y2 - y1) * scale, x2 + 5, y2]),
            saved,
          ).toBe(true);
        }, 120000);
      });

      describe("Mark Handles on the seeded highlight", () => {
        const highlightKey = "Q8ZR4TDH";
        const highlight = seededMark(highlightKey, { image: false });
        const highlightMarks = `[...${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]')]`;
        /** The client box of the first run of `word` in page one's text layer. */
        const wordRect = `const wordRect=(word)=>{const walker=document.createTreeWalker(${pdfView}.containerEl.querySelector('.page[data-page-number="1"] .textLayer'),NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const at=node.data.indexOf(word);if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+word.length);return range.getBoundingClientRect();}}return null;};`;
        /** Whether the highlight's Annotation Card quotes text `test` accepts. */
        const cardQuotes = (test: string) =>
          `(function(){const card=app.workspace.getLeavesOfType('zotero-annotation-view').map(({view})=>view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]')).find(Boolean);if(!card)return 'no card';return String([...card.querySelectorAll('*')].some((node)=>node.childElementCount===0&&(${test})(node.textContent)));})()`;
        const seedText = highlight.seed.annotationText!;
        const seedRects = (
          highlight.seeded.position as { rects: readonly (readonly number[])[] }
        ).rects;

        /**
         * Brings page one on screen and selects the highlight by a click on
         * one of its lines, as a researcher would, then answers where its end
         * handle stands.
         */
        async function selectHighlight(): Promise<{ x: number; y: number }> {
          await highlight.settled();
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const rect=${highlightMarks}[1]?.getBoundingClientRect();return String(!!rect&&rect.width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          await obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}const mark=${highlightMarks}[1];if(mark.classList.contains('is-selected'))return 'selected';const rect=mark.getBoundingClientRect();const x=rect.left+rect.width/2,y=rect.top+rect.height/2;tap(x,y);return 'clicked';})()`,
          );
          expect(
            await obEvalUntil(
              vaultId!,
              `JSON.stringify([...${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-handle')].map((handle)=>handle.dataset.ztGrip))`,
              { expected: '["start","end"]' },
            ),
          ).toBe(true);
          // Measured in its own eval, and read until it stands still and is
          // the node under its own centre, as the image's handle is.
          const measure = `(function(){const node=${pdfView}.containerEl.querySelector('.zt-pdf-annotation-handle[data-zt-grip="end"]');node.scrollIntoView({block:'nearest',inline:'nearest'});const handle=node.getBoundingClientRect();const x=handle.left+handle.width/2,y=handle.top+handle.height/2;return JSON.stringify({x,y,onTop:document.elementFromPoint(x,y)===node});})()`;
          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obEval(vaultId!, measure);
              const still =
                next === last && (JSON.parse(next) as { onTop: boolean }).onTop;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as { x: number; y: number };
        }

        /**
         * Drags the end handle to a point inside `word` on page one, `at` of
         * the way across it, and releases there.
         */
        async function dragEnd(
          handle: { x: number; y: number },
          { word, at }: { word: string; at: number },
        ): Promise<string> {
          const pressed = await obJson<{ grip: string; to: number[] }>(
            `(function(){${FIRE}${wordRect}const box=wordRect(${JSON.stringify(word)});const x=box.left+box.width*${at},y=box.top+box.height/2;const node=fire('pointerdown',${handle.x},${handle.y});const container=${pdfView}.containerEl;fire('pointermove',(${handle.x}+x)/2,(${handle.y}+y)/2,container);fire('pointermove',x,y,container);window.__ztTo=[x,y];return JSON.stringify({grip:node.dataset.ztGrip,to:[x,y]});})()`,
          );
          expect(pressed.grip).toBe("end");
          await obEval(
            vaultId!,
            `(function(){${FIRE}const [x,y]=window.__ztTo;const container=${pdfView}.containerEl;fire('pointerup',x,y,container);fire('click',x,y,container);return true;})()`,
          );
          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText !== seedText,
            ),
          ).toBe(true);
          // Read once Zotero's open Reader has taken the write and saved
          // nothing more over it.
          await highlight.settled();
          return (await highlight.stored()).data.annotationText!;
        }

        beforeAll(async () => {
          if (!(await isZoteroReaderOpen(rdp)))
            readerTabID = await openZoteroReader(rdp);
          await highlight.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(highlight.restore);

        it("extends the quote by one word from its end handle", async () => {
          const handle = await selectHighlight();
          // The seed ends on "few."; the next word on its line is
          // "Furthermore,", and a release past its comma's middle takes it.
          const text = await dragEnd(handle, {
            word: "Furthermore,",
            at: 0.99,
          });
          expect(text).toBe(`${seedText} Furthermore,`);

          const stored = await highlight.stored();
          const position = JSON.parse(stored.data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
            nextPageRects?: number[][];
          };
          // Three lines as seeded, and the last one runs further right.
          expect(position.pageIndex).toBe(0);
          expect(position.nextPageRects).toBeUndefined();
          expect(position.rects.slice(0, 3)).toEqual(seedRects.slice(0, 3));
          expect(position.rects).toHaveLength(4);
          expect(position.rects[3]![0]).toBe(seedRects[3]![0]);
          expect(position.rects[3]![2]).toBeGreaterThan(seedRects[3]![2]! + 20);
          // The Sort Index is the one the reader's text structure gives the
          // stored range.
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds the same range and quote.
          expect(
            await waitFor(async () => {
              const held = await highlight.held();
              return (
                held?.position === stored.data.annotationPosition &&
                held.text === text
              );
            }),
          ).toBe(true);

          // The overlay draws the saved last line, and the Annotation Card
          // quotes the new text.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(Math.abs(Number(${highlightMarks}[3]?.getAttribute('width'))-${(position.rects[3]![2]! - position.rects[3]![0]!).toFixed(3)})<0.001)`,
              { expected: "true" },
            ),
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              cardQuotes("(text)=>text.includes('just a few. Furthermore,')"),
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);

        it("puts the quoted text and the range back for the undo key", async () => {
          // A history ends with the last view of its Attachment, so a reopened
          // view gives this test an empty one.
          await reopenPdfView(vaultId!, attachmentPath);
          const handle = await selectHighlight();
          const text = await dragEnd(handle, {
            word: "Furthermore,",
            at: 0.99,
          });
          expect(text).toBe(`${seedText} Furthermore,`);

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          // Zotero holds the seeded quote, range and Sort Index again.
          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText === seedText,
            ),
          ).toBe(true);
          await highlight.settled();
          const stored = await highlight.stored();
          expect(stored.data.annotationPosition).toBe(
            highlight.seed.annotationPosition,
          );
          expect(stored.data.annotationSortIndex).toBe(
            highlight.seed.annotationSortIndex,
          );

          // Zotero's own Reader holds the quote the undo put back, and the
          // Annotation Card quotes it again.
          expect(
            await waitFor(async () => {
              const held = await highlight.held();
              return (
                held?.text === seedText &&
                held.position === highlight.seed.annotationPosition
              );
            }),
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              cardQuotes("(text)=>text.trimEnd().endsWith('just a few.')"),
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);

        it("keeps one character when the end is dragged back past the start", async () => {
          const handle = await selectHighlight();
          // "automatic." ends the line above the seed's first word, "There".
          const text = await dragEnd(handle, { word: "automatic", at: 0.1 });
          expect(text).toBe("T");

          const position = JSON.parse(
            (await highlight.stored()).data.annotationPosition,
          ) as { rects: number[][] };
          expect(position.rects).toHaveLength(1);
          expect(position.rects[0]![0]).toBe(seedRects[0]![0]);
        }, 120000);

        it("extends the quote by one character for Shift+ArrowRight", async () => {
          await selectHighlight();
          const prevented = await obJson<boolean>(
            `(function(){const event=new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true});${pdfView}.containerEl.dispatchEvent(event);return JSON.stringify(event.defaultPrevented);})()`,
          );
          expect(prevented).toBe(true);
          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText !== seedText,
            ),
          ).toBe(true);
          await highlight.settled();

          // The seed ends on "few."; the next character is the "F" of
          // "Furthermore,", after the space the text structure puts between
          // words.
          const stored = await highlight.stored();
          const text = `${seedText} F`;
          expect(stored.data.annotationText).toBe(text);
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          // Zotero's open Reader holds the same quote, and the Annotation
          // Card quotes it.
          expect(
            await waitFor(async () => {
              const held = await highlight.held();
              return (
                held?.position === stored.data.annotationPosition &&
                held.text === text
              );
            }),
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              cardQuotes("(text)=>text.trimEnd().endsWith('just a few. F')"),
              { expected: "true" },
            ),
          ).toBe(true);
        }, 120000);
      });

      describe("the Annotation History in the reader", () => {
        const historyKey = "PUPR5FG5";
        const seeded = ANNOTATIONS.find(({ key }) => key === historyKey)!;
        const seedColor = seeded.color!;
        /** The swatch the number row's second key picks. */
        const picked = "#ff6666";
        const historyMark = `${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(historyKey)}]')`;

        /** What the Local API holds for the Annotation right now. */
        const storedColor = () => annotationColor(api, serverID, historyKey);

        /**
         * Settles once ZotLit holds no write and no open draft on the
         * Annotation. Zotero answers the Local API a moment before ZotLit has
         * read its own write back, and an undo key pressed in that moment is
         * turned away, not queued.
         */
        async function writeSettled(): Promise<void> {
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;return String(repository.mutationFor(${JSON.stringify(historyKey)}).kind==='idle'&&!repository.commentDraftFor(${JSON.stringify(historyKey)}));})()`,
              { expected: "true" },
            ),
          ).toBe(true);
        }

        /** Whether ZotLit is showing the notice that names one word of it. */
        const noticeShows = (fragment: string) =>
          obEvalUntil(
            vaultId!,
            `String([...document.querySelectorAll('.zt-notice')].some((node)=>node.textContent.includes(${JSON.stringify(fragment)})))`,
            { expected: "true" },
          );

        /** Takes every notice off screen, so the next one is this test's own. */
        const clearNotices = () =>
          obEval(
            vaultId!,
            "(function(){for(const node of document.querySelectorAll('.notice'))node.remove();return true;})()",
          );

        /** One field, written in Zotero itself, and read back into ZotLit. */
        async function saveInZotero(
          field: "annotationColor" | "annotationComment",
          value: string,
        ): Promise<void> {
          await rdp.json(`(async () => {
            const item = Zotero.Items.getByLibraryAndKey(
              Zotero.Libraries.userLibraryID,
              ${JSON.stringify(historyKey)},
            );
            item.${field} = ${JSON.stringify(value)};
            await item.saveTx();
            return "saved";
          })()`);
          expect(
            await obEvalUntil(
              vaultId!,
              `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const list=await repository.refresh(${JSON.stringify(attachment.key)});const record=list?.annotations.find((annotation)=>annotation.key===${JSON.stringify(historyKey)});return String(record?.${field === "annotationColor" ? "color" : "comment"});})()`,
              { expected: value },
            ),
          ).toBe(true);
        }

        /** Selects the highlight by a click on its body, as a researcher would. */
        async function selectMark(): Promise<void> {
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const rect=${historyMark}?.getBoundingClientRect();return String(!!rect&&rect.width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          await obEval(
            vaultId!,
            `(function(){${FIRE}${TAP}const mark=${historyMark};if(mark.classList.contains('is-selected'))return 'selected';const rect=mark.getBoundingClientRect();tap(rect.left+rect.width/2,rect.top+rect.height/2);return 'clicked';})()`,
          );
          expect(
            await obEvalUntil(
              vaultId!,
              `String(!!${historyMark}?.classList.contains('is-selected'))`,
              { expected: "true" },
            ),
          ).toBe(true);
        }

        /** The colour pick itself: the number row's second key on the selection. */
        async function pickRed(): Promise<void> {
          expect(await pressKey("2", {})).toEqual({ prevented: true });
          expect(
            await waitFor(async () => (await storedColor()) === picked),
          ).toBe(true);
          await writeSettled();
        }

        beforeEach(async () => {
          // A history ends with the last view of its Attachment, so a reopened
          // view is what gives each test an empty one.
          await reopenPdfView(vaultId!, attachmentPath);
          await clearNotices();
        });

        afterEach(async () => {
          await obEval(
            vaultId!,
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.patchColor(${JSON.stringify(historyKey)},${JSON.stringify(seedColor)});await repository.patchComment(${JSON.stringify(historyKey)},'');return true;})()`,
          );
          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
        });

        it("puts the colour back for the undo key, and picks it up again for redo", async () => {
          await selectMark();
          await pickRed();

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
          // Zotero's own Reader holds the colour the undo wrote.
          expect(
            await waitFor(() =>
              readerAnnotationColor(rdp, historyKey, seedColor),
            ),
          ).toBe(true);
          // The reader landed on the Annotation the step changed.
          expect(
            await obEvalUntil(
              vaultId!,
              `String(!!${historyMark}?.classList.contains('is-selected'))`,
              { expected: "true" },
            ),
          ).toBe(true);

          expect(await redoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(async () => (await storedColor()) === picked),
          ).toBe(true);
        }, 120000);

        it("leaves a colour Zotero changed alone, and says why", async () => {
          await selectMark();
          await pickRed();

          const inZotero = "#5fb236";
          await saveInZotero("annotationColor", inZotero);
          await clearNotices();

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(await storedColor()).toBe(inZotero);
          // The whole of `annot_history_changed_in_zotero`, because the
          // fragment "changed in Zotero" belongs to two other notices as well.
          expect(
            await noticeShows(
              "This annotation changed in Zotero, so ZotLit left it as it is.",
            ),
          ).toBe(true);
        }, 120000);

        it("undoes a colour pick Zotero only commented on", async () => {
          await selectMark();
          await pickRed();

          await saveInZotero("annotationComment", "Read again in Zotero");

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
        }, 120000);

        it("keeps the step while editing is not live, and takes it once editing is back", async () => {
          await selectMark();
          await pickRed();

          await whileEditingNotLive(async () => {
            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();
          });
          expect(await storedColor()).toBe(picked);

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();
          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
        }, 120000);

        describe("from the command palette", () => {
          /**
           * Whether the palette offers one command while the PDF view is the
           * active view, as the palette asks before it lists it.
           */
          const offered = (id: string) =>
            obEval(
              vaultId!,
              `(function(){const view=${pdfView};app.workspace.setActiveLeaf(view.leaf,{focus:true});return String(app.commands.findCommand(${JSON.stringify(`zotlit:${id}`)}).checkCallback(true));})()`,
            );

          /** Runs one command with the PDF view as the active view. */
          const run = (id: string) =>
            obEval(
              vaultId!,
              `(function(){const view=${pdfView};app.workspace.setActiveLeaf(view.leaf,{focus:true});return String(app.commands.executeCommandById(${JSON.stringify(`zotlit:${id}`)}));})()`,
            );

          it("offers redo only once an undo stands, and takes each step", async () => {
            await selectMark();
            await pickRed();
            expect(await offered("undo-annotation-change")).toBe("true");
            // A new edit leaves nothing to redo.
            expect(await offered("redo-annotation-change")).toBe("false");

            expect(await run("undo-annotation-change")).toBe("true");
            await stepSettled();
            expect(
              await waitFor(async () => (await storedColor()) === seedColor),
            ).toBe(true);
            expect(await offered("redo-annotation-change")).toBe("true");

            expect(await run("redo-annotation-change")).toBe("true");
            await stepSettled();
            expect(
              await waitFor(async () => (await storedColor()) === picked),
            ).toBe(true);
          }, 120000);
        });

        /** What the Local API holds for the Annotation's comment right now. */
        const storedComment = async () =>
          (await storedAnnotation(api, serverID, historyKey))
            .annotationComment ?? "";

        /** Opens the Mark Popup's comment editor on the selected Annotation. */
        async function openCommentEditor(): Promise<void> {
          await obEval(
            vaultId!,
            `(document.querySelector('.zt-pdf-mark-popup [data-zt-verb="comment"]').click(),true)`,
          );
          expect(
            await obEvalUntil(vaultId!, `String(!!${POPUP_EDITOR})`, {
              expected: "true",
            }),
          ).toBe(true);
        }

        /** Replaces what the open editor holds, as typing over a selection does. */
        const typeComment = (text: string) =>
          obEval(
            vaultId!,
            `(function(){${POPUP_EDITOR}.focus();document.execCommand('selectAll');document.execCommand('insertText',false,${JSON.stringify(text)});return true;})()`,
          );

        /** Escape, which stores the comment and takes the editor off screen. */
        async function closeCommentEditor(): Promise<void> {
          await obEval(
            vaultId!,
            `(function(){${POPUP_EDITOR}.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`,
          );
          expect(
            await obEvalUntil(vaultId!, `String(!${POPUP_EDITOR})`, {
              expected: "true",
            }),
          ).toBe(true);
          await writeSettled();
        }

        it("puts a whole comment session back for one press of the undo key", async () => {
          await selectMark();
          await openCommentEditor();

          // Two texts, each left to stand until its own autosave landed.
          await typeComment("Worth");
          expect(
            await waitFor(async () => (await storedComment()) === "Worth"),
          ).toBe(true);
          await typeComment("Worth citing");
          expect(
            await waitFor(
              async () => (await storedComment()) === "Worth citing",
            ),
          ).toBe(true);
          await closeCommentEditor();

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          // The session went back whole, to the comment from before it began.
          expect(
            await waitFor(async () => (await storedComment()) === ""),
          ).toBe(true);

          expect(await redoKey()).toEqual({ handled: true });
          await stepSettled();
          expect(
            await waitFor(
              async () => (await storedComment()) === "Worth citing",
            ),
          ).toBe(true);
        }, 120000);

        it("leaves the undo key to the comment editor's own text undo", async () => {
          await selectMark();
          await openCommentEditor();
          await typeComment("Typed once");
          expect(
            await waitFor(async () => (await storedComment()) === "Typed once"),
          ).toBe(true);

          // A second run typed on, then the platform undo chord, in one turn:
          // no autosave can come due between them. The chord goes to the
          // view's own Scope first, as Obsidian sends it, and then to the
          // editor the focus sits in.
          const { scoped, typed } = await obJson<{
            scoped: boolean;
            typed: string;
          }>(
            `(function(){const editor=${POPUP_EDITOR};editor.focus();document.execCommand('selectAll');document.execCommand('insertText',false,'Typed once and twice');const typed=editor.textContent;const make=()=>new KeyboardEvent('keydown',{key:'z',${platformKey}:true,bubbles:true,cancelable:true});const probe=make();Object.defineProperty(probe,'target',{value:editor});const names=[];if(probe.ctrlKey)names.push('Ctrl');if(probe.metaKey)names.push('Meta');const context={modifiers:names.sort().join(','),key:probe.key,vkey:'KeyZ'};const scoped=${pdfView}.scope.handleKey(probe,context)===false;editor.dispatchEvent(make());return JSON.stringify({scoped,typed});})()`,
          );
          expect(typed).toBe("Typed once and twice");
          // The reader left the chord alone.
          expect(scoped).toBe(false);

          // The editor's own text undo took it back one run.
          expect(
            await obEvalUntil(vaultId!, `${POPUP_EDITOR}.textContent`, {
              expected: "Typed once",
            }),
          ).toBe(true);
          // The Annotation History never heard the key, so Zotero's record
          // still holds what the session last saved.
          expect(await storedComment()).toBe("Typed once");

          await closeCommentEditor();
        }, 120000);

        it("shows the new comment from the moment a blur closes its editor", async () => {
          await selectMark();
          await openCommentEditor();
          const before = "Stored before the blur";
          const after = "Typed just before the blur";
          await typeComment(before);
          expect(
            await waitFor(async () => (await storedComment()) === before),
          ).toBe(true);
          await typeComment(after);

          // Each state of the comment slot in the popup and on the Annotation
          // Card, from the blur until ZotLit has read its write back, recorded
          // in one turn. The stored comment drawn for one frame between the
          // closed editor and the new text is the flicker this guards.
          const shown = await obJson<{ popup: string[]; card: string[] }>(
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const key=${JSON.stringify(historyKey)};const slot=(root)=>{if(root?.querySelector('.cm-content'))return 'editor';const view=root?.querySelector('.zt-annot-comment');return view?'view:'+view.textContent:'none';};const roots={popup:()=>document.querySelector('.zt-pdf-mark-popup'),card:()=>app.workspace.getLeavesOfType('zotero-annotation-view').map((leaf)=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key='+JSON.stringify(key)+']')).find(Boolean)};const shown={popup:[slot(roots.popup())],card:[slot(roots.card())]};const record=()=>{for(const name of ['popup','card']){const state=slot(roots[name]());if(state!==shown[name].at(-1))shown[name].push(state);}};const observer=new MutationObserver(record);observer.observe(document.body,{subtree:true,childList:true,characterData:true});${POPUP_EDITOR}.dispatchEvent(new FocusEvent('blur',{relatedTarget:null}));const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));for(let waited=0;waited<10000&&!(repository.mutationFor(key).kind==='idle'&&!repository.commentDraftFor(key));waited+=50)await sleep(50);await sleep(300);observer.disconnect();record();return JSON.stringify(shown);})()`,
          );
          expect(shown.popup).toEqual(["editor", `view:${after}`]);
          // The card may show the stored comment up to the blur; from there it
          // changes once, to the new text.
          expect(shown.card.at(-1)).toBe(`view:${after}`);
          expect(shown.card.length).toBeLessThanOrEqual(2);
          expect(await storedComment()).toBe(after);
        }, 120000);

        describe("and the Annotation Card beside it", () => {
          /** That Annotation's card, in whichever Annotation View holds it. */
          const card = `app.workspace.getLeavesOfType('zotero-annotation-view').map((leaf)=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]')).find(Boolean)`;

          /**
           * The card's own colour pick: a click selects the card alone, and
           * the number row's second key, on the view's own Scope, picks
           * {@link picked} for it.
           */
          async function pickOnCard(): Promise<void> {
            expect(
              await obEvalUntil(
                vaultId!,
                `(function(){const card=${card};if(!card)return 'no card';card.click();return String(card.hasAttribute('data-alone'));})()`,
                { expected: "true" },
              ),
            ).toBe(true);
            expect(await pressOnCard("2", {})).toEqual({ handled: true });
            expect(
              await waitFor(async () => (await storedColor()) === picked),
            ).toBe(true);
            await writeSettled();
          }

          /**
           * One chord on a focused card, through the Annotation View's own
           * Scope — where Obsidian delivers a key the focused view answers.
           *
           * @returns whether the Scope took the key.
           */
          const pressOnCard = (
            key: string,
            modifiers: {
              ctrlKey?: boolean;
              metaKey?: boolean;
              shiftKey?: boolean;
            },
          ) =>
            obJson<{ handled: boolean }>(
              `(function(){const card=${card};if(!card)return JSON.stringify({handled:false});const view=app.workspace.getLeavesOfType('zotero-annotation-view').map((leaf)=>leaf.view).find((candidate)=>candidate.containerEl.contains(card));if(!view)return JSON.stringify({handled:false});card.focus();const event=new KeyboardEvent('keydown',{key:${JSON.stringify(key)},...${JSON.stringify(modifiers)},bubbles:true,cancelable:true});Object.defineProperty(event,'target',{value:card});const names=[];if(event.ctrlKey)names.push('Ctrl');if(event.metaKey)names.push('Meta');if(event.altKey)names.push('Alt');if(event.shiftKey)names.push('Shift');const context={modifiers:names.sort().join(','),key:event.key,vkey:'Key'+event.key.toUpperCase()};const handled=view.scope.handleKey(event,context)===false;return JSON.stringify({handled});})()`,
            );

          /** This host's own undo chord, pressed on the card. */
          const undoOnCard = () => pressOnCard("z", { [platformKey]: true });

          it("puts back a colour the card picked, for the reader's undo key", async () => {
            await pickOnCard();

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(
              await waitFor(async () => (await storedColor()) === seedColor),
            ).toBe(true);
            // The card itself shows what the undo wrote.
            expect(
              await obEvalUntil(
                vaultId!,
                `String(${card}?.getAttribute('data-annot-color'))`,
                { expected: seedColor },
              ),
            ).toBe(true);
          }, 120000);

          it("takes the top step of the Attachment's history for the card's own undo key", async () => {
            await pickOnCard();

            expect(await undoOnCard()).toEqual({ handled: true });

            expect(
              await waitFor(async () => (await storedColor()) === seedColor),
            ).toBe(true);
          }, 120000);

          describe("a tag session", () => {
            /** The Fixture's own tags on the Annotation, which each test puts back. */
            const seededTags: WireTag[] = (seeded.tags ?? []).map(
              ({ name, type }) => ({ tag: name, type }),
            );
            /** An automatic tag the session removes, so its undo must restore the type. */
            const autoTag = { tag: "e2e-auto", type: 1 };
            /** The name the session adds, which Zotero stores as manual. */
            const addedName = "e2e-card";
            const poll = { timeout: 10_000, interval: 250 };
            const { press, toggle, editorOpen, editorChips, type, remove } =
              cardTagEditor(historyKey);
            const storedTags = () => annotationTags(api, serverID, historyKey);

            const setTagsInZotero = (tags: readonly WireTag[]) =>
              setAnnotationTags(rdp, historyKey, tags);

            /**
             * The toggle's second press, which ends the session and saves it
             * once. Settles when the editor has closed onto the confirmed tags.
             */
            async function closeTagEditor(): Promise<void> {
              expect(await press(toggle)).toBe(true);
              expect(
                await obEvalUntil(
                  vaultId!,
                  `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;return String(!(${card})?.querySelector('.zt-annot-tag-input')&&repository.mutationFor(${JSON.stringify(historyKey)}).kind==='idle'&&!repository.tagDraftFor(${JSON.stringify(historyKey)}));})()`,
                  { expected: "true" },
                ),
              ).toBe(true);
            }

            beforeEach(async () => {
              await setTagsInZotero([...seededTags, autoTag]);
            });

            afterEach(async () => {
              await setTagsInZotero(seededTags);
            });

            it("puts the tags a card session changed back for the undo key, and applies them again for redo", async () => {
              expect(await press(toggle)).toBe(true);
              expect(await editorOpen()).toBe(true);
              expect(await remove(autoTag.tag)).toBe("removed");
              await type(addedName, { enter: true });
              // The chip is the signal that Enter added the name.
              await expect
                .poll(editorChips, poll)
                .toEqual([...seededTags.map(({ tag }) => tag), addedName]);
              await closeTagEditor();
              const edited = spelledTags([...seededTags, { tag: addedName }]);
              await expect.poll(storedTags, poll).toEqual(edited);

              expect(await undoKey()).toEqual({ handled: true });
              await stepSettled();

              // The whole session went back: the added name left, and the
              // automatic tag came back as automatic.
              await expect
                .poll(storedTags, poll)
                .toEqual(spelledTags([...seededTags, autoTag]));

              expect(await redoKey()).toEqual({ handled: true });
              await stepSettled();

              await expect.poll(storedTags, poll).toEqual(edited);
            }, 120000);

            it("saves a card session on a blur, keeps the editor open for the next, and records one step for each", async () => {
              const first = "e2e-blur-first";
              const second = "e2e-blur-second";
              /** Settles when no tag write or draft stands on the Annotation. */
              const tagsSettled = () =>
                obEvalUntil(
                  vaultId!,
                  `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;return String(repository.mutationFor(${JSON.stringify(historyKey)}).kind==='idle'&&!repository.tagDraftFor(${JSON.stringify(historyKey)}));})()`,
                  { expected: "true" },
                );
              const before = spelledTags([...seededTags, autoTag]);

              expect(await press(toggle)).toBe(true);
              expect(await editorOpen()).toBe(true);
              await type(first, { enter: true });
              await expect.poll(editorChips, poll).toContain(first);
              // Focus leaves the field for the view around the card. The
              // event is sent rather than the focus moved: a window without
              // the system focus sends no focus events.
              await obEval(
                vaultId!,
                `(function(){(${card}).querySelector('.zt-annot-tag-input').dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:null}));return true;})()`,
              );
              const once = spelledTags([
                ...seededTags,
                autoTag,
                { tag: first },
              ]);
              await expect.poll(storedTags, poll).toEqual(once);
              expect(await tagsSettled()).toBe(true);
              // The editor stayed open through the save.
              expect(
                await obEval(
                  vaultId!,
                  `String(!!(${card})?.querySelector('.zt-annot-tag-input'))`,
                ),
              ).toBe("true");

              // The next change starts a new session, which Escape ends and
              // saves as it closes the editor.
              await type(second, { enter: true });
              await expect.poll(editorChips, poll).toContain(second);
              await obEval(
                vaultId!,
                `(function(){(${card}).querySelector('.zt-annot-tag-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()`,
              );
              const twice = spelledTags([
                ...seededTags,
                autoTag,
                { tag: first },
                { tag: second },
              ]);
              await expect.poll(storedTags, poll).toEqual(twice);
              expect(
                await obEvalUntil(
                  vaultId!,
                  `String(!(${card})?.querySelector('.zt-annot-tag-input'))`,
                  { expected: "true" },
                ),
              ).toBe(true);
              expect(await tagsSettled()).toBe(true);

              // One History Step for each session: the first undo takes back
              // the second name alone, the next one the first.
              expect(await undoKey()).toEqual({ handled: true });
              await stepSettled();
              await expect.poll(storedTags, poll).toEqual(once);
              expect(await undoKey()).toEqual({ handled: true });
              await stepSettled();
              await expect.poll(storedTags, poll).toEqual(before);
            }, 120000);
          });
        });

        describe("a create and a delete", () => {
          /**
           * The Annotation each of these tests makes for itself. Nothing seeded
           * is erased here: a restore comes back under a key Zotero picks, so a
           * deleted seed could never be put back as the Fixture spells it.
           */
          const draft = {
            type: "highlight",
            color: "#a28ae5",
            comment: "Annotation History run",
            text: "Identify Your Message",
            pageLabel: "1",
            sortIndex: "00000|000100|00101",
            position: { pageIndex: 0, rects: [[100, 560, 300, 580]] },
          };

          const createDraft = () =>
            obJson<{ kind: string; annotationKey?: string }>(
              `(async()=>{const outcome=await app.plugins.plugins.zotlit.services.annotationRepository.createAnnotation(${JSON.stringify(attachment.key)},${JSON.stringify(draft)});return JSON.stringify(outcome);})()`,
            );

          const eraseThrough = (annotationKey: string) =>
            obJson<{ kind: string }>(
              `(async()=>{const state=await app.plugins.plugins.zotlit.services.annotationRepository.deleteAnnotation(${JSON.stringify(annotationKey)});return JSON.stringify(state);})()`,
            );

          /**
           * What the Attachment held before this test. Earlier tests in this
           * tier leave Annotations of their own standing until the suite ends,
           * so the baseline is taken per test rather than from the Fixture.
           */
          let baseline: readonly string[] = [];

          /** The one Annotation this test made, or `null` where it made none. */
          const extra = async (): Promise<string | null> =>
            (await madeSince(baseline))[0] ?? null;

          beforeEach(async () => {
            baseline = await annotationKeys();
          });

          afterEach(async () => {
            await eraseAnnotations(rdp, await madeSince(baseline));
          });

          it("takes back a create, and redoes it under a new key", async () => {
            const created = await createDraft();
            expect(created.kind).toBe("created");
            const madeKey = created.annotationKey!;

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            // Zotero is the oracle: the Annotation is gone from the Attachment.
            expect(await waitFor(async () => (await extra()) === null)).toBe(
              true,
            );

            expect(await redoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) !== null)).toBe(
              true,
            );
            const restored = (await extra())!;
            // Zotero refuses a client-supplied key, so the redo made a new one.
            expect(restored).not.toBe(madeKey);
            expect(
              await storedAnnotation(api, serverID, restored),
            ).toMatchObject({
              annotationType: draft.type,
              annotationColor: draft.color,
              annotationComment: draft.comment,
              annotationPageLabel: draft.pageLabel,
              annotationSortIndex: draft.sortIndex,
            });
          }, 120000);

          it("takes back a note the tool placed, and leaves nothing selected", async () => {
            /** Body text in the left column, clear of every seeded mark. */
            const CLEAR = [150, 250] as const;
            await armToolOnFirstPage(vaultId!, {
              pdfView,
              tool: "note",
              at: CLEAR,
            });
            await obEval(
              vaultId!,
              `(function(){${FIRE}${TAP}${clientOfFirstPage(pdfView)}const at=clientOf(${CLEAR[0]},${CLEAR[1]});tap(at.x,at.y);return true;})()`,
            );
            const noteKey = await freshAnnotationKey(rdp, {
              item: ATTACHMENT_ITEM,
              before: baseline,
            });
            const selectedMarks = `JSON.stringify([...${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected')].map((mark)=>mark.dataset.zoteroAnnotationKey))`;
            expect(
              await obEvalUntil(vaultId!, selectedMarks, {
                expected: JSON.stringify([noteKey]),
              }),
            ).toBe(true);

            // The note opens its comment sheet, and a sheet left open keeps
            // the undo key for its own text; Escape closes it.
            await obEval(
              vaultId!,
              "(function(){document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;})()",
            );
            expect(
              await obEvalUntil(
                vaultId!,
                `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;return String(!${POPUP_EDITOR}&&repository.mutationFor(${JSON.stringify(noteKey)}).kind==='idle'&&!repository.commentDraftFor(${JSON.stringify(noteKey)}));})()`,
                { expected: "true" },
              ),
            ).toBe(true);

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) === null)).toBe(
              true,
            );
            // The reader landed where the note was, with nothing selected
            // and no mark left for it.
            expect(
              await obEvalUntil(
                vaultId!,
                `(function(){const selected=${selectedMarks};const mark=${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(noteKey)}]');return JSON.stringify({selected:JSON.parse(selected),mark:!!mark});})()`,
                { expected: JSON.stringify({ selected: [], mark: false }) },
              ),
            ).toBe(true);
          }, 120000);

          it("puts a deleted Annotation back under a new key, and redoes the delete", async () => {
            const created = await createDraft();
            expect(created.kind).toBe("created");
            const madeKey = created.annotationKey!;
            const before = await storedAnnotation(api, serverID, madeKey);

            expect(await eraseThrough(madeKey)).toEqual({ kind: "idle" });
            expect(await waitFor(async () => (await extra()) === null)).toBe(
              true,
            );

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) !== null)).toBe(
              true,
            );
            const restored = (await extra())!;
            expect(restored).not.toBe(madeKey);
            // The colour, the comment and the position all came back with it.
            expect(
              await storedAnnotation(api, serverID, restored),
            ).toMatchObject({
              annotationType: before.annotationType,
              annotationColor: before.annotationColor,
              annotationComment: before.annotationComment,
              annotationPosition: before.annotationPosition,
              annotationSortIndex: before.annotationSortIndex,
            });

            // The redo erases the Annotation the restore made, not the key
            // Zotero no longer holds.
            expect(await redoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) === null)).toBe(
              true,
            );
          }, 120000);
        });
      });

      describe("the Card Selection", () => {
        /** A highlight the card is clicked on, apart from the mark clicked. */
        const cardKey = "Q8ZR4TDH";
        /** The highlight clicked in the PDF, as the history tests click it. */
        const markKey = "PUPR5FG5";
        const annotView =
          "app.workspace.getLeavesOfType('zotero-annotation-view')[0]?.view";
        const cardOf = (key: string) =>
          `${annotView}?.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]')`;
        const poll = { timeout: 10_000, interval: 250 };

        /**
         * What each surface shows selected: the Selected Cards, the marks the
         * PDF paints `is-selected`, and whether a Mark Popup stands.
         */
        const shown = () =>
          obJson<{ cards: string[]; marks: string[]; popup: boolean }>(
            `(function(){const cards=[...(${annotView}?.containerEl.querySelectorAll('.zt-annot-card[data-selected]')??[])].map((card)=>card.dataset.zoteroAnnotationKey);const marks=[...new Set([...${pdfView}.containerEl.querySelectorAll('.zt-pdf-annotation-mark.is-selected')].map((mark)=>mark.dataset.zoteroAnnotationKey))];return JSON.stringify({cards,marks,popup:!!document.querySelector('.zt-pdf-mark-popup')});})()`,
          );

        /** A plain click on one card, as the browser delivers it. */
        async function clickCard(key: string): Promise<void> {
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const card=${cardOf(key)};if(!card)return 'no card';card.click();return 'clicked';})()`,
              { expected: "clicked" },
            ),
          ).toBe(true);
        }

        beforeEach(async () => {
          // A fresh binding holds no selection and no popup from an earlier
          // test, and its first page is on screen for the marks.
          await reopenPdfView(vaultId!, attachmentPath);
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const rect=view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(markKey)}]')?.getBoundingClientRect();return String(!!rect&&rect.width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
        });

        /** A mark click in the PDF, at the mark's centre, as a researcher makes it. */
        async function tapMark(key: string): Promise<void> {
          expect(
            await obEval(
              vaultId!,
              `(function(){${FIRE}${TAP}const mark=${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]');const rect=mark.getBoundingClientRect();tap(rect.left+rect.width/2,rect.top+rect.height/2);return 'tapped';})()`,
            ),
          ).toBe("tapped");
        }

        /** Runs one Annotation View command from the palette's own registry. */
        const command = (id: string) =>
          obEval(
            vaultId!,
            `(function(){app.commands.executeCommandById(${JSON.stringify(id)});return String(${annotView}?.snapshot.followMode);})()`,
          );

        it("selects a card in Pinned mode, and clears it for Escape", async () => {
          expect(await command("zotlit:annot-view-pin-current-item")).toBe(
            "pinned",
          );
          try {
            await clickCard(cardKey);
            // Pinned binds no reader, so the PDF beside it selects nothing.
            await expect
              .poll(shown, poll)
              .toEqual({ cards: [cardKey], marks: [], popup: false });

            // Escape on the focused card of the active view, which Obsidian's
            // keymap hands to that view's Scope.
            expect(
              await obJson<{ prevented: boolean }>(
                `(function(){const leaf=app.workspace.getLeavesOfType('zotero-annotation-view')[0];app.workspace.setActiveLeaf(leaf,{focus:true});const card=${cardOf(cardKey)};card.focus();const event=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true});card.dispatchEvent(event);return JSON.stringify({prevented:event.defaultPrevented});})()`,
              ),
            ).toEqual({ prevented: true });
            await expect
              .poll(shown, poll)
              .toEqual({ cards: [], marks: [], popup: false });
          } finally {
            await command("zotlit:annot-view-unpin");
            // The PDF is the active tab the view follows again.
            await obEval(
              vaultId!,
              `(function(){app.workspace.setActiveLeaf(${pdfView}.leaf,{focus:true});return true;})()`,
            );
          }
        }, 120000);

        it("lands quietly on a clicked card's mark, and selects the card of a clicked mark", async () => {
          expect(
            await obEval(vaultId!, `String(${annotView}?.snapshot.followMode)`),
          ).toBe("active-tab");
          // The PDF stands pages away, so the mark in view is the Landing's
          // own scroll: the last step it takes.
          await obEval(
            vaultId!,
            `(function(){${pdfView}.viewer.child.pdfViewer.pdfViewer.currentPageNumber=4;return true;})()`,
          );

          await clickCard(cardKey);
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};const box=view.viewer.child.pdfViewer.pdfViewer.container.getBoundingClientRect();const mark=view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(cardKey)}]');const rect=mark?.getBoundingClientRect();return String(!!mark&&mark.classList.contains('is-selected')&&rect.top>=box.top&&rect.bottom<=box.bottom);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          // With the Landing done, no Mark Popup stands over the mark.
          expect(await shown()).toEqual({
            cards: [cardKey],
            marks: [cardKey],
            popup: false,
          });

          await tapMark(markKey);
          // The mark click replaces the Card Selection.
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [markKey], marks: [markKey] });
        }, 120000);

        it("keeps one editor open on a card: its comment editor or its tag editor, from the card or the Mark Popup", async () => {
          await raiseWindow(vaultId!);
          await clickCard(cardKey);
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [cardKey], marks: [cardKey] });
          const card = cardOf(cardKey);
          const toggle = (icon: string) =>
            `${card}?.querySelector('.clickable-icon:has(svg.lucide-${icon})')`;
          /** Which of the card's two editors stand. */
          const editors = () =>
            obJson<{ comment: boolean; tags: boolean }>(
              `JSON.stringify({comment:!!${card}?.querySelector('.cm-content'),tags:!!${card}?.querySelector('[data-slot=tags-input]')})`,
            );

          await trustedClick(toggle("message-square-plus"));
          await expect
            .poll(editors, poll)
            .toEqual({ comment: true, tags: false });

          // The tag toggle saves and closes the comment editor first.
          await trustedClick(toggle("tag"));
          await expect
            .poll(editors, poll)
            .toEqual({ comment: false, tags: true });

          // The comment toggle ends the tag session first.
          await trustedClick(toggle("message-square-plus"));
          await expect
            .poll(editors, poll)
            .toEqual({ comment: true, tags: false });

          // The Mark Popup's way to the card's comment editor ends the tag
          // session first as well.
          await trustedClick(toggle("tag"));
          await expect
            .poll(editors, poll)
            .toEqual({ comment: false, tags: true });
          await obEval(
            vaultId!,
            `(function(){${annotView}.revealAnnotation(${JSON.stringify(cardKey)},{comment:true});return true;})()`,
          );
          await expect
            .poll(editors, poll)
            .toEqual({ comment: true, tags: false });

          // Escape in the editor closes it.
          expect(
            await obEval(
              vaultId!,
              `(function(){const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});contents.sendInputEvent({type:'keyUp',keyCode:'Escape'});return 'pressed';})()`,
            ),
          ).toBe("pressed");
          await expect
            .poll(editors, poll)
            .toEqual({ comment: false, tags: false });
        }, 120000);

        /**
         * A press and release the window's own input delivers at the centre
         * of what `target` names, so the focus moves as a researcher's click
         * moves it.
         *
         * @param modifiers the keys held through the click, as Electron names
         *   them: `shift`, `meta`, `control`.
         */
        async function trustedClick(
          target: string,
          modifiers: readonly string[] = [],
        ): Promise<void> {
          const held = JSON.stringify(modifiers);
          expect(
            await obEval(
              vaultId!,
              `(function(){const rect=(${target}).getBoundingClientRect();const zoom=require('electron').webFrame.getZoomFactor();const x=Math.round((rect.left+rect.width/2)*zoom),y=Math.round((rect.top+rect.height/2)*zoom);const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1,modifiers:${held}});contents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1,modifiers:${held}});return 'clicked';})()`,
            ),
          ).toBe("clicked");
        }

        it("keeps the card an editor is open on through a mark click, and takes the mark once it closes", async () => {
          await raiseWindow(vaultId!);
          await clickCard(cardKey);
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [cardKey], marks: [cardKey] });
          const editor = `${cardOf(cardKey)}?.querySelector('.cm-content')`;
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){if(${editor})return 'open';${cardOf(cardKey)}?.querySelector('.clickable-icon:has(.lucide-message-square-plus)')?.click();return String(!!${editor}&&'open');})()`,
              { expected: "open" },
            ),
          ).toBe(true);
          await trustedClick(editor);
          expect(
            await obEvalUntil(
              vaultId!,
              `String(!!${editor}?.contains(document.activeElement))`,
              { expected: "true" },
            ),
          ).toBe(true);

          // The click in the PDF takes the focus out of the editor, which
          // saves and stays open; the card keeps the selection.
          await trustedClick(
            `${pdfView}.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(markKey)}]')`,
          );
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [cardKey], marks: [markKey] });
          expect(
            await obEval(
              vaultId!,
              `JSON.stringify({open:!!${editor},focused:!!${editor}?.contains(document.activeElement)})`,
            ),
          ).toBe(JSON.stringify({ open: true, focused: false }));

          // Escape back in the editor closes it, and the PDF's selection
          // applies.
          await trustedClick(editor);
          expect(
            await obEval(
              vaultId!,
              `(function(){const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});contents.sendInputEvent({type:'keyUp',keyCode:'Escape'});return 'pressed';})()`,
            ),
          ).toBe("pressed");
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [markKey], marks: [markKey] });
          expect(await obEval(vaultId!, `String(!!${editor})`)).toBe("false");
        }, 120000);

        describe("a Text Edit", () => {
          const highlight = seededMark(cardKey, { image: false });
          const editText = `${cardOf(cardKey)}?.querySelector('.clickable-icon:has(svg.lucide-text-cursor-input)')`;
          const editor = `${cardOf(cardKey)}?.querySelector('blockquote .cm-content')`;

          afterEach(highlight.restore);

          it("saves a correction typed after Edit text in Pinned mode, with its range and Sort Index kept", async () => {
            await raiseWindow(vaultId!);
            expect(await command("zotlit:annot-view-pin-current-item")).toBe(
              "pinned",
            );
            try {
              // A card not selected alone offers no Edit text.
              expect(await obEval(vaultId!, `String(!!${editText})`)).toBe(
                "false",
              );
              await clickCard(cardKey);
              expect(
                await obEvalUntil(vaultId!, `String(!!${editText})`, {
                  expected: "true",
                }),
              ).toBe(true);

              await trustedClick(editText);
              // The editor opens in the Excerpt Block with the caret in it.
              expect(
                await obEvalUntil(
                  vaultId!,
                  `String(!!${editor}?.contains(document.activeElement))`,
                  { expected: "true" },
                ),
              ).toBe(true);
              // Typed where the caret stands: at the end of the text.
              await obEval(
                vaultId!,
                "(function(){require('@electron/remote').getCurrentWebContents().insertText(' Checked.');return true;})()",
              );
              await trustedClick(
                `[...${cardOf(cardKey)}.querySelectorAll('button')].find((button)=>button.textContent==='Done')`,
              );

              const corrected = `${highlight.seed.annotationText} Checked.`;
              expect(
                await waitFor(
                  async () =>
                    (await highlight.stored()).data.annotationText ===
                    corrected,
                ),
              ).toBe(true);
              expect((await highlight.stored()).data).toMatchObject({
                annotationPosition: highlight.seed.annotationPosition,
                annotationSortIndex: highlight.seed.annotationSortIndex,
              });
              // Done closed the editor, and the card quotes the correction.
              expect(
                await obEvalUntil(
                  vaultId!,
                  `String(!${editor}&&${cardOf(cardKey)}.querySelector('blockquote').textContent===${JSON.stringify(corrected)})`,
                  { expected: "true" },
                ),
              ).toBe(true);
            } finally {
              await command("zotlit:annot-view-unpin");
              await obEval(
                vaultId!,
                `(function(){app.workspace.setActiveLeaf(${pdfView}.leaf,{focus:true});return true;})()`,
              );
            }
          }, 120000);

          it("rests Edit text dimmed while editing is not live, and its press says why", async () => {
            await raiseWindow(vaultId!);
            await whileEditingNotLive(async () => {
              await obEval(
                vaultId!,
                "(function(){for(const node of document.querySelectorAll('.notice'))node.remove();return true;})()",
              );
              await clickCard(cardKey);
              expect(
                await obEvalUntil(
                  vaultId!,
                  `String(${editText}?.hasAttribute('data-blocked'))`,
                  { expected: "true" },
                ),
              ).toBe(true);
              expect(
                await obEval(vaultId!, `getComputedStyle(${editText}).opacity`),
              ).toBe("0.5");

              await trustedClick(editText);
              expect(
                await obEvalUntil(
                  vaultId!,
                  `String([...document.querySelectorAll('.zt-notice')].some((node)=>node.textContent.includes(${JSON.stringify("Allow other applications on this computer to communicate with Zotero")})))`,
                  { expected: "true" },
                ),
              ).toBe(true);
              // The press opened no editor.
              expect(await obEval(vaultId!, `String(!!${editor})`)).toBe(
                "false",
              );
            });
          }, 120000);
        });

        /** A key the window's own input delivers to whatever holds the focus. */
        async function press(keyCode: string): Promise<void> {
          expect(
            await obEval(
              vaultId!,
              `(function(){const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)}});contents.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)}});return 'pressed';})()`,
            ),
          ).toBe("pressed");
        }

        it("moves to the next card in list order for ↓ on a focused card, and lands quietly on its mark; ↓ in a text field moves nothing", async () => {
          await raiseWindow(vaultId!);
          expect(
            await obEval(vaultId!, `String(${annotView}?.snapshot.followMode)`),
          ).toBe("active-tab");
          // The card after the clicked one, in the order the grid holds its
          // rows.
          const next = await obEval(
            vaultId!,
            `(function(){const rows=[...${annotView}.containerEl.querySelectorAll('[role="grid"] > [role="row"]')].map((row)=>row.dataset.zoteroAnnotationKey);return String(rows[rows.indexOf(${JSON.stringify(cardKey)})+1]);})()`,
          );
          expect(next).toMatch(/^[A-Z0-9]{8}$/);

          await trustedClick(cardOf(cardKey));
          await expect
            .poll(shown, poll)
            .toEqual({ cards: [cardKey], marks: [cardKey], popup: false });
          expect(
            await obEval(
              vaultId!,
              `String(document.activeElement===${cardOf(cardKey)})`,
            ),
          ).toBe("true");
          // The PDF stands pages away, so the next mark in view is the
          // Landing's own scroll.
          await obEval(
            vaultId!,
            `(function(){${pdfView}.viewer.child.pdfViewer.pdfViewer.currentPageNumber=4;return true;})()`,
          );

          await press("Down");
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};const box=view.viewer.child.pdfViewer.pdfViewer.container.getBoundingClientRect();const mark=view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(next)}]');const rect=mark?.getBoundingClientRect();return String(!!mark&&mark.classList.contains('is-selected')&&rect.top>=box.top&&rect.bottom<=box.bottom);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          expect(await shown()).toEqual({
            cards: [next],
            marks: [next],
            popup: false,
          });
          expect(
            await obEval(
              vaultId!,
              `String(document.activeElement===${cardOf(next)}&&${cardOf(next)}.tabIndex===0)`,
            ),
          ).toBe("true");

          // The search field holds the focus, and ↓ is the field's. Its own
          // keyup says the keydown before it has run its course.
          const search = `${annotView}.containerEl.querySelector('input[placeholder^="Search annotations"]')`;
          const toggleSearch = `${annotView}.containerEl.querySelector('[aria-label="Search annotations"]').click()`;
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){if(!${search})${toggleSearch};const input=${search};if(!input)return 'closed';input.focus();return String(document.activeElement===input&&'focused');})()`,
              { expected: "focused" },
            ),
          ).toBe(true);
          try {
            await obEval(
              vaultId!,
              `(function(){const input=${search};input.dataset.ztKeyUp='';input.addEventListener('keyup',()=>{input.dataset.ztKeyUp='done';},{once:true});return true;})()`,
            );
            await press("Down");
            expect(
              await obEvalUntil(
                vaultId!,
                `String(${search}?.dataset.ztKeyUp)`,
                {
                  expected: "done",
                },
              ),
            ).toBe(true);
            expect(await shown()).toEqual({
              cards: [next],
              marks: [next],
              popup: false,
            });
          } finally {
            await obEval(
              vaultId!,
              `(function(){if(${search})${toggleSearch};return true;})()`,
            );
          }
        }, 120000);

        it("toggles a card for a Cmd/Ctrl-click on its comment text, and opens no editor", async () => {
          await raiseWindow(vaultId!);
          const mod = await obEval(
            vaultId!,
            "process.platform==='darwin'?'meta':'control'",
          );
          const baseline = await annotationKeys();
          /** Two commented highlights this test makes for itself. */
          const drafts = [1, 2].map((n) => ({
            type: "highlight",
            color: "#a28ae5",
            comment: `Comment click ${n}`,
            text: "Identify Your Message",
            pageLabel: "1",
            sortIndex: `00000|000100|0010${n}`,
            position: {
              pageIndex: 0,
              rects: [[100, 560 - n * 30, 300, 580 - n * 30]],
            },
          }));
          const made = await obJson<string[]>(
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const keys=[];for(const draft of ${JSON.stringify(drafts)}){const outcome=await repository.createAnnotation(${JSON.stringify(attachment.key)},draft);keys.push(outcome.annotationKey);}return JSON.stringify(keys);})()`,
          );
          try {
            expect(made).toHaveLength(2);
            const [first, second] = made as [string, string];
            /** A card's rendered comment, scrolled into the list's view. */
            const comment = (key: string) =>
              `(function(){const el=${cardOf(key)}.querySelector('.zt-annot-comment');el.scrollIntoView({block:'center'});return el;})()`;
            const editorOpen = () =>
              obEval(
                vaultId!,
                `String(!!${annotView}?.containerEl.querySelector('.zt-annot-card .cm-content'))`,
              );
            await clickCard(first);
            await expect.poll(shown, poll).toMatchObject({ cards: [first] });

            // Cmd/Ctrl-click on the comment text adds the card, as a click
            // on its excerpt does.
            await trustedClick(comment(second), [mod]);
            await expect
              .poll(async () => (await shown()).cards.toSorted(), poll)
              .toEqual([first, second].toSorted());
            expect(await editorOpen()).toBe("false");

            // Again, and it leaves.
            await trustedClick(comment(second), [mod]);
            await expect.poll(shown, poll).toMatchObject({ cards: [first] });
            expect(await editorOpen()).toBe("false");
          } finally {
            await eraseAnnotations(rdp, await madeSince(baseline));
          }
        }, 120000);

        it("adds a card for Cmd/Ctrl-click, takes a range for Shift-click and every card for Cmd/Ctrl+A, and lands only on an added card", async () => {
          await raiseWindow(vaultId!);
          /** An underline and a highlight on page 1, and an image on page 2. */
          const [underline, highlight, image] = [
            "K3JRFLFQ",
            markKey,
            "FDRFQ7C2",
          ] as const;
          const mod = await obEval(
            vaultId!,
            "process.platform==='darwin'?'meta':'control'",
          );
          /** A card's excerpt, scrolled into the list's view: the card's own click. */
          const excerpt = (key: string) =>
            `(function(){const card=${cardOf(key)};const el=card.querySelector('blockquote')??card;el.scrollIntoView({block:'center'});return el;})()`;
          /** What `shown` answers, in a stable order for either surface. */
          const sorted = async () => {
            const { cards, marks, popup } = await shown();
            return { cards: cards.toSorted(), marks: marks.toSorted(), popup };
          };
          const page = () =>
            obEval(
              vaultId!,
              `String(${pdfView}.viewer.child.pdfViewer.pdfViewer.currentPageNumber)`,
            );
          const toTop = () =>
            obEval(
              vaultId!,
              `(function(){${pdfView}.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;return 'top';})()`,
            );
          /**
           * Every card from one to the other in the list's own order, read off
           * the grid: an earlier test can leave an Annotation of its own
           * between them.
           */
          const rangeOf = async (from: string, to: string) => {
            const rows = await obJson<string[]>(
              `JSON.stringify([...${annotView}.containerEl.querySelectorAll('[role="grid"] > [role="row"]')].map((row)=>row.dataset.zoteroAnnotationKey))`,
            );
            const [a, b] = [rows.indexOf(from), rows.indexOf(to)].toSorted(
              (x, y) => x - y,
            );
            return rows.slice(a, b! + 1).toSorted();
          };

          await trustedClick(excerpt(underline));
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [underline], marks: [underline], popup: false });

          // Cmd/Ctrl-click adds a card: the PDF paints both marks, with no popup.
          await trustedClick(excerpt(highlight), [mod]);
          await expect.poll(sorted, poll).toEqual({
            cards: [underline, highlight].toSorted(),
            marks: [underline, highlight].toSorted(),
            popup: false,
          });

          // Shift-click takes the range from the card the Cmd/Ctrl-click
          // anchored, and drops the card outside it.
          const anchored = await rangeOf(highlight, cardKey);
          expect(anchored).not.toContain(underline);
          await trustedClick(excerpt(cardKey), ["shift"]);
          await expect.poll(sorted, poll).toEqual({
            cards: anchored,
            marks: anchored,
            popup: false,
          });

          // Cmd/Ctrl+A takes every card the list shows.
          const every = JSON.parse(
            await obEval(
              vaultId!,
              `JSON.stringify([...${annotView}.containerEl.querySelectorAll('.zt-annot-card')].map((card)=>card.dataset.zoteroAnnotationKey).sort())`,
            ),
          ) as string[];
          expect(
            await obEval(
              vaultId!,
              `(function(){const contents=require('@electron/remote').getCurrentWebContents();contents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['${mod}']});contents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['${mod}']});return 'pressed';})()`,
            ),
          ).toBe("pressed");
          await expect
            .poll(async () => (await sorted()).cards, poll)
            .toEqual(every);

          // A Cmd/Ctrl-click that adds a card on page 2 lands the PDF there.
          await trustedClick(excerpt(underline));
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [underline], marks: [underline], popup: false });
          await toTop();
          await expect.poll(page, poll).toBe("1");
          await trustedClick(excerpt(image), [mod]);
          await expect.poll(page, poll).toBe("2");
          expect((await sorted()).cards).toEqual([underline, image].toSorted());

          // Removing it only repaints: the PDF stays where it was put.
          await toTop();
          await expect.poll(page, poll).toBe("1");
          await trustedClick(excerpt(image), [mod]);
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [underline], marks: [underline], popup: false });
          expect(await page()).toBe("1");

          // Removing the last card keeps its anchor through the PDF's echo, so
          // a Shift-click still measures from it.
          await trustedClick(excerpt(underline), [mod]);
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [], marks: [], popup: false });
          const kept = await rangeOf(underline, cardKey);
          await trustedClick(excerpt(cardKey), ["shift"]);
          await expect.poll(sorted, poll).toEqual({
            cards: kept,
            marks: kept,
            popup: false,
          });
        }, 120000);

        it("deletes a group of two Cmd/Ctrl-clicked cards after one counted confirmation, and one undo restores both", async () => {
          const baseline = await annotationKeys();
          /** Two highlights this test makes for itself: no seed is erased. */
          const drafts = [1, 2].map((n) => ({
            type: "highlight",
            color: "#a28ae5",
            comment: `Group delete ${n}`,
            text: "Identify Your Message",
            pageLabel: "1",
            sortIndex: `00000|000100|0010${n}`,
            position: {
              pageIndex: 0,
              rects: [[100, 560 - n * 30, 300, 580 - n * 30]],
            },
          }));
          const made = await obJson<string[]>(
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const keys=[];for(const draft of ${JSON.stringify(drafts)}){const outcome=await repository.createAnnotation(${JSON.stringify(attachment.key)},draft);keys.push(outcome.annotationKey);}return JSON.stringify(keys);})()`,
          );
          try {
            expect(made).toHaveLength(2);
            const [first, second] = made as [string, string];
            await clickCard(first);
            // Cmd/Ctrl-click adds the second card to the Card Selection.
            expect(
              await obEvalUntil(
                vaultId!,
                `(function(){const card=${cardOf(second)};if(!card)return 'no card';card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,${platformKey}:true}));return 'clicked';})()`,
                { expected: "clicked" },
              ),
            ).toBe(true);
            await expect.poll(shown, poll).toMatchObject({
              cards: expect.arrayContaining(made),
              marks: expect.arrayContaining(made),
            });
            expect((await shown()).cards).toHaveLength(2);

            // Delete on the focused card of the active view, which Obsidian's
            // keymap hands to that view's Scope.
            expect(
              await obJson<{ prevented: boolean }>(
                `(function(){const leaf=app.workspace.getLeavesOfType('zotero-annotation-view')[0];app.workspace.setActiveLeaf(leaf,{focus:true});const card=${cardOf(second)};card.focus();const event=new KeyboardEvent('keydown',{key:'Delete',code:'Delete',bubbles:true,cancelable:true});card.dispatchEvent(event);return JSON.stringify({prevented:event.defaultPrevented});})()`,
              ),
            ).toEqual({ prevented: true });
            // The confirmation names the count, and nothing is erased before
            // it is confirmed.
            expect(
              await obEvalUntil(
                vaultId!,
                `String(document.querySelector('.modal-container .modal-title')?.textContent)`,
                { expected: "Delete 2 annotations?" },
              ),
            ).toBe(true);
            expect(await madeSince(baseline)).toEqual(
              expect.arrayContaining(made),
            );
            expect(
              await obEval(
                vaultId!,
                `(function(){const button=[...document.querySelectorAll('.modal-container .modal-button-container button')].find((node)=>node.textContent==='Delete');button.click();return 'confirmed';})()`,
              ),
            ).toBe("confirmed");

            // Zotero is the oracle: it holds neither Annotation.
            expect(
              await waitFor(
                async () => (await madeSince(baseline)).length === 0,
              ),
            ).toBe(true);
            await expect.poll(shown, poll).toMatchObject({ cards: [] });
            // ZotLit has read both deletes back, so the undo key finds no
            // write still on its way, which it would turn away.
            expect(
              await obEvalUntil(
                vaultId!,
                `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;return String(${JSON.stringify(made)}.every((key)=>repository.mutationFor(key).kind==='idle'));})()`,
                { expected: "true" },
              ),
            ).toBe(true);

            // One press of the undo key restores both, each under a new key.
            // The chord goes to the PDF view's own Scope, so the view that
            // follows the active tab has no list to read again while the
            // restores are sent.
            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();
            expect(
              await waitFor(
                async () => (await madeSince(baseline)).length === 2,
              ),
            ).toBe(true);
            const restored = await madeSince(baseline);
            expect(restored.some((key) => made.includes(key))).toBe(false);
            const comments = await Promise.all(
              restored.map(
                async (key) =>
                  (await storedAnnotation(api, serverID, key))
                    .annotationComment,
              ),
            );
            expect(comments.toSorted()).toEqual([
              "Group delete 1",
              "Group delete 2",
            ]);
          } finally {
            // A confirmation left open by a failed step would block every
            // later test; its close answers "cancel".
            await obEval(
              vaultId!,
              "(function(){for(const modal of app.workspace.containerEl.doc.querySelectorAll('.modal-container .modal-close-button'))modal.click();return true;})()",
            );
            // The PDF is the active tab the view follows again.
            await obEval(
              vaultId!,
              `(function(){app.workspace.setActiveLeaf(${pdfView}.leaf,{focus:true});return true;})()`,
            );
            await eraseAnnotations(rdp, await madeSince(baseline));
          }
        }, 120000);

        /**
         * Two highlights of two colours and two quoted texts, which a test
         * makes for itself, with both cards selected: a click on the first
         * and a Cmd/Ctrl-click on the second. The Annotations are erased
         * after `run`, whatever it leaves.
         */
        async function withGroupOfTwo(
          run: (made: readonly [string, string]) => Promise<void>,
        ): Promise<void> {
          const baseline = await annotationKeys();
          const drafts = [
            { n: 1, color: "#a28ae5", text: "Identify Your Message" },
            { n: 2, color: "#ff6666", text: "Know Your Audience" },
          ].map(({ n, color, text }) => ({
            type: "highlight",
            color,
            comment: `Group recolour ${n}`,
            text,
            pageLabel: "1",
            sortIndex: `00000|000100|0010${n}`,
            position: {
              pageIndex: 0,
              rects: [[100, 560 - n * 30, 300, 580 - n * 30]],
            },
          }));
          const made = await obJson<string[]>(
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const keys=[];for(const draft of ${JSON.stringify(drafts)}){const outcome=await repository.createAnnotation(${JSON.stringify(attachment.key)},draft);keys.push(outcome.annotationKey);}return JSON.stringify(keys);})()`,
          );
          try {
            expect(made).toHaveLength(2);
            const [first, second] = made as [string, string];
            await clickCard(first);
            expect(
              await obEvalUntil(
                vaultId!,
                `(function(){const card=${cardOf(second)};if(!card)return 'no card';card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,${platformKey}:true}));return 'clicked';})()`,
                { expected: "clicked" },
              ),
            ).toBe(true);
            await expect.poll(shown, poll).toMatchObject({
              cards: expect.arrayContaining(made),
              marks: expect.arrayContaining(made),
            });
            await run([first, second]);
          } finally {
            await eraseAnnotations(rdp, await madeSince(baseline));
          }
        }

        /** Each Annotation's colour, as Zotero holds it. */
        const colorsOf = (keys: readonly string[]) =>
          Promise.all(keys.map((key) => annotationColor(api, serverID, key)));

        /**
         * Waits until Zotero holds green on both, and ZotLit has read both
         * writes back, then presses the undo key once and waits until Zotero
         * holds both first colours again.
         */
        async function expectOneUndoReturnsBoth(
          made: readonly string[],
        ): Promise<void> {
          // Zotero is the oracle: it holds the one colour on both.
          expect(
            await waitFor(async () =>
              (await colorsOf(made)).every((color) => color === "#5fb236"),
            ),
          ).toBe(true);
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const repository=app.plugins.plugins.zotlit.services.annotationRepository;return String(${JSON.stringify(made)}.every((key)=>repository.mutationFor(key).kind==='idle'));})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          // The chord goes to the PDF view's own Scope, and no tab switches
          // while the undo writes are sent.
          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();
          expect(
            await waitFor(
              async () =>
                JSON.stringify(await colorsOf(made)) ===
                JSON.stringify(["#a28ae5", "#ff6666"]),
            ),
          ).toBe(true);
        }

        it("recolours a group of two Cmd/Ctrl-clicked cards with a reader colour key, and one undo returns both colours", async () => {
          await withGroupOfTwo(async (made) => {
            // `3` is the palette's third swatch, green.
            expect(await pressKey("3", {})).toEqual({ prevented: true });
            await expectOneUndoReturnsBoth(made);
          });
        }, 120000);

        it("recolours a group from the palette of a card in it, and one undo returns both colours", async () => {
          // The menu is Obsidian's own DOM menu here, so its entry is found
          // and clicked as a researcher clicks it.
          const nativeMenus = await obEval(
            vaultId!,
            "String(app.vault.getConfig('nativeMenus'))",
          );
          await obEval(
            vaultId!,
            "(app.vault.setConfig('nativeMenus',false),true)",
          );
          try {
            await withGroupOfTwo(async (made) => {
              expect(
                await obEvalUntil(
                  vaultId!,
                  `(function(){const button=${cardOf(made[1])}?.querySelector('[aria-label=${JSON.stringify("Change color")}]');if(!button)return 'no button';button.click();const green=[...document.querySelectorAll('.menu .menu-item')].find((item)=>item.textContent.trim()==='Green');if(!green)return 'no menu';green.click();return 'picked';})()`,
                  { expected: "picked" },
                ),
              ).toBe(true);
              await expectOneUndoReturnsBoth(made);
            });
          } finally {
            await obEval(
              vaultId!,
              `(app.vault.setConfig('nativeMenus',${nativeMenus === "true"}),true)`,
            );
          }
        }, 120000);

        it("recolours a group with a colour key on the view, and one undo returns both colours", async () => {
          await withGroupOfTwo(async (made) => {
            // `3` on the focused card, through the view's own Scope, is the
            // palette's third swatch, green.
            expect(
              await obJson<{ handled: boolean }>(
                `(function(){const card=${cardOf(made[1])};card.focus();const event=new KeyboardEvent('keydown',{key:'3',bubbles:true,cancelable:true});Object.defineProperty(event,'target',{value:card});const handled=${annotView}.scope.handleKey(event,{modifiers:'',key:'3',vkey:'Digit3'})===false;return JSON.stringify({handled});})()`,
              ),
            ).toEqual({ handled: true });
            await expectOneUndoReturnsBoth(made);
          });
        }, 120000);

        it("copies the quoted text of a group for Cmd/Ctrl+C on the view, in list order", async () => {
          await withGroupOfTwo(async (made) => {
            const clipboard = (text: string | null) =>
              obEval(
                vaultId!,
                `(function(){const {clipboard}=require('electron');${text === null ? "" : `clipboard.writeText(${JSON.stringify(text)});`}return clipboard.readText();})()`,
              );
            await clipboard("before");
            // Cmd/Ctrl+C on the focused card, through the view's own Scope.
            expect(
              await obJson<{ handled: boolean }>(
                `(function(){const card=${cardOf(made[1])};card.focus();const event=new KeyboardEvent('keydown',{key:'c',${platformKey}:true,bubbles:true,cancelable:true});Object.defineProperty(event,'target',{value:card});const handled=${annotView}.scope.handleKey(event,{modifiers:${JSON.stringify(platformKey === "metaKey" ? "Meta" : "Ctrl")},key:'c',vkey:'KeyC'})===false;return JSON.stringify({handled});})()`,
              ),
            ).toEqual({ handled: true });
            expect(
              await waitFor(
                async () =>
                  (await clipboard(null)) ===
                  "Identify Your Message\n\nKnow Your Audience",
              ),
            ).toBe(true);
          });
        }, 120000);

        it("selects both cards of a Zotero Reader selection of two annotations", async () => {
          /** Selects these Annotations in Zotero's own Reader, as its sidebar does. */
          const selectInZotero = (keys: readonly string[]) =>
            rdp.json<string[]>(`(() => {
              const reader = Zotero.Reader._readers.find(
                (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
              );
              // The Reader is the one the Companion reports as active.
              Zotero_Tabs.select(reader.tabID);
              reader._internalReader.setSelectedAnnotations(
                Components.utils.cloneInto(${JSON.stringify(keys)}, reader._iframeWindow),
              );
              return [...reader._internalReader._state.selectedAnnotationIDs];
            })()`);
          const cards = () =>
            obJson<{ mode: string; cards: string[] }>(
              `(function(){const view=${annotView};return JSON.stringify({mode:view.snapshot.followMode,cards:[...view.containerEl.querySelectorAll('.zt-annot-card[data-selected]')].map((card)=>card.dataset.zoteroAnnotationKey)});})()`,
            );

          await obEval(
            vaultId!,
            "app.commands.executeCommandById('zotlit:annot-view-follow-zotero-reader');true",
          );
          try {
            expect(await selectInZotero([markKey, cardKey])).toEqual([
              markKey,
              cardKey,
            ]);
            // Both cards, in list order, whichever order Zotero holds them in.
            await expect.poll(cards, poll).toEqual({
              mode: "zotero-reader",
              cards: [cardKey, markKey],
            });

            // A Zotero Reader clear clears the Card Selection too.
            await selectInZotero([]);
            await expect
              .poll(cards, poll)
              .toEqual({ mode: "zotero-reader", cards: [] });
          } finally {
            await selectInZotero([]);
            await obEval(
              vaultId!,
              "app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');true",
            );
          }
        }, 120000);
      });

      // The one place a confirmed write can land: the Local API is serving
      // this Attachment, so a saved colour edit really moves the pixels the
      // card paints, and the card's own publication of them is observable.
      it("keeps painting through a saved edit, then publishes the edited pixels", async (context) => {
        await verifySavedEditDisplay(vaultId!, context);
      }, 120000);

      it("saves a comment from a pop-out card's native Scope", async () => {
        const card = `app.workspace.getLeavesOfType('zotero-annotation-view').map(leaf=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')).find(Boolean)`;
        const readerPdf = `app.workspace.getLeavesOfType('pdf').find(({view})=>view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]'))?.view.containerEl`;
        await obEval(
          vaultId!,
          `(function(){const leaf=app.workspace.getLeavesOfType('zotero-annotation-view')[0];if(!leaf)return false;leaf.view.gestures.onPinCurrentItem();app.workspace.moveLeafToPopout(leaf);return true;})()`,
        );
        expect(
          await obEvalUntil(
            vaultId!,
            `String((()=>{const cardWin=app.workspace.getLeavesOfType('zotero-annotation-view').find(({view})=>view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]'))?.view.containerEl.win;return !!cardWin&&cardWin!==(${readerPdf})?.win;})())`,
            { expected: "true" },
          ),
        ).toBe(true);
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){const comment=(${card})?.querySelector('.zt-annot-comment');if(!comment)return false;comment.click();return true;})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        expect(
          await obEvalUntil(
            vaultId!,
            `String(!!(${card})?.querySelector('.cm-content'))`,
            {
              expected: "true",
            },
          ),
        ).toBe(true);

        const shortcutComment = "Saved by pop-out card Mod+Enter";
        await obEval(
          vaultId!,
          `(function(){const editor=(${card}).querySelector('.cm-content');editor.focus();editor.doc.execCommand('selectAll');editor.doc.execCommand('insertText',false,${JSON.stringify(shortcutComment)});return true;})()`,
        );
        const shortcut = JSON.parse(
          await obEval(
            vaultId!,
            `(function(){const editor=(${card}).querySelector('.cm-content');const mac=editor.win.navigator.platform.startsWith('Mac');const event=new editor.win.KeyboardEvent('keydown',{key:'Enter',metaKey:mac,ctrlKey:!mac,bubbles:true,cancelable:true});editor.dispatchEvent(event);return JSON.stringify({prevented:event.defaultPrevented,open:editor.isConnected,owned:editor.win!==(${readerPdf}).win});})()`,
          ),
        ) as { prevented: boolean; open: boolean; owned: boolean };
        expect(shortcut).toEqual({ prevented: true, open: true, owned: true });
        expect(
          await waitFor(
            async () =>
              (await readAnnotationState(api, serverID, createdKey)).comment ===
              shortcutComment,
          ),
        ).toBe(true);
        expect(
          await obEval(
            vaultId!,
            `String(!!(${card})?.querySelector('.cm-content'))`,
          ),
        ).toBe("true");

        // Done saves what was typed and closes the editor.
        const doneComment = "Saved by pop-out card Done";
        await obEval(
          vaultId!,
          `(function(){const editor=(${card}).querySelector('.cm-content');editor.focus();editor.doc.execCommand('selectAll');editor.doc.execCommand('insertText',false,${JSON.stringify(doneComment)});[...(${card}).querySelectorAll('button')].find((button)=>button.textContent==='Done').click();return true;})()`,
        );
        expect(
          await waitFor(
            async () =>
              (await readAnnotationState(api, serverID, createdKey)).comment ===
              doneComment,
          ),
        ).toBe(true);
        expect(
          await obEval(
            vaultId!,
            `String(!!(${card})?.querySelector('.cm-content'))`,
          ),
        ).toBe("false");
        await obEval(
          vaultId!,
          `(function(){const leaf=app.workspace.getLeavesOfType('zotero-annotation-view')[0];leaf.detach();app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
        );
      }, 120000);

      it("carries a Zotero-side change back into Obsidian", async () => {
        // Written through Zotero's data layer over RDP rather than through a
        // click in its Reader: the Reader saves the same way, so the Freshness
        // Signal this exercises is the same one, but the name should not claim
        // a gesture that was not made.
        const fromZotero = "Edited in Zotero";
        await rdp.json(`(async () => {
          const item = Zotero.Items.getByLibraryAndKey(
            Zotero.Libraries.userLibraryID,
            ${JSON.stringify(createdKey)},
          );
          item.annotationComment = ${JSON.stringify(fromZotero)};
          await item.saveTx();
          return "saved";
        })()`);

        expect(
          await obEvalUntil(
            vaultId!,
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.read(${JSON.stringify(attachment.key)});return String(app.workspace.getLeavesOfType('zotero-annotation-view').map(leaf=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')).find(Boolean)?.textContent.includes(${JSON.stringify(fromZotero)}));})()`,
            { expected: "true" },
          ),
        ).toBe(true);
      }, 120000);

      it("recovers an unchanged unavailable ink card through the actual Refresh gesture", async () => {
        await verifyExcerptRefresh(vaultId!);
      }, 120000);

      it("refreshes external comments by focus and manual action without the Companion", async () => {
        const liveUpdates =
          (await obEval(
            vaultId!,
            "String(app.plugins.plugins.zotlit.services.settings.current['server.live-update'])",
          )) === "true";
        await using restoreLiveUpdates = new AsyncDisposableStack();
        restoreLiveUpdates.defer(async () => {
          await obEval(
            vaultId!,
            `app.plugins.plugins.zotlit.services.settings.update({'server.live-update':${String(liveUpdates)}});true`,
          );
        });
        await obEval(
          vaultId!,
          "app.plugins.plugins.zotlit.services.settings.update({'server.live-update':false});true",
        );

        const saveInZotero = (comment: string) =>
          rdp.json(`(async () => {
            const item = Zotero.Items.getByLibraryAndKey(
              Zotero.Libraries.userLibraryID,
              ${JSON.stringify(createdKey)},
            );
            item.annotationComment = ${JSON.stringify(comment)};
            await item.saveTx();
            return "saved";
          })()`);
        const cardHas = (comment: string) =>
          obEvalUntil(
            vaultId!,
            `String(app.workspace.getLeavesOfType('zotero-annotation-view').map(leaf=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')).find(Boolean)?.textContent.includes(${JSON.stringify(comment)}))`,
            { expected: "true" },
          );

        const focused = "Changed while Companion disabled";
        await saveInZotero(focused);
        await obEval(
          vaultId!,
          "window.dispatchEvent(new FocusEvent('focus'));true",
        );
        expect(await cardHas(focused)).toBe(true);

        const manual = "Changed before manual Refresh";
        await saveInZotero(manual);
        await obEval(
          vaultId!,
          "app.workspace.getLeavesOfType('zotero-annotation-view')[0].view.gestures.onRefresh();true",
        );
        expect(await cardHas(manual)).toBe(true);
      }, 120000);

      it("keeps confirmed surfaces after a committed write loses its response and reread", async () => {
        const before = await annotationState(api, serverID, createdKey);
        const committed = "#e56b6f";
        await installLostWriteProbe(vaultId!);

        const state = await obJson<{
          kind: string;
          failure?: { kind: string };
        }>(
          `(async()=>{const state=await app.plugins.plugins.zotlit.services.annotationRepository.patchColor(${JSON.stringify(createdKey)},${JSON.stringify(committed)});return JSON.stringify(state);})()`,
        );
        expect(state).toEqual({
          kind: "failed",
          failure: { kind: "unknown-outcome" },
        });
        const stored = await annotationState(api, serverID, createdKey);
        expect(stored).toMatchObject({ color: committed });
        expect(stored.version).toBeGreaterThan(before.version);
        expect(await writeOutcomeCalls(vaultId!)).toBe(1);

        // The failed ordinary refresh holds both rendered consumers on their
        // last confirmed value; the independent Local API read above proves
        // Zotero already committed a different one.
        expect(await visibleAnnotationColors(vaultId!, createdKey)).toEqual({
          card: before.color,
          mark: before.color,
        });

        await restoreWriteOutcomeProbe(vaultId!);
        await cli([`vault=${vaultId!}`, "plugin:reload", "id=zotlit"]);
        expect(
          await obEvalUntil(
            vaultId!,
            `(async()=>{const services=app.plugins.plugins.zotlit?.services;if(!services)return 'loading';await services.annotationRepository.probe();const list=await services.annotationRepository.read(${JSON.stringify(attachment.key)});return String(list?.annotations.find(annotation=>annotation.key===${JSON.stringify(createdKey)})?.color);})()`,
            { expected: committed },
          ),
        ).toBe(true);
        expect(
          await obEvalUntil(
            vaultId!,
            `JSON.stringify((()=>{const card=app.workspace.getLeavesOfType('zotero-annotation-view').map(leaf=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')).find(Boolean);const mark=app.workspace.getLeavesOfType('pdf').map(leaf=>leaf.view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')).find(Boolean);return {card:card?.getAttribute('data-annot-color')??null,mark:mark?.getAttribute('fill')??null}})())`,
            { expected: JSON.stringify({ card: committed, mark: committed }) },
          ),
        ).toBe(true);
        // Restart reads Zotero; it does not replay the session-only attempt.
        expect(await annotationState(api, serverID, createdKey)).toEqual(
          stored,
        );
      }, 120000);

      for (const pending of ["unsent draft", "in-flight write"] as const) {
        it(`reloads with an ${pending} and reads Zotero without replay`, async () => {
          const baseline = await readAnnotationState(api, serverID, createdKey);
          const color = "#a28ae5";
          if (pending === "in-flight write") {
            await installClosingPaneProbe(vaultId!, createdKey, color);
            expect(
              await obEvalUntil(
                vaultId!,
                "String(window.__zotlitWriteOutcomeProbe?.reached)",
                { expected: "true" },
              ),
            ).toBe(true);
          }
          const stored = await annotationState(api, serverID, createdKey);
          if (pending === "in-flight write") {
            expect(stored.color).toBe(color);
          }

          // Start the real plugin lifecycle in the same renderer turn as the
          // draft edit, before its idle timer can fire. The plugin's unload
          // starts asynchronous service disposal without awaiting it, so the
          // registry is the completion signal available to this consumer.
          const unloading = await obJson<{
            draft: string | null;
            timers: number;
            calls: number;
            outcome: unknown;
          }>(`(()=>{
            const repository=app.plugins.plugins.zotlit.services.annotationRepository;
            let draft=null;
            let timers=0;
            if (${String(pending === "unsent draft")}) {
              const schedule=window.setTimeout;
              window.setTimeout=function(...args){timers++;return schedule.apply(this,args)};
              try { draft=repository.editComment(${JSON.stringify(createdKey)},'Unsent comment discarded on reload')?.text??null; }
              finally { window.setTimeout=schedule; }
            }
            const probe=window.__zotlitWriteOutcomeProbe;
            const calls=probe?.calls??0;
            const outcome=probe?.outcome??null;
            const lifecycle={disabled:false,enabled:false,error:null};
            window.__zotlitReloadProbe=lifecycle;
            void (async()=>{
              try {
                await app.plugins.disablePlugin('zotlit');
                lifecycle.disabled=!app.plugins.plugins.zotlit;
                await app.plugins.enablePlugin('zotlit');
                lifecycle.enabled=!!app.plugins.plugins.zotlit?.services;
              } catch(error) {
                lifecycle.error=String(error);
              }
            })();
            return JSON.stringify({draft,timers,calls,outcome});
          })()`);
          expect(unloading).toEqual(
            pending === "unsent draft"
              ? {
                  draft: "Unsent comment discarded on reload",
                  timers: 2,
                  calls: 0,
                  outcome: null,
                }
              : { draft: null, timers: 0, calls: 1, outcome: null },
          );
          expect(
            await obEvalUntil(
              vaultId!,
              "JSON.stringify(window.__zotlitReloadProbe)",
              {
                expected: JSON.stringify({
                  disabled: true,
                  enabled: true,
                  error: null,
                }),
              },
            ),
          ).toBe(true);

          expect(
            await obEvalUntil(
              vaultId!,
              `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();const list=await repository.read(${JSON.stringify(attachment.key)});const record=list?.annotations.find(annotation=>annotation.key===${JSON.stringify(createdKey)});return JSON.stringify({color:record?.color,comment:record?.comment,draft:repository.commentDraftFor(${JSON.stringify(createdKey)}),mutation:repository.mutationFor(${JSON.stringify(createdKey)})});})()`,
              {
                expected: JSON.stringify({
                  color: stored.color,
                  comment: baseline.comment,
                  draft: null,
                  mutation: { kind: "idle" },
                }),
              },
            ),
          ).toBe(true);
          // Complete the old response only after the new repository read.
          // Its completion must not restore the old operation or send again.
          await restoreWriteOutcomeProbe(vaultId!);
          await obEval(vaultId!, "delete window.__zotlitReloadProbe;true");
          expect(
            await obJson(
              `JSON.stringify((()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;return {draft:repository.commentDraftFor(${JSON.stringify(createdKey)}),mutation:repository.mutationFor(${JSON.stringify(createdKey)})}})())`,
            ),
          ).toEqual({ draft: null, mutation: { kind: "idle" } });
          expect(await annotationState(api, serverID, createdKey)).toEqual(
            stored,
          );
          expect(await readAnnotationState(api, serverID, createdKey)).toEqual({
            ...baseline,
            version: stored.version,
          });
          console.info("Pending-work reload evidence", {
            pending,
            unloading,
            stored,
          });
        }, 120000);
      }

      it("finishes a repository write after both panes close", async () => {
        const committed = "#2ea8e5";
        const savedLayout = await obEval(
          vaultId!,
          "JSON.stringify(app.workspace.getLayout())",
        );
        try {
          await installClosingPaneProbe(vaultId!, createdKey, committed);
          expect(
            await obEvalUntil(
              vaultId!,
              "String(window.__zotlitWriteOutcomeProbe?.reached)",
              { expected: "true" },
            ),
          ).toBe(true);

          await obEval(
            vaultId!,
            "app.workspace.getLeavesOfType('pdf').forEach(leaf=>leaf.detach());app.workspace.detachLeavesOfType('zotero-annotation-view');window.__zotlitWriteOutcomeProbe.release();true",
          );
          expect(
            await obEvalUntil(
              vaultId!,
              "String(window.__zotlitWriteOutcomeProbe?.outcome?.kind)",
              { expected: "idle" },
            ),
          ).toBe(true);
          expect(await writeOutcomeCalls(vaultId!)).toBe(1);
          expect(await annotationColor(api, serverID, createdKey)).toBe(
            committed,
          );
        } finally {
          await restoreWriteOutcomeProbe(vaultId!);
          await obEval(
            vaultId!,
            `(async()=>{await app.workspace.changeLayout(JSON.parse(${JSON.stringify(savedLayout)}));return true;})()`,
          );
        }
      }, 120000);

      it("degrades to the Zotero database when the Local API is turned off, and recovers", async () => {
        // The pref must come back whatever this test does, so a failure part
        // way through cannot leave the next run's Zotero serving nothing.
        await using restoreLocalApi = new AsyncDisposableStack();
        restoreLocalApi.defer(async () => {
          await setLocalApi(rdp, true);
        });
        const retained = await annotationColor(api, serverID, createdKey);
        expect(retained).not.toBeNull();
        await obEval(
          vaultId!,
          `(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(attachmentPath)});if(!app.workspace.getLeavesOfType('pdf').length)await app.workspace.getLeaf('tab').openFile(file);app.commands.executeCommandById('zotlit:open-annot-view');app.commands.executeCommandById('zotlit:annot-view-follow-active-tab');return true;})()`,
        );
        expect(
          await waitFor(async () => {
            const visible = await visibleAnnotationColors(vaultId!, createdKey);
            return visible.card === retained && visible.mark === retained;
          }),
        ).toBe(true);

        await setLocalApi(rdp, false);
        expect(
          await obEvalUntil(
            vaultId!,
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();return String(repository.capabilityFor(${JSON.stringify(attachment.key)}).reason);})()`,
            { expected: "local-api-disabled" },
          ),
        ).toBe(true);
        expect(
          await obEvalUntil(
            vaultId!,
            `(async()=>{const list=await app.plugins.plugins.zotlit.services.annotationRepository.read(${JSON.stringify(attachment.key)});return String(list?.source.kind);})()`,
            { expected: "zotero-db" },
          ),
        ).toBe(true);
        expect(await visibleAnnotationColors(vaultId!, createdKey)).toEqual({
          card: retained,
          mark: retained,
        });

        await setLocalApi(rdp, true);
        expect(
          await obEvalUntil(
            vaultId!,
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.probe();return String(repository.capabilityFor(${JSON.stringify(attachment.key)}).kind);})()`,
            { expected: "writable" },
          ),
        ).toBe(true);
        expect(
          await obEvalUntil(
            vaultId!,
            `(async()=>{const list=await app.plugins.plugins.zotlit.services.annotationRepository.read(${JSON.stringify(attachment.key)});return String(list?.source.kind);})()`,
            { expected: "zotero-local-api" },
          ),
        ).toBe(true);
        expect(await visibleAnnotationColors(vaultId!, createdKey)).toEqual({
          card: retained,
          mark: retained,
        });
      }, 120000);

      it("updates one managed note to a new immutable excerpt version", async () => {
        const { vaultPath } = environment!;
        const legacySource = join(
          environment!.layout.dataDir,
          "cache",
          "library",
          "FDRFQ7C2.png",
        );
        const notePaths = await obJson<{
          literature: string;
          imported: string;
          live: boolean;
          assets: string[];
        }>(
          `(async()=>{const services=app.plugins.plugins.zotlit.services;await services.noteIndex.whenIndexed();const literature=services.noteIndex.getNotesByItemKey('RUGIER24')[0];const imported=services.noteIndex.getImportedNoteByNoteKey('NNNNAAAA')[0];if(!literature||!imported)throw new Error('Managed acceptance notes missing');return JSON.stringify({literature:literature.path,imported:imported.path,live:services.settings.current['note.default-profile'].bindings['note.import-annotations-as-template'],assets:app.vault.getFiles().filter(file=>file.name.startsWith('zotlit-excerpt-')).map(file=>file.path)});})()`,
        );
        const originalLiterature = await readFile(
          join(vaultPath, notePaths.literature),
          "utf8",
        );
        const originalImported = await readFile(
          join(vaultPath, notePaths.imported),
          "utf8",
        );
        const originalInk = await obJson<{ color: string }>(
          `(async()=>{const list=await app.plugins.plugins.zotlit.services.annotationRepository.read('RGRPDF24');const annotation=list?.annotations.find(value=>value.key==='TYY6Z6ZF');if(!annotation)throw new Error('Ink annotation missing');return JSON.stringify({color:annotation.color});})()`,
        );
        await using restore = new AsyncDisposableStack();
        restore.defer(async () => {
          await obEval(
            vaultId!,
            `(async()=>{const services=app.plugins.plugins.zotlit.services;await services.annotationRepository.patchColor('TYY6Z6ZF',${JSON.stringify(originalInk.color)});await services.db.refresh();services.settings.updateDefaultLiteratureNoteProfileBindings({'note.import-annotations-as-template':${JSON.stringify(notePaths.live)}});const literature=app.vault.getFileByPath(${JSON.stringify(notePaths.literature)});const imported=app.vault.getFileByPath(${JSON.stringify(notePaths.imported)});if(literature)await app.vault.modify(literature,${JSON.stringify(originalLiterature)});if(imported)await app.vault.modify(imported,${JSON.stringify(originalImported)});const keep=new Set(${JSON.stringify(notePaths.assets)});for(const file of app.vault.getFiles().filter(file=>file.name.startsWith('zotlit-excerpt-')))if(!keep.has(file.path))await app.vault.delete(file);return true;})()`,
          );
          expect(
            await waitFor(
              async () =>
                (await annotationColor(api, serverID, "TYY6Z6ZF")) ===
                originalInk.color,
            ),
          ).toBe(true);
        });

        const prepared = await obJson<{
          legacyUrl: string;
          literature: { diagnostic: unknown };
          imported: unknown;
        }>(
          `(async()=>{const services=app.plugins.plugins.zotlit.services;services.settings.updateDefaultLiteratureNoteProfileBindings({'note.import-annotations-as-template':true});const literature=app.vault.getFileByPath(${JSON.stringify(notePaths.literature)});const imported=app.vault.getFileByPath(${JSON.stringify(notePaths.imported)});if(!literature||!imported)throw new Error('Managed acceptance notes missing');const legacyUrl=require('url').pathToFileURL(${JSON.stringify(legacySource)}).href;await app.vault.modify(literature,(await app.vault.read(literature))+${JSON.stringify("\n\n![Legacy excerpt](")}+legacyUrl+${JSON.stringify(")\n")});const literatureResult=await services.noteFeature.updateNote(literature,{indexedKey:'RUGIER24',scope:'full'});const importedResult=await services.batchImport.reimportNoteByKey('NNNNAAAA',imported);return JSON.stringify({legacyUrl,literature:{diagnostic:literatureResult.diagnostic??null},imported:importedResult});})()`,
        );
        expect(prepared.literature).toEqual({ diagnostic: null });
        expect(prepared.imported).toEqual({ outcome: "overwritten" });

        const literatureBefore = await readFile(
          join(vaultPath, notePaths.literature),
          "utf8",
        );
        const importedBefore = await readFile(
          join(vaultPath, notePaths.imported),
          "utf8",
        );
        expect(literatureBefore).toContain(prepared.legacyUrl);
        expect(importedBefore).toContain("zotlit-excerpt-");
        const excerptTargets = (markdown: string) =>
          markdown
            .split("![[")
            .slice(1)
            .map((part) => part.split("]]", 1)[0]!)
            .filter((target) => target.includes("zotlit-excerpt-"));
        const beforeTargets = excerptTargets(importedBefore);
        expect(beforeTargets).toHaveLength(2);
        const beforeBytes = new Map(
          await Promise.all(
            beforeTargets.map(
              async (target) =>
                [target, await readFile(join(vaultPath, target))] as const,
            ),
          ),
        );
        const legacyBytes = await readFile(legacySource);

        const changedColor = "#d12f2f";
        expect(
          await obJson<{ kind: string }>(
            `(async()=>JSON.stringify(await app.plugins.plugins.zotlit.services.annotationRepository.patchColor('TYY6Z6ZF',${JSON.stringify(changedColor)})))()`,
          ),
        ).toMatchObject({ kind: "idle" });
        expect(
          await waitFor(
            async () =>
              (await annotationColor(api, serverID, "TYY6Z6ZF")) ===
              changedColor,
          ),
        ).toBe(true);
        await obEval(
          vaultId!,
          "(async()=>{await app.plugins.plugins.zotlit.services.db.refresh();return true;})()",
        );
        expect(
          await obJson<unknown>(
            `(async()=>{const services=app.plugins.plugins.zotlit.services;const file=app.vault.getFileByPath(${JSON.stringify(notePaths.imported)});if(!file)throw new Error('Imported Note missing');return JSON.stringify(await services.batchImport.reimportNoteByKey('NNNNAAAA',file));})()`,
          ),
        ).toEqual({ outcome: "overwritten" });

        const literatureAfter = await readFile(
          join(vaultPath, notePaths.literature),
          "utf8",
        );
        const importedAfter = await readFile(
          join(vaultPath, notePaths.imported),
          "utf8",
        );
        expect(literatureAfter).toBe(literatureBefore);
        expect(literatureAfter).toContain(prepared.legacyUrl);
        expect(await readFile(legacySource)).toEqual(legacyBytes);
        const afterTargets = excerptTargets(importedAfter);
        const retired = beforeTargets.filter(
          (target) => !afterTargets.includes(target),
        );
        const created = afterTargets.filter(
          (target) => !beforeTargets.includes(target),
        );
        expect(retired).toHaveLength(1);
        expect(created).toHaveLength(1);
        expect(await readFile(join(vaultPath, created[0]!))).not.toEqual(
          beforeBytes.get(retired[0]!),
        );
        for (const [target, bytes] of beforeBytes)
          expect(await readFile(join(vaultPath, target))).toEqual(bytes);
      }, 120000);

      // It clears both key stores and leaves a fresh Always Allow key behind,
      // so it runs after every test that writes with the block's own key.
      it("Allow leaves ZotLit read-only, and says so", async () => {
        /** Whether ZotLit's stored record holds a key; a forgotten one keeps only its server. */
        const keySaved =
          "String(!!JSON.parse(app.secretStorage.getSecret('zotlit-zotero-write-authorization')??'{}').key)";
        /** Whether ZotLit is showing the notice with exactly this title. */
        const noticeShows = (title: string) =>
          obEvalUntil(
            vaultId!,
            `String([...document.querySelectorAll('.zt-notice .zt-notice-text')].some((node)=>node.textContent===${JSON.stringify(title)}))`,
            { expected: "true" },
          );
        const notAllowed =
          "To edit annotations, choose Always Allow in Zotero.";

        await using restore = new AsyncDisposableStack();
        const popout = await obEval(
          vaultId!,
          "JSON.stringify(app.vault.getConfig('settingsPopoutWindow')??null)",
        );
        restore.defer(async () => {
          await obEval(
            vaultId!,
            `app.setting.close();app.vault.setConfig('settingsPopoutWindow',${popout});true`,
          );
        });

        await resetAuthorizations(rdp);
        await obEval(
          vaultId!,
          "(async()=>{await app.plugins.plugins.zotlit.services.zoteroLocalApi.forgetAuthorization();for(const node of document.querySelectorAll('.notice'))node.remove();return true;})()",
        );
        await stubPrompt(rdp, { allow: true, remember: false });
        expect(
          await obEvalUntil(vaultId!, capabilityOf(attachment.key, "kind"), {
            expected: "authorization-required",
          }),
        ).toBe(true);

        // The settings row, where the capability notices open it: the
        // settings modal in the main window, which eval can reach.
        await obEval(
          vaultId!,
          "(async()=>{app.vault.setConfig('settingsPopoutWindow',false);await app.plugins.plugins.zotlit.services.capabilityNotices.showEditingCapability();return true;})()",
        );
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){const row=[...app.setting.containerEl.querySelectorAll('.setting-item')].find((el)=>el.querySelector('.setting-item-name')?.textContent==='Zotero editing');const button=row&&[...row.querySelectorAll('button')].find((el)=>el.textContent.trim()==='Allow editing');if(!button||button.disabled||button.style.display==='none')return 'false';button.click();return 'true';})()`,
            { expected: "true" },
          ),
        ).toBe(true);

        expect(await noticeShows(notAllowed)).toBe(true);
        expect(
          await obEval(vaultId!, capabilityOf(attachment.key, "kind")),
        ).toBe("authorization-required");
        expect(await obEval(vaultId!, keySaved)).toBe("false");
        expect(await authorizationCount(rdp)).toBe(0);

        // The notice's own button asks again, and Zotero now answers Always
        // Allow.
        await stubPrompt(rdp, { allow: true, remember: true });
        expect(
          await obEval(
            vaultId!,
            `(function(){const notice=[...document.querySelectorAll('.zt-notice')].find((node)=>node.textContent.includes(${JSON.stringify(notAllowed)}));const button=notice&&[...notice.querySelectorAll('button')].find((el)=>el.textContent.trim()==='Allow editing');if(!button)return 'false';button.click();return 'true';})()`,
          ),
        ).toBe("true");

        expect(await noticeShows("Zotero editing is enabled.")).toBe(true);
        expect(
          await obEvalUntil(vaultId!, capabilityOf(attachment.key, "kind"), {
            expected: "writable",
          }),
        ).toBe(true);
        expect(await obEval(vaultId!, keySaved)).toBe("true");
      }, 120000);

      // Last in this block, so it covers every write above: ZotLit writes
      // Annotations, never the PDF the Annotations hang from.
      it("leaves the Attachment's PDF byte-identical", async () => {
        expect(await digestAttachmentPdf()).toBe(pdfDigestBefore);
      });
    },
  );
});

/**
 * SHA-256 of the Fixture PDF. It is a `vault`-rooted linked file, so it lives
 * in the run's vault.
 */
async function digestAttachmentPdf(): Promise<string> {
  const file = join(environment!.vaultPath, attachmentPath);
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

/**
 * One Attachment's Annotation keys, read the way ZotLit's own client reads
 * them — `itemType=annotation`, sorted by `dateAdded` so a page boundary holds
 * still while a paged walk runs.
 */
async function annotationRecords(
  api: string,
  serverID: string,
  attachmentKey: string,
): Promise<{ key: string; data: { parentItem: string } }[]> {
  const query = new URLSearchParams({
    itemType: "annotation",
    sort: "dateAdded",
    direction: "asc",
  });
  const reply = await zoteroFetch(
    api,
    `users/0/items/${attachmentKey}/children?${query.toString()}`,
    { headers: { "Zotero-Server-ID": serverID } },
  );
  expect(reply.status).toBe(200);
  return (await reply.json()) as {
    key: string;
    data: { parentItem: string };
  }[];
}

async function annotationKeys(
  api: string,
  serverID: string,
  attachmentKey: string,
): Promise<string[]> {
  return (await annotationRecords(api, serverID, attachmentKey)).map(
    ({ key }) => key,
  );
}

/**
 * Put one Annotation's comment back to `comment`, against whatever version
 * Zotero holds now rather than the one the caller last saw.
 */
async function restoreAnnotationComment(
  api: string,
  options: {
    serverID: string;
    key: string;
    annotationKey: string;
    comment: string;
  },
): Promise<void> {
  const path = `users/0/items/${options.annotationKey}`;
  const current = await zoteroFetch(api, path, {
    headers: { "Zotero-Server-ID": options.serverID },
  });
  const { version } = (await current.json()) as { version: number };
  const reverted = await zoteroFetch(api, path, {
    method: "PATCH",
    headers: {
      "Zotero-Server-ID": options.serverID,
      "Zotero-API-Key": options.key,
      "Content-Type": "application/json",
      "If-Unmodified-Since-Version": String(version),
    },
    body: JSON.stringify({ annotationComment: options.comment }),
  });
  expect(reverted.status).toBe(204);
}

/** Which Attachment each listed Annotation actually hangs from. */
async function annotationParents(
  api: string,
  serverID: string,
  attachmentKey: string,
): Promise<string[]> {
  return (await annotationRecords(api, serverID, attachmentKey)).map(
    ({ data }) => data.parentItem,
  );
}

/** The colour Zotero's own Reader is showing for one Annotation. */
function readerAnnotationColor(
  rdp: ZoteroRdp,
  key: string,
  color: string,
): Promise<boolean> {
  return rdp.json<boolean>(`(() => {
    const attachment = ${ATTACHMENT_ITEM};
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === attachment.id,
    );
    if (!reader) return false;
    return reader._item
      .getAnnotations()
      .some(
        (annotation) =>
          annotation.key === ${JSON.stringify(key)} &&
          annotation.annotationColor === ${JSON.stringify(color)},
      );
  })()`);
}

async function annotationColor(
  api: string,
  serverID: string,
  key: string,
): Promise<string | null> {
  const reply = await zoteroFetch(api, `users/0/items/${key}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  if (reply.status !== 200) return null;
  const record = (await reply.json()) as {
    data: { annotationColor?: string };
  };
  return record.data.annotationColor ?? null;
}

async function annotationState(
  api: string,
  serverID: string,
  key: string,
): Promise<{ version: number; color: string | null }> {
  const reply = await zoteroFetch(api, `users/0/items/${key}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  expect(reply.status).toBe(200);
  const record = (await reply.json()) as {
    version: number;
    data: { annotationColor?: string };
  };
  return {
    version: record.version,
    color: record.data.annotationColor ?? null,
  };
}

/**
 * Let one real write commit, then replace its reply with a lost-response
 * outcome and fail the ordinary follow-up list read once.
 */
async function installLostWriteProbe(vaultId: string): Promise<void> {
  await obEval(
    vaultId,
    `(() => {
      const services = app.plugins.plugins.zotlit.services;
      const api = services.zoteroLocalApi;
      const probe = {
        api,
        authorizedSend: api.authorizedSend.bind(api),
        listAnnotations: api.listAnnotations.bind(api),
        calls: 0,
        failRead: false,
      };
      window.__zotlitWriteOutcomeProbe = probe;
      api.authorizedSend = async (...args) => {
        probe.calls += 1;
        const reply = await probe.authorizedSend(...args);
        if ('value' in reply) {
          probe.failRead = true;
          return { failure: { kind: 'unknown-outcome' } };
        }
        return reply;
      };
      api.listAnnotations = async (...args) => {
        if (!probe.failRead) return await probe.listAnnotations(...args);
        probe.failRead = false;
        return { failure: { kind: 'unreachable' } };
      };
      return true;
    })()`,
  );
}

/** Hold the reply after a real write commits, until both owning panes close. */
async function installClosingPaneProbe(
  vaultId: string,
  annotationKey: string,
  color: string,
): Promise<void> {
  await obEval(
    vaultId,
    `(() => {
      const services = app.plugins.plugins.zotlit.services;
      const api = services.zoteroLocalApi;
      const gate = Promise.withResolvers();
      const probe = {
        api,
        authorizedSend: api.authorizedSend.bind(api),
        listAnnotations: api.listAnnotations.bind(api),
        calls: 0,
        reached: false,
        release: gate.resolve,
        outcome: null,
      };
      window.__zotlitWriteOutcomeProbe = probe;
      api.authorizedSend = async (...args) => {
        probe.calls += 1;
        const reply = await probe.authorizedSend(...args);
        probe.reached = true;
        await gate.promise;
        return reply;
      };
      probe.pending = services.annotationRepository
        .patchColor(${JSON.stringify(annotationKey)}, ${JSON.stringify(color)})
        .then((outcome) => { probe.outcome = outcome; });
      return true;
    })()`,
  );
}

async function restoreWriteOutcomeProbe(vaultId: string): Promise<void> {
  await obEval(
    vaultId,
    `(async () => {
      const probe = window.__zotlitWriteOutcomeProbe;
      if (!probe) return 'clean';
      try {
        probe.release?.();
        await probe.pending;
      } finally {
        probe.api.authorizedSend = probe.authorizedSend;
        probe.api.listAnnotations = probe.listAnnotations;
        delete window.__zotlitWriteOutcomeProbe;
      }
      return 'restored';
    })()`,
  );
}

async function writeOutcomeCalls(vaultId: string): Promise<number> {
  return Number(
    await obEval(
      vaultId,
      "String(window.__zotlitWriteOutcomeProbe?.calls ?? -1)",
    ),
  );
}

function visibleAnnotationColors(
  vaultId: string,
  annotationKey: string,
): Promise<{ card: string | null; mark: string | null }> {
  return obJson(
    `(() => {
      const card = app.workspace.getLeavesOfType('zotero-annotation-view')
        .map((leaf) => leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]'))
        .find(Boolean);
      const mark = app.workspace.getLeavesOfType('pdf')
        .map((leaf) => leaf.view.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]'))
        .find(Boolean);
      return JSON.stringify({
        card: card?.getAttribute('data-annot-color') ?? null,
        mark: mark?.getAttribute('fill') ?? null,
      });
    })()`,
  );
}

const ATTACHMENT_ITEM = `Zotero.Items.getByLibraryAndKey(
  Zotero.Libraries.userLibraryID,
  ${JSON.stringify(attachment.key)},
)`;

function isZoteroReaderOpen(rdp: ZoteroRdp): Promise<boolean> {
  return rdp.json<boolean>(`Zotero.Reader._readers.some(
    (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
  )`);
}

/** Open Zotero's Reader on the Fixture Attachment; answers its tab id. */
function openZoteroReader(rdp: ZoteroRdp): Promise<string> {
  return rdp.json<string>(`(async () => {
    const reader = await Zotero.Reader.open(${ATTACHMENT_ITEM}.id);
    return reader.tabID;
  })()`);
}

function closeZoteroReader(rdp: ZoteroRdp, tabID: string): Promise<string> {
  return rdp.json<string>(`(() => {
    Zotero.Reader.getByTabID(${JSON.stringify(tabID)})?.close();
    return "closed";
  })()`);
}

/** Whether the Reader open on the Attachment is showing the Annotation `key`. */
function readerHoldsAnnotation(rdp: ZoteroRdp, key: string): Promise<boolean> {
  return rdp.json<boolean>(`(() => {
    const attachment = ${ATTACHMENT_ITEM};
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === attachment.id,
    );
    if (!reader) return false;
    // The reader's own item answers the serialized Annotations it renders
    // from, each carrying its key — the set the Reader draws, not a database
    // query standing in for it.
    return reader._item
      .getAnnotations()
      .some((annotation) => annotation.key === ${JSON.stringify(key)});
  })()`);
}

function setLocalApi(rdp: ZoteroRdp, enabled: boolean): Promise<string> {
  return rdp.json<string>(`(() => {
    Zotero.Prefs.set("httpServer.localAPI.enabled", ${String(enabled)});
    return "set";
  })()`);
}

interface ConcurrencyAnnotation {
  key: string;
  version: number;
}

/** Create one unique disposable Annotation from the Fixture's seeded shape. */
function createConcurrencyAnnotation(
  rdp: ZoteroRdp,
  comment: string,
): Promise<ConcurrencyAnnotation> {
  return rdp.json<ConcurrencyAnnotation>(`(async () => {
    const attachment = ${ATTACHMENT_ITEM};
    const seeded = attachment.getAnnotations()[0];
    const json = await Zotero.Annotations.toJSON(seeded);
    json.key = Zotero.DataObjectUtilities.generateKey();
    json.comment = ${JSON.stringify(comment)};
    const item = await Zotero.Annotations.saveFromJSON(attachment, json);
    globalThis.__zlConcurrencyKeys ??= [];
    globalThis.__zlConcurrencyKeys.push(item.key);
    return { key: item.key, version: item.clientVersion };
  })()`);
}

/** Pause the Reader's real save after `_initSave`, before its transaction. */
function pauseReaderCommentSave(
  rdp: ZoteroRdp,
  annotationKey: string,
  comment: string,
): Promise<{ version: number; comment: string }> {
  return rdp.json(`(async () => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
    );
    await reader._initPromise;
    const json = await reader._getAnnotation(item);
    json.comment = ${JSON.stringify(comment)};
    json.onlyTextOrComment = true;
    const original = item._initSave;
    const reached = Promise.withResolvers();
    const release = Promise.withResolvers();
    const state = {
      kind: "reader-save",
      item,
      original,
      reached: false,
      release: release.resolve,
      completed: null,
    };
    globalThis.__zlConcurrencyHook = state;
    item._initSave = async function (env) {
      const proceed = await original.call(this, env);
      if (!state.reached) {
        state.reached = true;
        reached.resolve();
        await release.promise;
      }
      return proceed;
    };
    state.completed = reader._internalReader
      ._onSaveAnnotations([json], () => {})
      .then(() => ({ ok: true }), (error) => ({ ok: false, error: String(error) }));
    await reached.promise;
    return { version: item.clientVersion, comment: item.annotationComment };
  })()`);
}

/** Release and observe the paused Reader save, restoring the patched method. */
function releaseReaderCommentSave(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<{ ok: boolean; error?: string }> {
  return rdp.json(`(async () => {
    const state = globalThis.__zlConcurrencyHook;
    if (!state || state.kind !== "reader-save" || state.item.key !== ${JSON.stringify(annotationKey)}) {
      throw new Error("No matching Reader save is paused");
    }
    state.release();
    const outcome = await state.completed;
    state.item._initSave = state.original;
    delete globalThis.__zlConcurrencyHook;
    return outcome;
  })()`);
}

/** Save through the same callback the initialized Zotero Reader uses. */
function saveReaderComment(
  rdp: ZoteroRdp,
  annotationKey: string,
  comment: string,
): Promise<string> {
  return rdp.json(`(async () => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
    );
    await reader._initPromise;
    const json = await reader._getAnnotation(item);
    json.comment = ${JSON.stringify(comment)};
    json.onlyTextOrComment = true;
    await reader._internalReader._onSaveAnnotations([json], () => {});
    return "saved";
  })()`);
}

/** Pause the next erase of one Annotation before its database transaction. */
function pauseAnnotationErase(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<string> {
  return rdp.json(`(() => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    const original = item.eraseTx;
    const release = Promise.withResolvers();
    const completed = Promise.withResolvers();
    const state = {
      kind: "erase",
      item,
      original,
      reached: false,
      release: release.resolve,
      completed: completed.promise,
    };
    globalThis.__zlConcurrencyHook = state;
    item.eraseTx = async function (options) {
      state.reached = true;
      await release.promise;
      try {
        return await original.call(this, options);
      }
      finally {
        completed.resolve();
      }
    };
    return "armed";
  })()`);
}

function annotationErasePaused(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<boolean> {
  return rdp.json(`(() => {
    const state = globalThis.__zlConcurrencyHook;
    return Boolean(
      state?.kind === "erase" &&
      state.item.key === ${JSON.stringify(annotationKey)} &&
      state.reached
    );
  })()`);
}

function releaseAnnotationErase(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<string> {
  return rdp.json(`(async () => {
    const state = globalThis.__zlConcurrencyHook;
    if (!state || state.kind !== "erase" || state.item.key !== ${JSON.stringify(annotationKey)}) {
      throw new Error("No matching erase is paused");
    }
    state.release();
    await state.completed;
    state.item.eraseTx = state.original;
    delete globalThis.__zlConcurrencyHook;
    return "released";
  })()`);
}

/** Release any failed case's gate and restore the patched native method. */
function restoreConcurrencyHooks(rdp: ZoteroRdp): Promise<string> {
  return rdp.json(`(async () => {
    const state = globalThis.__zlConcurrencyHook;
    if (!state) return "clean";
    state.release();
    if (state.reached && state.completed) await state.completed;
    if (state.kind === "reader-save") state.item._initSave = state.original;
    if (state.kind === "erase") state.item.eraseTx = state.original;
    delete globalThis.__zlConcurrencyHook;
    return "restored";
  })()`);
}

/** Erase every disposable Annotation this scenario created. */
function eraseConcurrencyAnnotations(rdp: ZoteroRdp): Promise<string> {
  return rdp.json(`(async () => {
    for (const key of globalThis.__zlConcurrencyKeys ?? []) {
      const item = Zotero.Items.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        key,
      );
      if (item) await item.eraseTx();
    }
    delete globalThis.__zlConcurrencyKeys;
    return "erased";
  })()`);
}

/** Independent Local API read used as the final-state oracle. */
/** A Zotero tag as the Local API and Zotero's own `setTags` spell it. */
interface WireTag {
  tag: string;
  type?: number;
}

/** Tags as comparable text: `name:type` in sorted order, a manual tag typed `0`. */
function spelledTags(tags: readonly WireTag[]): string[] {
  return tags.map(({ tag, type }) => `${tag}:${type ?? 0}`).toSorted();
}

/** The tags the Local API holds for one Annotation, spelled by {@link spelledTags}. */
async function annotationTags(
  api: string,
  serverID: string,
  annotationKey: string,
): Promise<string[]> {
  const reply = await zoteroFetch(api, `users/0/items/${annotationKey}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  expect(reply.status).toBe(200);
  const record = (await reply.json()) as { data: { tags: WireTag[] } };
  return spelledTags(record.data.tags);
}

/**
 * Sets one Annotation's tags in Zotero itself, and waits until ZotLit reads
 * them.
 */
async function setAnnotationTags(
  rdp: ZoteroRdp,
  annotationKey: string,
  tags: readonly WireTag[],
): Promise<void> {
  await rdp.json(`(async () => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    item.setTags(${JSON.stringify(tags)});
    await item.saveTx();
    return "saved";
  })()`);
  expect(
    await obEvalUntil(
      vaultId!,
      `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;const list=await repository.refresh(${JSON.stringify(attachment.key)});const record=list?.annotations.find((annotation)=>annotation.key===${JSON.stringify(annotationKey)});return JSON.stringify((record?.tagDetails??[]).map(({name,type})=>name+':'+type).toSorted());})()`,
      { expected: JSON.stringify(spelledTags(tags)) },
    ),
  ).toBe(true);
}

/**
 * One Annotation Card's tag gestures, through the card's own controls: the tag
 * toggle opens the editor, Enter adds the typed name, a chip's remove button
 * drops it, and the toggle's second press ends the session. A window without
 * the system focus sends no focus events, so no blur ends a session here.
 *
 * @param annotationKey the Annotation whose card, in whichever Annotation View
 *   holds it, the gestures act on.
 */
function cardTagEditor(annotationKey: string) {
  const card = `app.workspace.getLeavesOfType('zotero-annotation-view').map(leaf=>leaf.view.containerEl.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]')).find(Boolean)`;
  return {
    ...tagEditorIn(card),
    /** One click on a part of the card, once the card draws it. */
    press: (target: string) =>
      obEvalUntil(
        vaultId!,
        `(function(){const target=(${card})?.querySelector(${JSON.stringify(target)});if(!target)return 'absent';target.click();return 'pressed';})()`,
        { expected: "pressed" },
      ),
    /** The tag toggle in the card's action bar. */
    toggle: ".clickable-icon:has(svg.lucide-tag)",
    /** The names the card draws while no session is open. */
    cardTags: () =>
      obJson<string[]>(
        `JSON.stringify([...((${card})?.querySelectorAll('[aria-pressed]')??[])].map(chip=>chip.textContent))`,
      ),
  };
}

/**
 * The inline tag editor inside one surface, the Annotation Card or the Mark
 * Popup: one editor component, so one set of gestures reaches both.
 *
 * @param root an expression for the element that holds the editor.
 */
function tagEditorIn(root: string) {
  return {
    editorOpen: () =>
      obEvalUntil(
        vaultId!,
        `String(!!(${root})?.querySelector('.zt-annot-tag-input'))`,
        { expected: "true" },
      ),
    /** The names the open editor draws as chips. */
    editorChips: () =>
      obJson<string[]>(
        `JSON.stringify([...((${root})?.querySelectorAll('[data-slot=tags-input-item-text]')??[])].map(chip=>chip.textContent))`,
      ),
    /** Text typed into the tag field; `enter` presses Enter after it. */
    type: (text: string, { enter }: { enter: boolean }) =>
      obEval(
        vaultId!,
        `(function(){const field=(${root}).querySelector('.zt-annot-tag-input');field.value=${JSON.stringify(text)};field.dispatchEvent(new Event('input',{bubbles:true}));if(${enter})field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return 'typed';})()`,
      ),
    /**
     * One chip's remove button. The chip is found by its name part, because
     * an automatic chip also holds its label.
     */
    remove: (name: string) =>
      obEval(
        vaultId!,
        `(function(){const chip=[...(${root}).querySelectorAll('[data-slot=tags-input-item]')].find(item=>item.querySelector('[data-slot=tags-input-item-text]')?.textContent===${JSON.stringify(name)});if(!chip)return 'absent';chip.querySelector('[data-slot=tags-input-item-remove]').click();return 'removed';})()`,
      ),
  };
}

async function readAnnotationState(
  api: string,
  serverID: string,
  annotationKey: string,
): Promise<{ status: number; version: number | null; comment: string | null }> {
  const response = await zoteroFetch(api, `users/0/items/${annotationKey}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  if (response.status === 404) {
    return { status: 404, version: null, comment: null };
  }
  expect(response.status).toBe(200);
  const record = (await response.json()) as {
    version: number;
    data: { annotationComment?: string };
  };
  return {
    status: response.status,
    version: record.version,
    comment: record.data.annotationComment ?? "",
  };
}
