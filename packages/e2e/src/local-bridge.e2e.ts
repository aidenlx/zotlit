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
          return String(
            zotlit.services.bridge.runSync(
              zotlit.services.profileService.defaultDocumentPath,
            ),
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
      expect(await suite.clickTemplateCustomize()).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ page }, { __typedArg0 }) => {
              const { press } = page;
              var radio = document.querySelector<HTMLInputElement>(
                'input[name="zotlit-customize-destination"][value="native"]',
              );
              if (!radio) return String(false);
              press(radio.closest("label") ?? radio, "Native destination");
              var row = Array.from(
                document.querySelectorAll(".modal .setting-item"),
              ).find(
                (el) =>
                  el.querySelector(".setting-item-name")?.textContent ===
                  __typedArg0,
              );
              var toggle = row?.querySelector<HTMLElement>(
                ".checkbox-container",
              );
              if (!toggle) return String(false);
              press(toggle, "Remember");
              return String(true);
            },
            { __typedArg0: run.m.modal_workbench_launch_remember() },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:59",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      expect(
        await clickModalButton(
          run.vaultId,
          run.m.modal_workbench_launch_open(),
        ),
      ).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ app }) => {
              return String(
                String(
                  app.workspace.activeLeaf?.view.getViewType() ===
                    "zotlit-template-workbench" &&
                    app.loadLocalStorage("zotlit-profile-customization") ===
                      "native",
                ),
              );
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:72",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      expect(
        await obRun(
          run.vaultId,
          async ({ app, zotlit, page }, { __typedArg0 }) => {
            return String(
              String(
                !!app.vault.getFileByPath(__typedArg0) &&
                  page.workbench()?.controller.readOnly === false &&
                  page.scratch.workbenchLaunch === undefined &&
                  !zotlit.services.bridge.runSync(
                    zotlit.services.settings.current,
                  )["server.enabled"] &&
                  !zotlit.services.bridge.runSync(
                    zotlit.services.settings.current,
                  )["server.workbench"],
              ),
            );
          },
          { __typedArg0: defaultPath },
        ),
      ).toBe("true");
      await suite.mainSettings();
      expect(await suite.clickTemplateCustomize()).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ app }) => {
              return String(
                String(
                  app.workspace.activeLeaf?.view.getViewType() ===
                    "zotlit-template-workbench" &&
                    !document.querySelector(
                      'input[name="zotlit-customize-destination"]',
                    ),
                ),
              );
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:87",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      expect(
        await obRun(
          run.vaultId,
          async ({ zotlit, page }) => {
            return String(
              String(
                page.scratch.workbenchLaunch === undefined &&
                  !zotlit.services.bridge.runSync(
                    zotlit.services.settings.current,
                  )["server.enabled"],
              ),
            );
          },
          undefined,
        ),
      ).toBe("true");
      // The web save cases start from the built-in Default again.
      await obRun(
        run.vaultId,
        async ({ zotlit }) => {
          await zotlit.services.bridge.runPromise(
            zotlit.services.profileService.restoreDefault(),
          );
          return String(true);
        },
        undefined,
      );
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ app }, { __typedArg0 }) => {
              return String(String(!app.vault.getFileByPath(__typedArg0)));
            },
            { __typedArg0: defaultPath },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:105",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      await obRun(
        run.vaultId,
        async ({ app }) => {
          app.saveLocalStorage("zotlit-profile-customization", "ask");
          return String(true);
        },
        undefined,
      );
      await suite.mainSettings();
      expect(await suite.clickTemplateCustomize()).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async (_context, { __typedArg0 }) => {
              return String(
                String(
                  Array.from(document.querySelectorAll(".modal-title")).some(
                    (el) => el.textContent === __typedArg0,
                  ),
                ),
              );
            },
            { __typedArg0: run.m.modal_workbench_launch_title() },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:118",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      expect(
        await clickModalButton(
          run.vaultId,
          run.m.modal_workbench_launch_open(),
        ),
      ).toBe(true);
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ page }) => {
              return String(
                String(typeof page.scratch.workbenchLaunch === "string"),
              );
            },
            undefined,
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:131",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
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
          return String(true);
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
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async (_context, { __typedArg0, __typedArg1 }) => {
              var row = Array.from(
                document.querySelectorAll(".setting-item"),
              ).find(
                (el) =>
                  el.querySelector(".setting-item-name")?.textContent ===
                  __typedArg0,
              );
              return String(
                String(
                  !!row &&
                    Array.from(row.querySelectorAll("button")).some(
                      (el) => el.getAttribute("aria-label") === __typedArg1,
                    ),
                ),
              );
            },
            {
              __typedArg0: run.m.settings_profile_document_name(),
              __typedArg1: run.m.settings_profile_document_restore(),
            },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:211",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      await obRun(
        run.vaultId,
        async ({ app }) => {
          app.setting.close();
          return String(true);
        },
        undefined,
      );
    });

    it("refuses a Save after the vault document changes", async () => {
      const changed = `${source}\n<!-- external edit -->\n`;
      await obRun(
        run.vaultId,
        async ({ app }, { __typedArg0, __typedArg1 }) => {
          await app.vault.modify(
            app.vault.getFileByPath(__typedArg0)!,
            __typedArg1,
          );
          return String(true);
        },
        { __typedArg0: defaultPath, __typedArg1: changed },
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
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async ({ page }, { __typedArg0, __typedArg1, __typedArg2 }) => {
              const { press } = page;
              var row = Array.from(
                document.querySelectorAll(".setting-item"),
              ).find(
                (el) =>
                  el.querySelector(".setting-item-name")?.textContent ===
                  __typedArg0,
              );
              if (!row || !row.textContent.includes(__typedArg1))
                return String(false);
              var button = Array.from(row.querySelectorAll("button")).find(
                (el) => el.textContent === __typedArg2,
              );
              if (!button) return String(false);
              press(button, "Disconnect");
              return String(true);
            },
            {
              __typedArg0:
                run.m.settings_local_server_workbench_connection_name(),
              __typedArg1: new URL(origin).host,
              __typedArg2: run.m.settings_local_server_workbench_disconnect(),
            },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:246",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      const response = await request("profile/selected");
      expect(response.status).toBe(401);
      const refused = (await response.json()) as { error: { code: string } };
      expect(refused.error.code).toBe("session-revoked");
      expect(
        await ((options: { expected: string; tries?: number }) =>
          obRunUntil(
            run.vaultId,
            async (_context, { __typedArg0 }) => {
              return String(
                String(
                  !Array.from(
                    document.querySelectorAll(".setting-item-name"),
                  ).some((el) => el.textContent === __typedArg0),
                ),
              );
            },
            {
              __typedArg0:
                run.m.settings_local_server_workbench_connection_name(),
            },
            {
              ready: (value) => value === options.expected,
              tries: options.tries,
              what: "local-bridge.e2e.ts:257",
            },
          ).then(
            () => true,
            () => false,
          ))({ expected: "true" }),
      ).toBe(true);
      await obRun(
        run.vaultId,
        async ({ app }) => {
          app.setting.close();
          return String(true);
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
          async ({ app, page }, { __typedArg0, __typedArg1 }) => {
            app.saveLocalStorage("zotlit-profile-customization", "native");
            await app.vault.modify(
              app.vault.getFileByPath(__typedArg0)!,
              __typedArg1,
            );
            delete page.scratch.workbenchLaunch;
            return String(true);
          },
          { __typedArg0: defaultPath, __typedArg1: unsupported },
        );
        expect(
          await ((options: { expected: string; tries?: number }) =>
            obRunUntil(
              run.vaultId,
              async ({ zotlit }, { __typedArg0 }) => {
                return String(
                  String(
                    (await zotlit.services.bridge.runPromise(
                      zotlit.services.profileService.getSource("default"),
                    )) === __typedArg0,
                  ),
                );
              },
              { __typedArg0: unsupported },
              {
                ready: (value) => value === options.expected,
                tries: options.tries,
                what: "local-bridge.e2e.ts:285",
              },
            ).then(
              () => true,
              () => false,
            ))({ expected: "true" }),
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
          await ((options: { expected: string; tries?: number }) =>
            obRunUntil(
              run.vaultId,
              async ({ app }, { __typedArg0 }) => {
                return String(
                  String(
                    app.workspace.getActiveFile()?.path === __typedArg0 &&
                      app.workspace.activeLeaf?.view.getViewType() ===
                        "zotlit-template-workbench",
                  ),
                );
              },
              { __typedArg0: defaultPath },
              {
                ready: (value) => value === options.expected,
                tries: options.tries,
                what: "local-bridge.e2e.ts:309",
              },
            ).then(
              () => true,
              () => false,
            ))({ expected: "true" }),
        ).toBe(true);
        expect(
          await obRun(
            run.vaultId,
            async ({ page }) => {
              return String(String(page.scratch.workbenchLaunch === undefined));
            },
            undefined,
          ),
        ).toBe("true");
        await obRun(
          run.vaultId,
          async ({ app }) => {
            app.setting.close();
            return String(true);
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
