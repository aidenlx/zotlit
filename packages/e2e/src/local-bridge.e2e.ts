import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import { webWorkbenchEnabled } from "./e2e-run-fixture.ts";
import { e2eVaultPath } from "./e2e-run-fixture.ts";
import { openProfilesSettings } from "./e2e-run-helpers.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { clickModalButton, observeNotices } from "./e2e-run-note-helpers.ts";
import * as suite from "./e2e-run-suite-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { waitFor } from "./obsidian-cli.ts";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  describe.skipIf(!webWorkbenchEnabled)("Local Bridge", () => {
    let port = 0;
    let origin = "";
    let credential = "";
    let source = "";
    let revision = "";
    let defaultPath = "";

    async function request(path: string, body?: unknown) {
      return fetch(`http://127.0.0.1:${port}/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    }

    afterAll(async () => {
      if (!run.vaultId) return;
      await obRun(
        run.vaultId,
        async ({ page }) => {
          if (page.scratch.originalOpen) {
            window.open = page.scratch.originalOpen;
            delete page.scratch.originalOpen;
          }
          delete page.scratch.workbenchLaunch;
          return String(true);
        },
        undefined,
      ).catch(() => {});
    });

    it("launches from the Template document row and exchanges its Connection code", async () => {
      defaultPath = await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.profileService.defaultDocumentPath,
          );
        },
        undefined,
      );
      await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { defaultPath }) => {
          const file = app.vault.getFileByPath(defaultPath);
          if (file) await app.vault.delete(file);
          app.saveLocalStorage("zotlit-workbench-launch-approved", null);
          app.saveLocalStorage("zotlit-profile-customization", "ask");
          zotlit.services.bridge.runSync(
            zotlit.services.settings.update({
              "server.enabled": false,
              "server.workbench": false,
            }),
          );
          page.scratch.originalOpen = window.open;
          window.open = new Proxy(window.open, {
            apply: (
              target,
              receiver: Window,
              args: Parameters<typeof window.open>,
            ) => {
              const url = String(args[0]);
              if (!url.startsWith("http:") && !url.startsWith("https:"))
                return Reflect.apply(target, receiver, args) as Window | null;
              page.scratch.workbenchLaunch = args[0];
              return null;
            },
          });
        },
        { defaultPath },
      );
      await suite.mainSettings();
      await suite.clickTemplateCustomize();
      await obRunUntil(
        run.vaultId,
        async ({ page }, { rememberLabel }) => {
          const { press } = page;
          var radio = document.querySelector<HTMLInputElement>(
            'input[name="zotlit-customize-destination"][value="native"]',
          );
          if (!radio) return false;
          press(radio.closest("label") ?? radio, "Native destination");
          var row = Array.from(
            document.querySelectorAll(".modal .setting-item"),
          ).find(
            (el) =>
              el.querySelector(".setting-item-name")?.textContent ===
              rememberLabel,
          );
          var toggle = row?.querySelector<HTMLElement>(".checkbox-container");
          if (!toggle) return false;
          press(toggle, "Remember");
          return true;
        },
        { rememberLabel: run.m.modal_workbench_launch_remember() },
        {
          what: "the Native destination radio and Remember toggle in the Customize modal",
        },
      );
      await clickModalButton(run.vaultId, run.m.modal_workbench_launch_open());
      await obRunUntil(
        run.vaultId,
        async ({ app }) => {
          return (
            app.workspace.activeLeaf?.view.getViewType() ===
              "zotlit-template-workbench" &&
            app.loadLocalStorage("zotlit-profile-customization") === "native"
          );
        },
        undefined,
        {
          what: "the Template Workbench to be active with native customization stored",
        },
      );
      expect(
        await obRun(
          run.vaultId,
          async ({ app, zotlit, page }, { defaultPath }) => {
            return (
              !!app.vault.getFileByPath(defaultPath) &&
              page.workbench()?.controller.readOnly === false &&
              page.scratch.workbenchLaunch === undefined &&
              !zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "server.enabled"
              ] &&
              !zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "server.workbench"
              ]
            );
          },
          { defaultPath },
        ),
      ).toBe(true);
      await suite.mainSettings();
      await suite.clickTemplateCustomize();
      await obRunUntil(
        run.vaultId,
        async ({ app }) => {
          return (
            app.workspace.activeLeaf?.view.getViewType() ===
              "zotlit-template-workbench" &&
            !document.querySelector(
              'input[name="zotlit-customize-destination"]',
            )
          );
        },
        undefined,
        {
          what: "the customize destination radios to disappear with the Template Workbench active",
        },
      );
      expect(
        await obRun(
          run.vaultId,
          async ({ zotlit, page }) => {
            return (
              page.scratch.workbenchLaunch === undefined &&
              !zotlit.services.bridge.runSync(zotlit.services.settings.current)[
                "server.enabled"
              ]
            );
          },
          undefined,
        ),
      ).toBe(true);
      // The web save cases start from the built-in Default again.
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          await zotlit.services.bridge.runPromise(
            zotlit.services.profileService.restoreDefault,
          );
        },
        undefined,
      );
      await obRunUntil(
        run.vaultId,
        async ({ app }, { defaultPath }) => {
          return !app.vault.getFileByPath(defaultPath);
        },
        { defaultPath },
        {
          what: "the default Template document file to be absent from the vault",
        },
      );
      await obRun(
        run.vaultId,
        async ({ app }) => {
          app.saveLocalStorage("zotlit-profile-customization", "ask");
        },
        undefined,
      );
      await suite.mainSettings();
      await suite.clickTemplateCustomize();
      await obRunUntil(
        run.vaultId,
        async (_context, { modalTitleText }) => {
          return Array.from(document.querySelectorAll(".modal-title")).some(
            (el) => el.textContent === modalTitleText,
          );
        },
        { modalTitleText: run.m.modal_workbench_launch_title() },
        { what: "a modal title element with the expected text to appear" },
      );
      await clickModalButton(run.vaultId, run.m.modal_workbench_launch_open());
      await obRunUntil(
        run.vaultId,
        async ({ page }) => {
          return typeof page.scratch.workbenchLaunch === "string";
        },
        undefined,
        {
          what: "the workbench launch Connection code to be stored in the page scratch record",
        },
      );
      // Capture the browser handoff at its outer boundary. The entry action,
      // sheet, minted code, and HTTP exchange all run in the real plugin.
      let launch: URL;
      try {
        launch = new URL(
          await obRun(
            run.vaultId,
            async ({ page }) => {
              return String(page.scratch.workbenchLaunch);
            },
            undefined,
          ),
        );
      } catch {
        throw new Error("The Workbench launch URL was unavailable");
      }
      origin = launch.origin;
      port = Number(
        await obRun(
          run.vaultId,
          async ({ zotlit }) => {
            return String(
              zotlit.services.bridge.runSync(
                zotlit.services.localServer.effectivePort,
              ),
            );
          },
          undefined,
        ),
      );
      const fragment = new URLSearchParams(launch.hash.slice(1));
      expect(Number(fragment.get("port"))).toBe(port);
      expect(launch.pathname).toBe("/workbench");
      const response = await request("bootstrap/code", {
        code: fragment.get("zotlit-connect"),
      });
      expect(response.status).toBe(200);
      const grant = (await response.json()) as {
        credential: string;
        bridgeVersion: number;
        selectedProfile: { id: string };
      };
      // Assert individual non-secret fields; a failed assertion must not dump
      // a grant, Connection code, or Item Snapshot into the test report.
      expect(grant.bridgeVersion).toBe(2);
      expect(grant.selectedProfile.id).toBe("default");
      expect(
        typeof grant.credential === "string" && grant.credential.length > 0,
      ).toBe(true);
      credential = grant.credential;
      const selected = await request("profile/selected");
      expect(selected.status).toBe(200);
      const profile = (await selected.json()) as {
        source: string;
        document: { state: string };
      };
      expect(profile.document.state).toBe("built-in-absent");
      source = profile.source;
      await obRun(
        run.vaultId,
        async ({ app }) => {
          app.setting.close();
        },
        undefined,
      );
    });

    it("saves Default's document and shows the ejected settings state and Notice", async () => {
      await using notices = await observeNotices(run.vaultId);
      const response = await request("profile/selected/save", {
        reference: "default",
        expected: { state: "absent" },
        source,
      });
      expect(response.status).toBe(200);
      const saved = (await response.json()) as {
        state: string;
        revision: string;
      };
      expect(saved.state).toBe("saved");
      revision = saved.revision;
      expect(
        (await readFile(join(e2eVaultPath, defaultPath), "utf-8")) === source,
      ).toBe(true);
      expect(
        await waitFor(async () =>
          (await notices.read()).some(
            (text) =>
              text.includes(run.m.notice_workbench_profile_saved()) &&
              text.includes(run.m.notice_workbench_profile_saved_action()),
          ),
        ),
      ).toBe(true);
      await suite.mainSettings();
      await obRunUntil(
        run.vaultId,
        async (_context, { documentName, restoreButtonLabel }) => {
          var row = Array.from(document.querySelectorAll(".setting-item")).find(
            (el) =>
              el.querySelector(".setting-item-name")?.textContent ===
              documentName,
          );
          return (
            !!row &&
            Array.from(row.querySelectorAll("button")).some(
              (el) => el.getAttribute("aria-label") === restoreButtonLabel,
            )
          );
        },
        {
          documentName: run.m.settings_profile_document_name(),
          restoreButtonLabel: run.m.settings_profile_document_restore(),
        },
        {
          what: "the saved Default document's settings row to show a restore button",
        },
      );
      await obRun(
        run.vaultId,
        async ({ app }) => {
          app.setting.close();
        },
        undefined,
      );
    });

    it("refuses a Save after the vault document changes", async () => {
      const changed = `${source}\n<!-- external edit -->\n`;
      await obRun(
        run.vaultId,
        async ({ app }, { defaultPath, changed }) => {
          await app.vault.modify(
            app.vault.getFileByPath(defaultPath)!,
            changed,
          );
        },
        { defaultPath, changed },
      );
      const response = await request("profile/selected/save", {
        reference: "default",
        expected: { state: "revision", revision },
        source,
      });
      expect(response.status).toBe(200);
      const refused = (await response.json()) as {
        state: string;
        reason: string;
      };
      expect(refused.state).toBe("refused");
      expect(refused.reason).toBe("revision-conflict");
      expect(
        (await readFile(join(e2eVaultPath, defaultPath), "utf-8")) === changed,
      ).toBe(true);
    });

    it("disconnects from the settings row and refuses the next request with 401", async () => {
      await openProfilesSettings(run.vaultId, "settings_page_advanced");
      await obRunUntil(
        run.vaultId,
        async ({ page }, { connectionName, host, disconnectButtonText }) => {
          const { press } = page;
          var row = Array.from(document.querySelectorAll(".setting-item")).find(
            (el) =>
              el.querySelector(".setting-item-name")?.textContent ===
              connectionName,
          );
          if (!row || !row.textContent.includes(host)) return false;
          var button = Array.from(row.querySelectorAll("button")).find(
            (el) => el.textContent === disconnectButtonText,
          );
          if (!button) return false;
          press(button, "Disconnect");
          return true;
        },
        {
          connectionName:
            run.m.settings_local_server_workbench_connection_name(),
          host: new URL(origin).host,
          disconnectButtonText:
            run.m.settings_local_server_workbench_disconnect(),
        },
        {
          what: "the connection settings row to show its host and a Disconnect button",
        },
      );
      const response = await request("profile/selected");
      expect(response.status).toBe(401);
      const refused = (await response.json()) as { error: { code: string } };
      expect(refused.error.code).toBe("session-revoked");
      await obRunUntil(
        run.vaultId,
        async (_context, { connectionName }) => {
          return !Array.from(
            document.querySelectorAll(".setting-item-name"),
          ).some((el) => el.textContent === connectionName);
        },
        {
          connectionName:
            run.m.settings_local_server_workbench_connection_name(),
        },
        {
          what: "the connection settings row to disappear after disconnecting",
        },
      );
      await obRun(
        run.vaultId,
        async ({ app }) => {
          app.setting.close();
        },
        undefined,
      );
    });

    it("keeps an unsupported Profile in Obsidian with one Notice when native is remembered", async () => {
      const javascriptProperty =
        "frontmatter:\n  - key: generated\n    js: zt.title\n    merge: replace\n";
      const javascriptSource = source.includes("frontmatter:\n")
        ? source.replace("frontmatter:\n", javascriptProperty)
        : source.replace(
            "language: liquid\n",
            `language: liquid\n${javascriptProperty}`,
          );
      for (const unsupported of [
        source.replace("language: liquid", "language: eta"),
        javascriptSource,
      ]) {
        expect(unsupported !== source).toBe(true);
        await obRun(
          run.vaultId,
          async ({ app, page }, { defaultPath, unsupported }) => {
            app.saveLocalStorage("zotlit-profile-customization", "native");
            await app.vault.modify(
              app.vault.getFileByPath(defaultPath)!,
              unsupported,
            );
            delete page.scratch.workbenchLaunch;
          },
          { defaultPath, unsupported },
        );
        await obRunUntil(
          run.vaultId,
          async ({ zotlit }, { unsupported }) => {
            return (
              (await zotlit.services.bridge.runPromise(
                zotlit.services.profileService.getSource("default"),
              )) === unsupported
            );
          },
          { unsupported },
          {
            what: "the default Profile's source to match the unsupported value",
          },
        );
        await using notices = await observeNotices(run.vaultId);
        await suite.mainSettings();
        await suite.clickTemplateCustomize();
        expect(
          await waitFor(async () =>
            (await notices.read()).some((text) =>
              text.includes(run.m.notice_workbench_unsupported_profile()),
            ),
          ),
        ).toBe(true);
        expect(
          (await notices.read()).filter(
            (text) =>
              text.includes(run.m.notice_workbench_unsupported_profile()) ||
              text.includes(run.m.template_workbench_native_required()),
          ),
        ).toHaveLength(1);
        await obRunUntil(
          run.vaultId,
          async ({ app }, { defaultPath }) => {
            return (
              app.workspace.getActiveFile()?.path === defaultPath &&
              app.workspace.activeLeaf?.view.getViewType() ===
                "zotlit-template-workbench"
            );
          },
          { defaultPath },
          {
            what: "the default Profile file to open in the Template Workbench",
          },
        );
        expect(
          await obRun(
            run.vaultId,
            async ({ page }) => {
              return page.scratch.workbenchLaunch === undefined;
            },
            undefined,
          ),
        ).toBe(true);
        await obRun(
          run.vaultId,
          async ({ app }) => {
            app.setting.close();
          },
          undefined,
        );
      }
    });
  });

  // A geometry assertion, not a DOM one: the menu this replaced put every entry
  // in the DOM inside a popup collapsed onto its own border, so counting
  // entries passed while the menu read as empty on screen.
  //
  // @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
});
