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
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
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

const reach = await probePairedRun(getFixtureRoot(workspaceRoot)).catch(
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
    workspaceRoot,
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

  beforeAll(async () => {
    serverID = await readServerID(api);
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
      rdp[Symbol.dispose]();
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
      rdp[Symbol.dispose]();
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

      beforeAll(async () => {
        rdp = await openZoteroRdp(debuggerPort!);
        // The PDF is a `vault`-rooted linked file, so it is only readable where
        // a Development Vault stands — which is exactly this block's gate.
        pdfDigestBefore = await digestAttachmentPdf();
        // A digest of nothing would make the closing assertion vacuous.
        expect(pdfDigestBefore).toHaveLength(64);
        await resetAuthorizations(rdp);
        // Both halves start with no authorization. Clearing only Zotero's side
        // would leave ZotLit holding a key Zotero no longer knows: the first
        // write then answers 401 and the gesture fails instead of asking, and
        // the failure survives into the next run. Whether ZotLit should
        // re-authorize on a 401 within one gesture is a separate question —
        // aidenlx/zotlit#1139 — but the scenario must not create the state.
        await obEval(
          vaultId!,
          "(async()=>{await app.plugins.plugins.zotlit.services.zoteroLocalApi.forgetAuthorization();return true;})()",
        );
        await stubPrompt(rdp, { allow: true, remember: true });
        // Zotero's Reader is opened on the Attachment before anything is
        // written, so "visible in the Zotero Reader" is a claim about a reader
        // that was already showing the document when the write landed.
        readerTabID = await openZoteroReader(rdp);

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

      afterAll(async () => {
        // Every Annotation this block created leaves with it, through Zotero
        // rather than through ZotLit, so cleanup does not depend on the code
        // under test.
        if (createdKey) {
          await rdp.json(`(async () => {
            const item = Zotero.Items.getByLibraryAndKey(
              Zotero.Libraries.userLibraryID,
              ${JSON.stringify(createdKey)},
            );
            if (item) await item.eraseTx();
            return "erased";
          })()`);
        }
        if (readerTabID) await closeZoteroReader(rdp, readerTabID);
        const restored = await restorePrompt(rdp);
        expect(restored.original).toBe(true);
        await resetAuthorizations(rdp);
        // Both halves end where they began. Clearing only Zotero's side would
        // leave the developer's ZotLit holding a key Zotero has forgotten, and
        // their next manual edit would take a 401 with no dialog — the failure
        // this block's own setup comment describes.
        await obEval(
          vaultId!,
          "(async()=>{await app.plugins.plugins.zotlit.services.zoteroLocalApi.forgetAuthorization();return true;})()",
        ).catch(() => "");
        // Leave the workspace as it was found.
        await obEval(
          vaultId!,
          "app.workspace.getLeavesOfType('pdf').forEach(leaf=>leaf.detach());app.workspace.detachLeavesOfType('zotero-annotation-view');true",
        ).catch(() => "");
        rdp[Symbol.dispose]();
      }, 120000);

      // Last in this block, so it covers every write above: ZotLit writes
      // Annotations, never the PDF the Annotations hang from.
      it("leaves the Attachment's PDF byte-identical", async () => {
        expect(await digestAttachmentPdf()).toBe(pdfDigestBefore);
      });

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
            `String(!!document.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]'))`,
            { expected: "true" },
          ),
        ).toBe(true);

        // The Annotation Card, in the Annotation View.
        expect(
          await obEvalUntil(
            vaultId!,
            `String(!!document.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]'))`,
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
            `String(document.querySelector('.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')?.getAttribute('fill'))`,
            { expected: edited },
          ),
        ).toBe(true);
        // The Annotation Card's swatch carries it.
        expect(
          await obEvalUntil(
            vaultId!,
            `(function(){var card=document.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]');if(!card)return 'no card';return String(Array.from(card.querySelectorAll('*')).some(function(node){return node.style.backgroundColor===${JSON.stringify(hexToRgb(edited))}||node.getAttribute('fill')===${JSON.stringify(edited)};}));})()`,
            { expected: "true" },
          ),
        ).toBe(true);
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
            `(async()=>{const repository=app.plugins.plugins.zotlit.services.annotationRepository;await repository.read(${JSON.stringify(attachment.key)});return String(document.querySelector('.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]')?.textContent.includes(${JSON.stringify(fromZotero)}));})()`,
            { expected: "true" },
          ),
        ).toBe(true);
      }, 120000);

      it("degrades to the Zotero database when the Local API is turned off, and recovers", async () => {
        // The pref must come back whatever this test does, so a failure part
        // way through cannot leave the next run's Zotero serving nothing.
        await using restoreLocalApi = new AsyncDisposableStack();
        restoreLocalApi.defer(async () => {
          await setLocalApi(rdp, true);
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
            `(async()=>{const list=await app.plugins.plugins.zotlit.services.annotationRepository.read(${JSON.stringify(attachment.key)});return String(list?.source.kind);})()`,
            { expected: "zotero-db" },
          ),
        ).toBe(true);

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
  const file = join(getDevVaultDir(workspaceRoot), attachmentPath);
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

/** Hex as the browser reports a computed background colour. */
function hexToRgb(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  );
  return `rgb(${red}, ${green}, ${blue})`;
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

const ATTACHMENT_ITEM = `Zotero.Items.getByLibraryAndKey(
  Zotero.Libraries.userLibraryID,
  ${JSON.stringify(attachment.key)},
)`;

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
