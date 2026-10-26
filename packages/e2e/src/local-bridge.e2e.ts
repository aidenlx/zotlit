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
import { obEval, obEvalUntil, waitFor } from "./obsidian-cli.ts";
import { PAGE } from "./page-gestures.ts";

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
      await obEval(
        run.vaultId,
        "if(window.zotlitE2EOpen){window.open=window.zotlitE2EOpen;delete window.zotlitE2EOpen;}delete window.zotlitE2ELaunch;true",
      ).catch(() => {});
    });

    it("launches from the Template document row and exchanges its Connection code", async () => {
      defaultPath = await obEval(
        run.vaultId,
        "app.plugins.plugins.zotlit.services.profile.defaultDocumentPath",
      );
      await obEval(
        run.vaultId,
        `(async function(){var file=app.vault.getFileByPath(${JSON.stringify(defaultPath)});if(file)await app.vault.delete(file);app.saveLocalStorage('zotlit-workbench-launch-approved',null);app.saveLocalStorage('zotlit-profile-customization','ask');app.plugins.plugins.zotlit.services.settings.update({'server.enabled':false,'server.workbench':false});window.zotlitE2EOpen=window.open;window.open=function(url){if(!/^https?:/.test(String(url)))return window.zotlitE2EOpen.apply(this,arguments);window.zotlitE2ELaunch=url;return null;};return true;})()`,
      );
      await suite.mainSettings();
      expect(await suite.clickTemplateCustomize()).toBe(true);
      expect(
        await obEvalUntil(
          run.vaultId,
          `(function(){${PAGE}var radio=document.querySelector('input[name="zotlit-customize-destination"][value="native"]');if(!radio)return false;press(radio.closest('label')??radio,'Native destination');var row=Array.from(document.querySelectorAll('.modal .setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(run.m.modal_workbench_launch_remember())});var toggle=row?.querySelector('.checkbox-container');if(!toggle)return false;press(toggle,'Remember');return true;})()`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await clickModalButton(
          run.vaultId,
          run.m.modal_workbench_launch_open(),
        ),
      ).toBe(true);
      expect(
        await obEvalUntil(
          run.vaultId,
          "String(app.workspace.activeLeaf?.view.getViewType()==='zotlit-template-workbench'&&app.loadLocalStorage('zotlit-profile-customization')==='native')",
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await obEval(
          run.vaultId,
          `String(!!app.vault.getFileByPath(${JSON.stringify(defaultPath)})&&app.workspace.activeLeaf?.view.controller?.readOnly===false&&window.zotlitE2ELaunch===undefined&&!app.plugins.plugins.zotlit.services.settings.current['server.enabled']&&!app.plugins.plugins.zotlit.services.settings.current['server.workbench'])`,
        ),
      ).toBe("true");
      await suite.mainSettings();
      expect(await suite.clickTemplateCustomize()).toBe(true);
      expect(
        await obEvalUntil(
          run.vaultId,
          `String(app.workspace.activeLeaf?.view.getViewType()==='zotlit-template-workbench'&&!document.querySelector('input[name="zotlit-customize-destination"]'))`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await obEval(
          run.vaultId,
          "String(window.zotlitE2ELaunch===undefined&&!app.plugins.plugins.zotlit.services.settings.current['server.enabled'])",
        ),
      ).toBe("true");
      // The web save cases start from the built-in Default again.
      await obEval(
        run.vaultId,
        "(async function(){await app.plugins.plugins.zotlit.services.profile.restoreDefault();return true;})()",
      );
      expect(
        await obEvalUntil(
          run.vaultId,
          `String(!app.vault.getFileByPath(${JSON.stringify(defaultPath)}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(
        run.vaultId,
        "app.saveLocalStorage('zotlit-profile-customization','ask');true",
      );
      await suite.mainSettings();
      expect(await suite.clickTemplateCustomize()).toBe(true);
      expect(
        await obEvalUntil(
          run.vaultId,
          `String(Array.from(document.querySelectorAll('.modal-title')).some(el=>el.textContent===${JSON.stringify(run.m.modal_workbench_launch_title())}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      expect(
        await clickModalButton(
          run.vaultId,
          run.m.modal_workbench_launch_open(),
        ),
      ).toBe(true);
      expect(
        await obEvalUntil(
          run.vaultId,
          "String(typeof window.zotlitE2ELaunch==='string')",
          { expected: "true" },
        ),
      ).toBe(true);
      // Capture the browser handoff at its outer boundary. The entry action,
      // sheet, minted code, and HTTP exchange all run in the real plugin.
      let launch: URL;
      try {
        launch = new URL(await obEval(run.vaultId, "window.zotlitE2ELaunch"));
      } catch {
        throw new Error("The Workbench launch URL was unavailable");
      }
      origin = launch.origin;
      port = Number(
        await obEval(
          run.vaultId,
          "app.plugins.plugins.zotlit.services.localServer.effectivePort",
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
      await obEval(run.vaultId, "app.setting.close();true");
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
      expect(
        await obEvalUntil(
          run.vaultId,
          `(function(){var row=Array.from(document.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(run.m.settings_profile_document_name())});return String(!!row&&Array.from(row.querySelectorAll('button')).some(el=>el.getAttribute('aria-label')===${JSON.stringify(run.m.settings_profile_document_restore())}));})()`,
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(run.vaultId, "app.setting.close();true");
    });

    it("refuses a Save after the vault document changes", async () => {
      const changed = `${source}\n<!-- external edit -->\n`;
      await obEval(
        run.vaultId,
        `(async function(){await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(defaultPath)}),${JSON.stringify(changed)});return true;})()`,
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
      expect(
        await obEvalUntil(
          run.vaultId,
          `(function(){${PAGE}var row=Array.from(document.querySelectorAll('.setting-item')).find(el=>el.querySelector('.setting-item-name')?.textContent===${JSON.stringify(run.m.settings_local_server_workbench_connection_name())});if(!row||!row.textContent.includes(${JSON.stringify(new URL(origin).host)}))return false;var button=Array.from(row.querySelectorAll('button')).find(el=>el.textContent===${JSON.stringify(run.m.settings_local_server_workbench_disconnect())});if(!button)return false;press(button,'Disconnect');return true;})()`,
          { expected: "true" },
        ),
      ).toBe(true);
      const response = await request("profile/selected");
      expect(response.status).toBe(401);
      const refused = (await response.json()) as { error: { code: string } };
      expect(refused.error.code).toBe("session-revoked");
      expect(
        await obEvalUntil(
          run.vaultId,
          `String(!Array.from(document.querySelectorAll('.setting-item-name')).some(el=>el.textContent===${JSON.stringify(run.m.settings_local_server_workbench_connection_name())}))`,
          { expected: "true" },
        ),
      ).toBe(true);
      await obEval(run.vaultId, "app.setting.close();true");
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
        await obEval(
          run.vaultId,
          `(async function(){app.saveLocalStorage('zotlit-profile-customization','native');await app.vault.modify(app.vault.getFileByPath(${JSON.stringify(defaultPath)}),${JSON.stringify(unsupported)});delete window.zotlitE2ELaunch;return true;})()`,
        );
        expect(
          await obEvalUntil(
            run.vaultId,
            `(async function(){return String((await app.plugins.plugins.zotlit.services.profile.getSource('default'))===${JSON.stringify(unsupported)});})()`,
            { expected: "true" },
          ),
        ).toBe(true);
        await using notices = await observeNotices(run.vaultId);
        await suite.mainSettings();
        expect(await suite.clickTemplateCustomize()).toBe(true);
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
        expect(
          await obEvalUntil(
            run.vaultId,
            `String(app.workspace.getActiveFile()?.path===${JSON.stringify(defaultPath)}&&app.workspace.activeLeaf?.view.getViewType()==='zotlit-template-workbench')`,
            { expected: "true" },
          ),
        ).toBe(true);
        expect(
          await obEval(
            run.vaultId,
            "String(window.zotlitE2ELaunch===undefined)",
          ),
        ).toBe("true");
        await obEval(run.vaultId, "app.setting.close();true");
      }
    });
  });

  // A geometry assertion, not a DOM one: the menu this replaced put every entry
  // in the DOM inside a popup collapsed onto its own border, so counting
  // entries passed while the menu read as empty on screen.
  //
  // @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
});
