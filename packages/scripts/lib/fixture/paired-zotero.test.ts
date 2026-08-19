import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  getManagedZoteroLayout,
  getZoteroBinary,
  PINNED_ZOTERO_VERSION,
  resolveZoteroApp,
  ZOTERO_APP_ENV,
} from "./paired-zotero.ts";

const originalOverride = process.env[ZOTERO_APP_ENV];

afterEach(() => {
  if (originalOverride === undefined) delete process.env[ZOTERO_APP_ENV];
  else process.env[ZOTERO_APP_ENV] = originalOverride;
});

describe.skipIf(process.platform !== "win32")(
  "Paired Zotero on Windows",
  () => {
    it.each([
      ["arm64", "win-arm64"],
      ["x64", "win-x64"],
      ["ia32", "win32"],
    ] as const)("selects the %s portable archive", (arch, target) => {
      const localAppData = "C:\\Users\\fixture\\AppData\\Local";
      const cacheDir = join(
        localAppData,
        "zotlit",
        "zotero",
        PINNED_ZOTERO_VERSION,
        target,
      );

      expect(
        getManagedZoteroLayout({
          arch,
          env: { LOCALAPPDATA: localAppData },
          home: "C:\\Users\\fixture",
          platform: "win32",
        }),
      ).toEqual({
        applicationDir: join(cacheDir, `Zotero_${target}`),
        archiveName: `Zotero-${PINNED_ZOTERO_VERSION}_${target}.zip`,
        cacheDir,
        downloadUrl: `https://download.zotero.org/client/release/${PINNED_ZOTERO_VERSION}/Zotero-${PINNED_ZOTERO_VERSION}_${target}.zip`,
      });
    });

    it("resolves a portable ZOTERO_APP override", async () => {
      const root = await mkdtemp(join(tmpdir(), "zotlit-zotero-override-"));
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(() => rm(root, { recursive: true, force: true }));
      const applicationDir = join(root, "Zotero");
      await mkdir(applicationDir);
      await writeFile(join(applicationDir, "zotero.exe"), "");
      process.env[ZOTERO_APP_ENV] = applicationDir;

      expect(getZoteroBinary(applicationDir)).toBe(
        join(applicationDir, "zotero.exe"),
      );
      await expect(resolveZoteroApp()).resolves.toBe(applicationDir);
    });
  },
);
