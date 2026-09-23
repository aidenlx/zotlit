// The Paired Run scenario — ZotLit in a real desktop Obsidian window and a
// real Zotero serving its Local API on the same Fixture. Reproduce it with
// `pnpm fixture open --local-api` (or `dev`), then `pnpm e2e`; see
// packages/e2e/AGENTS.md and docs/fixture.md § "Run a Paired Run".
//
// It attaches to a Paired Run that is already up and never rebuilds the
// Fixture: a rebuild would pull `zotero.sqlite` out from under the Paired
// Zotero holding it open. So it drives the Development Vault that run opened.
//
// Skips cleanly (not fails) in three independent steps, each `describe.skipIf`
// evaluated at module scope before collection: nothing serving the Local API
// skips the whole file, no remote debugging port skips the tiers that need one,
// and no Development Vault skips the tests that drive Obsidian.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { getDevVaultDir } from "@zotlit/scripts/dev-vault";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  getFixtureRoot,
} from "@zotlit/scripts/fixture";
import { createNodePairedRunPorts } from "@zotlit/scripts/fixture/paired-run-node";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { verifySavedEditDisplay } from "./excerpt-acceptance.ts";
import { verifyExcerptRefresh } from "./excerpt-refresh.ts";
import {
  verifyExcerptRendering,
  verifyZoteroExcerptParity,
} from "./excerpt-rendering.ts";
import { cli, obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
import {
  authorizationCount,
  authorize,
  clickAuthorizationDialog,
  denyAnyAuthorizationDialog,
  dismissAuthorizationDialog,
  grantRememberedKey,
  openZoteroRdp,
  probePairedRun,
  readServerID,
  resetAuthorizations,
  restorePrompt,
  stubPrompt,
  waitForAuthorizationDialog,
  zoteroFetch,
} from "./paired-zotero.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";

const execFileAsync = promisify(execFile);
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
/** A prepared Paired Run may belong to another worktree under review. */
const pairedWorkspaceRoot =
  process.env.ZOTLIT_PAIRED_WORKSPACE_ROOT ?? workspaceRoot;

/** The Fixture Attachment this scenario reads, writes and never rewrites. */
const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
/** Its vault-relative path: the Fixture declares it as a `vault`-rooted link. */
const attachmentPath = attachment.path!;
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

const reach = await probePairedRun(getFixtureRoot(pairedWorkspaceRoot)).catch(
  () => null,
);
const vaultId = await developmentVaultId();

/**
 * The Development Vault a Paired Run opened, by its registered id — and only
 * where its window answers. `obsidian-vault id` prints an id for a vault that
 * is merely registered, including one whose window is closed, and that id
 * would let the ZotLit tier start and then fail on its first `obEval` instead
 * of skipping. Empty output, a failing script and a silent window are all the
 * same answer here, so this never throws.
 *
 * The probe itself opens what it finds closed: `obsidian vault=<id> eval` is
 * the Obsidian CLI's only way to reach a window, and reaching a registered
 * vault is what opens it. So the skip holds on the first run of a session and
 * not on the next one — the vault this probe opened answers from then on. A
 * non-opening liveness check needs the `open` flag the `vault-list` IPC already
 * carries, which no command of `obsidian-vault.ts` prints today.
 */
async function developmentVaultId(): Promise<string | null> {
  const script = join(
    pairedWorkspaceRoot,
    "packages",
    "scripts",
    "scripts",
    "obsidian-vault.ts",
  );
  const result = await execFileAsync(process.execPath, [script, "id"], {
    windowsHide: true,
  }).catch(() => null);
  const id = result?.stdout.trim().split("\n").at(-1)?.trim();
  if (!id) return null;
  const answered = await obEval(id, "String(!!app.vault.adapter)").catch(
    () => "",
  );
  return answered === "true" ? id : null;
}

function obJson<T>(code: string): Promise<T> {
  return obEval(vaultId!, code).then((reply) => JSON.parse(reply) as T);
}

const baseUrl = reach?.baseUrl ?? null;
const debuggerPort = reach?.debuggerPort ?? null;

describe.skipIf(!baseUrl)("Paired Run", () => {
  const api = baseUrl!;
  let serverID = "";
  let authorizationFixture:
    | { native: string | null; secret: string | null; rdp: ZoteroRdp }
    | undefined;

  beforeAll(async () => {
    serverID = await readServerID(api);
    if (!debuggerPort) return;
    const rdp = await openZoteroRdp(debuggerPort);
    authorizationFixture = {
      native: await rdp.json<string | null>(
        `(async()=>{const path=PathUtils.join(Zotero.Profile.dir,'localAPIKeys.json');return await IOUtils.exists(path)?await IOUtils.readUTF8(path):null})()`,
      ),
      secret: vaultId
        ? await obJson<string | null>(
            `JSON.stringify(app.secretStorage.getSecret('zotlit-zotero-write-authorization'))`,
          )
        : null,
      rdp,
    };
  });

  const prepareAuthorizationFixture = async (): Promise<void> => {
    if (!authorizationFixture) return;
    const { native, secret, rdp } = authorizationFixture;
    await restorePrompt(rdp);
    if (native === null || secret === null) {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: false });
      return;
    }
    const key = await grantRememberedKey(api, rdp, {
      serverID,
      appName: "ZotLit Fixture",
    });
    if (vaultId && secret !== null) {
      await obEval(
        vaultId,
        `(function(){const record=JSON.parse(${JSON.stringify(secret)});record.key=${JSON.stringify(key)};app.secretStorage.setSecret('zotlit-zotero-write-authorization',JSON.stringify(record));return true;})()`,
      );
    }
  };

  const restoreAuthorizationFixture = async (): Promise<void> => {
    if (!authorizationFixture) return;
    const { native, secret, rdp } = authorizationFixture;
    let nativeFailure: unknown;
    try {
      await restorePrompt(rdp);
      const exact = await rdp.json<boolean>(`(async()=>{
        await Zotero.Server.LocalAPI.clearAuthorizations();
        const path=PathUtils.join(Zotero.Profile.dir,'localAPIKeys.json');
        if (${JSON.stringify(native)} !== null) {
          await IOUtils.writeUTF8(path,${JSON.stringify(native)});
        }
        const held=await IOUtils.exists(path)?await IOUtils.readUTF8(path):null;
        return held===${JSON.stringify(native)};
      })()`);
      expect(exact).toBe(true);
    } catch (error) {
      nativeFailure = error;
    }
    if (vaultId) {
      if (secret !== null) {
        await obEval(
          vaultId,
          `app.secretStorage.setSecret('zotlit-zotero-write-authorization',${JSON.stringify(secret)});true`,
        );
      }
      expect(
        await obJson<boolean>(
          `JSON.stringify(app.secretStorage.getSecret('zotlit-zotero-write-authorization')===${JSON.stringify(secret)})`,
        ),
      ).toBe(true);
    }
    if (nativeFailure) throw nativeFailure;
  };

  afterAll(async () => {
    let restoreFailure: unknown;
    try {
      await restoreAuthorizationFixture();
    } catch (error) {
      restoreFailure = error;
    } finally {
      authorizationFixture?.rdp[Symbol.dispose]();
    }
    if (!authorizationFixture) return;
    const ports = createNodePairedRunPorts({
      workspaceRoot: pairedWorkspaceRoot,
      layout: reach!.layout,
    });
    await ports.stopLivePairedZotero();
    let restartFailure: unknown;
    try {
      const restarted = await ports.openPairedZotero();
      if (restarted.debuggerPort === undefined)
        throw new Error("restarted Paired Zotero has no debugger port");
      using rdp = await openZoteroRdp(restarted.debuggerPort);
      const expected =
        authorizationFixture.native === null
          ? 0
          : JSON.parse(authorizationFixture.native).keys.filter(
              ({ remember }: { remember: boolean }) => remember,
            ).length;
      expect(await authorizationCount(rdp)).toBe(expected);
    } catch (error) {
      restartFailure = error;
    }
    const failures = [restoreFailure, restartFailure].filter(
      (failure) => failure !== undefined,
    );
    if (failures.length > 0)
      throw new AggregateError(failures, "authorization cleanup failed");
  }, 120000);

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
  describe.skipIf(!debuggerPort)("Tier 2 — the authorization branches", () => {
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

    it("consumes a one-time key on its first authenticated request", async () => {
      // Zotero's own docstring says a non-remembered key dies on its first
      // *successful* use. It does not: `consumeLocalAPIKey` splices the entry
      // out during the key lookup, before the endpoint runs. So a client that
      // retries a refused write cannot reuse the key — it needs a second
      // dialog. Driven here with a write Zotero refuses on a precondition.
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: false });
      const granted = await authorize(api, { serverID, appName: APP_NAME });
      expect(granted.status).toBe(200);
      const key = (granted.body as { key: string }).key;

      const stale = await zoteroFetch(
        api,
        `users/0/items/${seededAnnotation.key}`,
        {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            // A version Zotero cannot be holding, so the write is refused
            // after the key lookup has already spent the key.
            "If-Unmodified-Since-Version": "0",
          },
          body: JSON.stringify({ annotationComment: "never stored" }),
        },
      );
      expect(stale.status).toBe(412);

      const retried = await zoteroFetch(
        api,
        `users/0/items/${seededAnnotation.key}`,
        {
          method: "GET",
          headers: { "Zotero-Server-ID": serverID, "Zotero-API-Key": key },
        },
      );
      const second = await zoteroFetch(
        api,
        `users/0/items/${seededAnnotation.key}`,
        {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            "If-Unmodified-Since-Version": String(
              ((await retried.json()) as { version: number }).version,
            ),
          },
          body: JSON.stringify({ annotationComment: "never stored" }),
        },
      );
      expect(second.status).toBe(401);
    });
  });

  // ── Tier 3 ────────────────────────────────────────────────────────────────
  // The real dialog (Route B), unstubbed. Zotero's Write Authorization dialog
  // is an ordinary Gecko common dialog and RDP keeps answering while its nested
  // modal event loop spins, so the window can be found and its buttons pressed.
  // Buttons are matched by slot, never by label: this Zotero runs in the host
  // OS locale.
  describe.skipIf(!debuggerPort)("Tier 3 — Zotero's own dialog", () => {
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
  describe.skipIf(!debuggerPort)("Tier 4 — native concurrent writes", () => {
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
        // a Development Vault stands — which is exactly this block's gate.
        pdfDigestBefore = await digestAttachmentPdf();
        // A digest of nothing would make the closing assertion vacuous.
        expect(pdfDigestBefore).toHaveLength(64);
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
        // the Development Vault, and a bare Fixture build leaves it pointing
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
          "the Fixture PDF does not resolve inside the Development Vault; open the Paired Run with `pnpm fixture open --local-api`",
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

      it("saves a Geometry Edit on the seeded image through one repository write", async () => {
        const imageKey = "FDRFQ7C2";
        const path = `users/0/items/${imageKey}`;
        const seed = (await (
          await zoteroFetch(api, path, {
            headers: { "Zotero-Server-ID": serverID },
          })
        ).json()) as {
          data: { annotationPosition: string; annotationSortIndex: string };
        };
        // The seed goes back through the Local API against whatever version
        // Zotero holds then, so a failed assertion leaves no edited image for
        // the next run to inherit.
        await using revert = new AsyncDisposableStack();
        revert.defer(async () => {
          await readerSettled(rdp, imageKey, { api, serverID });
          const apiKey = await obJson<string>(
            "JSON.stringify(JSON.parse(app.secretStorage.getSecret('zotlit-zotero-write-authorization')).key)",
          );
          const current = (await (
            await zoteroFetch(api, path, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as { version: number };
          const restored = await zoteroFetch(api, path, {
            method: "PATCH",
            headers: {
              "Zotero-Server-ID": serverID,
              "Zotero-API-Key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              version: current.version,
              annotationPosition: seed.data.annotationPosition,
              annotationSortIndex: seed.data.annotationSortIndex,
            }),
          });
          expect(restored.status).toBe(204);
        });

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
          `(async()=>{const s=app.plugins.plugins.zotlit.services;const binding=s.pdfAnnotationEditor.bindings.find(b=>b.filePath===${JSON.stringify(attachmentPath)});const announced=[];const off=s.annotationRepository.on('excerpt-pixels-changed',(record)=>announced.push(record.key));try{const position=${JSON.stringify(edited)};const sortIndex=await binding.sortIndex(position);const state=await s.annotationRepository.patchGeometry(${JSON.stringify(imageKey)},{position,sortIndex});return JSON.stringify({sortIndex,state,announced});}finally{off();}})()`,
        );
        expect(outcome.state.kind).toBe("idle");
        expect(outcome.announced).toEqual([imageKey]);

        // Zotero holds the rect and a recomputed Sort Index, read straight
        // off the Local API.
        const stored = (await (
          await zoteroFetch(api, path, {
            headers: { "Zotero-Server-ID": serverID },
          })
        ).json()) as {
          data: { annotationPosition: string; annotationSortIndex: string };
        };
        expect(JSON.parse(stored.data.annotationPosition)).toEqual(edited);
        expect(stored.data.annotationSortIndex).toBe(outcome.sortIndex);
        expect(stored.data.annotationSortIndex).toMatch(
          /^\d{5}\|\d{6}\|\d{5}$/,
        );
        expect(stored.data.annotationSortIndex).not.toBe(
          seed.data.annotationSortIndex,
        );

        // Zotero's open Reader holds the same rect.
        expect(
          await waitFor(() =>
            rdp.json<boolean>(`(() => {
              const attachment = ${ATTACHMENT_ITEM};
              const reader = Zotero.Reader._readers.find(
                (candidate) => candidate.itemID === attachment.id,
              );
              const annotation = reader?._item
                .getAnnotations()
                .find(({ key }) => key === ${JSON.stringify(imageKey)});
              return annotation?.annotationPosition === ${JSON.stringify(JSON.stringify(edited))};
            })()`),
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
        const path = `users/0/items/${imageKey}`;
        const pdfView = `app.workspace.getLeavesOfType('pdf').map(({view})=>view).find((view)=>view.file?.path===${JSON.stringify(attachmentPath)}&&view.containerEl.getBoundingClientRect().width>0)`;
        const imageMark = `${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]')`;
        /** Dispatches one pointer event as the browser would, at a client point. */
        const fire = `const fire=(type,x,y,target)=>{const node=target??document.elementFromPoint(x,y);const init={clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:1,button:0,buttons:type==='pointerup'||type==='click'?0:1,view:window};node.dispatchEvent(type==='click'?new MouseEvent(type,init):new PointerEvent(type,init));return node;};`;

        interface Stored {
          version: number;
          data: { annotationPosition: string; annotationSortIndex: string };
        }
        const storedImage = async (): Promise<Stored> =>
          (await (
            await zoteroFetch(api, path, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as Stored;

        const imageSettled = () =>
          readerSettled(rdp, imageKey, { api, serverID });

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
          await imageSettled();
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=2;const rect=${imageMark}?.getBoundingClientRect();return String(!!rect&&rect.width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          await obEval(
            vaultId!,
            `(function(){${fire}const mark=${imageMark};if(mark.classList.contains('is-selected'))return 'selected';const rect=mark.getBoundingClientRect();const x=rect.left+rect.width/2,y=rect.top+rect.height/2;const node=fire('pointerdown',x,y);fire('pointerup',x,y,node);fire('click',x,y,node);return 'clicked';})()`,
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

        /** The image as the Fixture Spec seeds it. */
        const seeded = ANNOTATIONS.find(({ key }) => key === imageKey)!;
        const seed = {
          position: JSON.stringify(seeded.position),
          sortIndex: seeded.sortIndex,
        };

        /**
         * Puts the seed back through the Local API, against whatever version
         * Zotero holds then, once the Reader has finished any render a
         * position change started, and holds it there.
         */
        async function restoreSeed(): Promise<void> {
          await imageSettled();
          const current = await storedImage();
          if (
            current.data.annotationPosition !== seed.position ||
            current.data.annotationSortIndex !== seed.sortIndex
          ) {
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
              body: JSON.stringify({
                version: current.version,
                annotationPosition: seed.position,
                annotationSortIndex: seed.sortIndex,
              }),
            });
            expect(restored.status).toBe(204);
            await imageSettled();
          }
          expect((await storedImage()).data).toMatchObject({
            annotationPosition: seed.position,
            annotationSortIndex: seed.sortIndex,
          });
          await obEval(
            vaultId!,
            `(async()=>{await app.plugins.plugins.zotlit.services.annotationRepository.refresh(${JSON.stringify(attachment.key)});return true;})()`,
          );
        }

        beforeAll(async () => {
          // A Reader opened afresh renders the Excerpt Images it lacks at
          // once, which is what lets each write here wait for that render.
          await closeZoteroReader(rdp, readerTabID);
          readerTabID = await openZoteroReader(rdp);
          await restoreSeed();
          // A pointer gesture is hit-tested against the page as laid out, and
          // a hidden or occluded window neither lays out nor paints it.
          expect(
            await obEvalUntil(
              vaultId!,
              "(function(){const electronWindow=require('@electron/remote').getCurrentWindow();electronWindow.show();electronWindow.moveTop();return document.visibilityState;})()",
              { expected: "visible" },
            ),
          ).toBe(true);
        });

        afterEach(restoreSeed);

        it("resizes the image from its bottom-right handle and saves on release", async () => {
          const handle = await selectImage();
          const { version } = await storedImage();
          // Twenty points right and thirty points down the page: the right
          // edge moves out to 590 and the bottom edge, PDF's y1, to 365.509.
          const to = {
            x: handle.x + 20 * handle.perX,
            y: handle.y + 30 * handle.perY,
          };
          const pressed = await obJson<{ grip: string; popup: boolean }>(
            `(function(){${fire}window.__ztPixels=[];window.__ztPixelsOff=app.plugins.plugins.zotlit.services.annotationRepository.on('excerpt-pixels-changed',(record)=>window.__ztPixels.push(record.key));const node=fire('pointerdown',${handle.x},${handle.y});const container=${pdfView}.containerEl;fire('pointermove',${(handle.x + to.x) / 2},${(handle.y + to.y) / 2},container);fire('pointermove',${to.x},${to.y},container);return JSON.stringify({grip:node.dataset.ztGrip,popup:!!document.querySelector('.zt-pdf-mark-popup')});})()`,
          );
          // The press landed on the drawn handle, and the popup stood aside.
          expect(pressed).toEqual({ grip: "br", popup: false });
          // Nothing is written while the pointer is down.
          expect((await storedImage()).version).toBe(version);

          await obEval(
            vaultId!,
            `(function(){${fire}const container=${pdfView}.containerEl;fire('pointerup',${to.x},${to.y},container);fire('click',${to.x},${to.y},container);return true;})()`,
          );

          // Zotero holds the predicted rect, read straight off the Local API.
          const expected = [48.75, 365.509, 590, 743.723];
          expect(
            await waitFor(
              async () =>
                (await storedImage()).data.annotationPosition !== seed.position,
            ),
          ).toBe(true);
          const stored = await storedImage();
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
          const recomputed = await obJson<string>(
            `(async()=>{const binding=app.plugins.plugins.zotlit.services.pdfAnnotationEditor.bindings.find((candidate)=>candidate.filePath===${JSON.stringify(attachmentPath)});return JSON.stringify(await binding.sortIndex(${JSON.stringify(position)}));})()`,
          );
          expect(stored.data.annotationSortIndex).toBe(recomputed);

          // Zotero's open Reader holds the same rect.
          expect(
            await waitFor(() =>
              rdp.json<boolean>(`(() => {
                const attachment = ${ATTACHMENT_ITEM};
                const reader = Zotero.Reader._readers.find(
                  (candidate) => candidate.itemID === attachment.id,
                );
                const annotation = reader?._item
                  .getAnnotations()
                  .find(({ key }) => key === ${JSON.stringify(imageKey)});
                return annotation?.annotationPosition === ${JSON.stringify(stored.data.annotationPosition)};
              })()`),
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
          expect(
            await obJson<string[]>(
              "(function(){window.__ztPixelsOff?.();return JSON.stringify(window.__ztPixels);})()",
            ),
          ).toContain(imageKey);
        }, 120000);

        it("writes nothing for a handle released where it was pressed", async () => {
          const handle = await selectImage();
          const { version } = await storedImage();

          const mutation = await obJson<string>(
            `(function(){${fire}const node=fire('pointerdown',${handle.x},${handle.y});fire('pointerup',${handle.x},${handle.y},${pdfView}.containerEl);fire('click',${handle.x},${handle.y},node);return JSON.stringify(app.plugins.plugins.zotlit.services.annotationRepository.mutationFor(${JSON.stringify(imageKey)}).kind);})()`,
          );
          expect(mutation).toBe("idle");

          // The version is the marker: a write of the same rect still bumps it.
          const stored = await storedImage();
          expect(stored.version).toBe(version);
          expect(stored.data.annotationPosition).toBe(seed.position);
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
          const { version } = await storedImage();
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
            `(function(){${fire}const width=${imageMark}.getAttribute('width');const node=fire('pointerdown',${before.x},${before.y});const container=${pdfView}.containerEl;fire('pointermove',${to.x},${to.y},container);fire('pointerup',${to.x},${to.y},container);return JSON.stringify({width:String(Number(${imageMark}.getAttribute('width'))===Number(width)),body:node.dataset?.ztGrip==='body'});})()`,
          );
          expect(outcome).toEqual({ width: "true", body: false });

          await restoreLocalApi.disposeAsync();
          expect((await storedImage()).version).toBe(version);
        }, 120000);
      });

      describe("Mark Handles on the seeded ink", () => {
        const inkKey = "4PE492KU";
        const path = `users/0/items/${inkKey}`;
        const pdfView = `app.workspace.getLeavesOfType('pdf').map(({view})=>view).find((view)=>view.file?.path===${JSON.stringify(attachmentPath)}&&view.containerEl.getBoundingClientRect().width>0)`;
        const inkMark = `${pdfView}?.containerEl.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]')`;
        /** Dispatches one pointer event as the browser would, at a client point. */
        const fire = `const fire=(type,x,y,target)=>{const node=target??document.elementFromPoint(x,y);const init={clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:1,button:0,buttons:type==='pointerup'||type==='click'?0:1,view:window};node.dispatchEvent(type==='click'?new MouseEvent(type,init):new PointerEvent(type,init));return node;};`;

        interface Stored {
          version: number;
          data: { annotationPosition: string; annotationSortIndex: string };
        }
        interface InkPosition {
          pageIndex: number;
          width: number;
          paths: number[][];
        }
        const storedInk = async (): Promise<Stored> =>
          (await (
            await zoteroFetch(api, path, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as Stored;
        const inkSettled = () => readerSettled(rdp, inkKey, { api, serverID });

        /** The ink as the Fixture Spec seeds it. */
        const seeded = ANNOTATIONS.find(({ key }) => key === inkKey)!;
        const seedPosition = seeded.position as InkPosition;
        const seed = {
          position: JSON.stringify(seeded.position),
          sortIndex: seeded.sortIndex,
        };

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
          await inkSettled();
          expect(
            await obEvalUntil(
              vaultId!,
              `(function(){const view=${pdfView};if(!view)return 'no view';view.viewer.child.pdfViewer.pdfViewer.currentPageNumber=1;const mark=${inkMark};if(!mark)return 'no mark';mark.scrollIntoView({block:'center',inline:'center'});return String(mark.getBoundingClientRect().width>0);})()`,
              { expected: "true" },
            ),
          ).toBe(true);
          await obEval(
            vaultId!,
            `(function(){${fire}const mark=${inkMark};if(mark.classList.contains('is-selected'))return 'selected';const rect=mark.getBoundingClientRect();const x=rect.left+rect.width/2,y=rect.top+rect.height/2;const node=fire('pointerdown',x,y);fire('pointerup',x,y,node);fire('click',x,y,node);return 'clicked';})()`,
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
         * Drags from one client point to another with the pointer held, then
         * releases, recording which grip the press took and the Annotations
         * whose pixels the repository announced as changed.
         */
        async function drag(
          from: { x: number; y: number },
          to: { x: number; y: number },
        ): Promise<void> {
          await obEval(
            vaultId!,
            `(function(){${fire}window.__ztPixels=[];window.__ztPixelsOff=app.plugins.plugins.zotlit.services.annotationRepository.on('excerpt-pixels-changed',(record)=>window.__ztPixels.push(record.key));const container=${pdfView}.containerEl;fire('pointerdown',${from.x},${from.y});fire('pointermove',${(from.x + to.x) / 2},${(from.y + to.y) / 2},container);fire('pointermove',${to.x},${to.y},container);fire('pointerup',${to.x},${to.y},container);fire('click',${to.x},${to.y},container);return true;})()`,
          );
        }

        /**
         * The ink Zotero holds once the write and the Reader's render after
         * it have settled, checked against Zotero's open Reader, and the
         * pixel-change announcement for it.
         */
        async function savedInk(): Promise<InkPosition> {
          expect(
            await waitFor(
              async () =>
                (await storedInk()).data.annotationPosition !== seed.position,
            ),
          ).toBe(true);
          await inkSettled();
          const stored = await storedInk();
          // The Sort Index is the one the reader's text structure gives the
          // stored position.
          const recomputed = await obJson<string>(
            `(async()=>{const binding=app.plugins.plugins.zotlit.services.pdfAnnotationEditor.bindings.find((candidate)=>candidate.filePath===${JSON.stringify(attachmentPath)});return JSON.stringify(await binding.sortIndex(${stored.data.annotationPosition}));})()`,
          );
          expect(stored.data.annotationSortIndex).toBe(recomputed);
          // Zotero's open Reader holds the same position.
          expect(
            await rdp.json<string>(`(() => {
              const attachment = ${ATTACHMENT_ITEM};
              const reader = Zotero.Reader._readers.find(
                (candidate) => candidate.itemID === attachment.id,
              );
              return reader?._item
                .getAnnotations()
                .find(({ key }) => key === ${JSON.stringify(inkKey)})
                ?.annotationPosition;
            })()`),
          ).toBe(stored.data.annotationPosition);
          expect(
            await obJson<string[]>(
              "(function(){window.__ztPixelsOff?.();return JSON.stringify(window.__ztPixels);})()",
            ),
          ).toContain(inkKey);
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

        /**
         * Puts the seed back through the Local API, against whatever version
         * Zotero holds once the Reader has finished any render a position
         * change started.
         */
        async function restoreSeed(): Promise<void> {
          await inkSettled();
          const current = await storedInk();
          if (
            current.data.annotationPosition !== seed.position ||
            current.data.annotationSortIndex !== seed.sortIndex
          ) {
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
              body: JSON.stringify({
                version: current.version,
                annotationPosition: seed.position,
                annotationSortIndex: seed.sortIndex,
              }),
            });
            expect(restored.status).toBe(204);
            await inkSettled();
          }
          expect((await storedInk()).data).toMatchObject({
            annotationPosition: seed.position,
            annotationSortIndex: seed.sortIndex,
          });
          await obEval(
            vaultId!,
            `(async()=>{await app.plugins.plugins.zotlit.services.annotationRepository.refresh(${JSON.stringify(attachment.key)});return true;})()`,
          );
        }

        beforeAll(async () => {
          // A Reader opened afresh renders the Excerpt Images it lacks at
          // once, which is what lets each write here wait for that render.
          await closeZoteroReader(rdp, readerTabID);
          readerTabID = await openZoteroReader(rdp);
          await restoreSeed();
          // A pointer gesture is hit-tested against the page as laid out, and
          // a hidden or occluded window neither lays out nor paints it.
          expect(
            await obEvalUntil(
              vaultId!,
              "(function(){const electronWindow=require('@electron/remote').getCurrentWindow();electronWindow.show();electronWindow.moveTop();return document.visibilityState;})()",
              { expected: "visible" },
            ),
          ).toBe(true);
        });

        afterEach(restoreSeed);

        it("moves every point of the ink by its body's drag, the width kept", async () => {
          const { body, perX, perY } = await selectInk();
          // Forty pixels right and twenty down the page: down the page is
          // toward PDF's y origin.
          await drag(body, { x: body.x + 40, y: body.y + 20 });
          const dx = 40 / perX;
          const dy = -20 / perY;

          const position = await savedInk();
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

        it("scales the ink from its bottom-right corner with its proportions and its pen", async () => {
          const { corner, perX } = await selectInk();
          // Thirty pixels right; the vertical travel is ignored, since the
          // new width alone sets a corner's scale.
          await drag(corner, { x: corner.x + 30, y: corner.y + 10 });
          const points = seedPosition.paths.flat();
          const xs = points.filter((_, index) => index % 2 === 0);
          const ys = points.filter((_, index) => index % 2 === 1);
          const left = Math.min(...xs);
          const top = Math.max(...ys);
          const width = Math.max(...xs) - left;
          const scale = (width + 30 / perX) / width;

          const position = await savedInk();
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
            `String(!!(${card})?.querySelector('textarea'))`,
            {
              expected: "true",
            },
          ),
        ).toBe(true);

        const shortcutComment = "Saved by pop-out card Mod+Enter";
        await obEval(
          vaultId!,
          `(function(){const editor=(${card}).querySelector('textarea');editor.value=${JSON.stringify(shortcutComment)};editor.dispatchEvent(new editor.win.Event('input',{bubbles:true}));return true;})()`,
        );
        const shortcut = JSON.parse(
          await obEval(
            vaultId!,
            `(function(){const editor=(${card}).querySelector('textarea');const mac=editor.win.navigator.platform.startsWith('Mac');const event=new editor.win.KeyboardEvent('keydown',{key:'Enter',metaKey:mac,ctrlKey:!mac,bubbles:true,cancelable:true});editor.dispatchEvent(event);return JSON.stringify({prevented:event.defaultPrevented,open:editor.isConnected,owned:editor.win!==(${readerPdf}).win});})()`,
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
            `String(!!(${card})?.querySelector('textarea'))`,
          ),
        ).toBe("true");
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
        const vaultPath = getDevVaultDir(pairedWorkspaceRoot);
        const legacySource = join(
          reach!.layout.dataDir,
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
 * in the Development Vault a Paired Run opened.
 */
async function digestAttachmentPdf(): Promise<string> {
  const file = join(getDevVaultDir(pairedWorkspaceRoot), attachmentPath);
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

/**
 * Waits until Zotero is done with the last position write on one image or ink
 * Annotation. The write drops the cached Excerpt Image in a commit callback
 * nothing awaits; Zotero's open Reader then renders a fresh image and saves the
 * whole Annotation, which bumps its version. A write sent before that save
 * carries a stale version and is refused with 412, so this waits until the
 * Reader holds the stored position with a rendered image and nothing left to
 * save, the cache image is back, and two Local API reads 1.5 s apart agree on
 * the version.
 */
async function readerSettled(
  rdp: ZoteroRdp,
  annotationKey: string,
  { api, serverID }: { api: string; serverID: string },
): Promise<void> {
  const readerDone = () =>
    rdp.json<boolean>(`(async () => {
      const attachment = ${ATTACHMENT_ITEM};
      const item = Zotero.Items.getByLibraryAndKey(
        attachment.libraryID,
        ${JSON.stringify(annotationKey)},
      );
      const reader = Zotero.Reader._readers.find(
        (candidate) => candidate.itemID === attachment.id,
      );
      const manager = reader?._internalReader?._annotationManager;
      if (!item || !manager) return false;
      // The Reader's annotations live in its content window, so they are read
      // by index rather than handed a chrome callback.
      let held = null;
      for (let index = 0; index < manager._annotations.length; index++) {
        const candidate = manager._annotations[index];
        if (candidate.id === ${JSON.stringify(annotationKey)}) held = candidate;
      }
      const canonical = (position) =>
        JSON.stringify(position, Object.keys(position).sort());
      return (
        !!held?.image &&
        canonical(held.position) ===
          canonical(JSON.parse(item.annotationPosition)) &&
        manager._unsavedAnnotations.size === 0 &&
        !manager._savingInProgress &&
        (await Zotero.Annotations.hasCacheImage(item))
      );
    })()`);
  const version = async () =>
    (
      (await (
        await zoteroFetch(api, `users/0/items/${annotationKey}`, {
          headers: { "Zotero-Server-ID": serverID },
        })
      ).json()) as { version: number }
    ).version;
  expect(
    await waitFor(async () => {
      if (!(await readerDone())) return false;
      const before = await version();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return (await readerDone()) && (await version()) === before;
    }, 120),
    `the Zotero Reader never settled on ${annotationKey}`,
  ).toBe(true);
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
