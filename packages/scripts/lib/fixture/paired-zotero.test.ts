import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  getManagedBetterBibtexLayout,
  getManagedZoteroLayout,
  getZoteroBinary,
  installBetterBibtex,
  PINNED_BETTER_BIBTEX_VERSION,
  PINNED_ZOTERO_VERSION,
  resolveZoteroApp,
  ZOTERO_APP_ENV,
} from "./paired-zotero.ts";

import { getWorkspaceRoot } from "#package-roots";

const originalOverride = process.env[ZOTERO_APP_ENV];

afterEach(() => {
  if (originalOverride === undefined) delete process.env[ZOTERO_APP_ENV];
  else process.env[ZOTERO_APP_ENV] = originalOverride;
});

describe("managed Better BibTeX", () => {
  it("pins the official release and checksum in the macOS cache", () => {
    const home = "/Users/fixture";
    const archive = `zotero-better-bibtex-${PINNED_BETTER_BIBTEX_VERSION}.xpi`;

    expect(getManagedBetterBibtexLayout({ home, platform: "darwin" })).toEqual({
      addonId: "better-bibtex@iris-advies.com",
      archivePath: join(
        home,
        "Library",
        "Caches",
        "zotlit",
        "better-bibtex",
        PINNED_BETTER_BIBTEX_VERSION,
        archive,
      ),
      downloadUrl: `https://github.com/retorquere/zotero-better-bibtex/releases/download/v${PINNED_BETTER_BIBTEX_VERSION}/${archive}`,
      sha256:
        "2d914ebb174c2c590ecff741a6903f1979065b42740f301d938ec2cb6c03e4d6",
    });
  });

  it("installs the verified XPI under the add-on id", async () => {
    const scratch = join(await getWorkspaceRoot(import.meta.dirname), "tmp");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(join(scratch, "better-bibtex-test-"));
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => rm(root, { recursive: true, force: true }));
    const archivePath = join(root, "better-bibtex.xpi");
    const bytes = "fixture Better BibTeX XPI";
    await writeFile(archivePath, bytes);

    await installBetterBibtex(join(root, "profile"), {
      addonId: "better-bibtex@example.com",
      archivePath,
      downloadUrl: "https://example.com/better-bibtex.xpi",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });

    await expect(
      readFile(
        join(root, "profile", "extensions", "better-bibtex@example.com.xpi"),
        "utf-8",
      ),
    ).resolves.toBe(bytes);
  });
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
