import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { unregisterVaultFile } from "./obsidian-vault-registry.ts";

/** A temporary Obsidian user data folder, removed when the test leaves scope. */
async function userDataFolder() {
  const path = await mkdtemp(join(tmpdir(), "zt-obsidian-registry-"));
  return {
    path,
    registry: join(path, "obsidian.json"),
    [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }),
  };
}

const target = join(tmpdir(), "zt-registry-target-vault");
const other = join(tmpdir(), "zt-registry-other-vault");

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("unregisterVaultFile", () => {
  it("removes the vault's entry, state, and Partition and keeps every other setting", async () => {
    await using userData = await userDataFolder();
    await writeFile(
      userData.registry,
      JSON.stringify({
        vaults: {
          aaaa: { path: target, ts: 1, open: true },
          bbbb: { path: other, ts: 2 },
        },
        frame: "hidden",
      }),
    );
    await writeFile(join(userData.path, "aaaa.json"), "{}");
    await writeFile(join(userData.path, "bbbb.json"), "{}");
    await mkdir(join(userData.path, "Partitions", "vault-aaaa"), {
      recursive: true,
    });

    expect(await unregisterVaultFile(userData.path, target)).toBe("aaaa");

    expect(JSON.parse(await readFile(userData.registry, "utf-8"))).toEqual({
      vaults: { bbbb: { path: other, ts: 2 } },
      frame: "hidden",
    });
    expect(await exists(join(userData.path, "aaaa.json"))).toBe(false);
    expect(await exists(join(userData.path, "bbbb.json"))).toBe(true);
    expect(await exists(join(userData.path, "Partitions", "vault-aaaa"))).toBe(
      false,
    );
    // The staging file is renamed into place, so none is left beside it.
    expect((await readdir(userData.path)).sort()).toEqual([
      "Partitions",
      "bbbb.json",
      "obsidian.json",
    ]);
  });

  it("leaves the registry unchanged when no entry holds the vault", async () => {
    await using userData = await userDataFolder();
    const raw = JSON.stringify({ vaults: { bbbb: { path: other, ts: 2 } } });
    await writeFile(userData.registry, raw);

    expect(await unregisterVaultFile(userData.path, target)).toBeUndefined();
    expect(await readFile(userData.registry, "utf-8")).toBe(raw);
  });

  it("finds nothing to remove when Obsidian has no registry file", async () => {
    await using userData = await userDataFolder();

    expect(await unregisterVaultFile(userData.path, target)).toBeUndefined();
    expect(await exists(userData.registry)).toBe(false);
  });

  it("refuses to rewrite a registry that holds invalid JSON", async () => {
    await using userData = await userDataFolder();
    const raw = `{"vaults":{"aaaa":{"path":${JSON.stringify(target)}`;
    await writeFile(userData.registry, raw);

    await expect(unregisterVaultFile(userData.path, target)).rejects.toThrow(
      "holds invalid JSON",
    );
    expect(await readFile(userData.registry, "utf-8")).toBe(raw);
  });
});
