import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { forkFixtureData, removeFixtureFork } from "./fork.ts";
import { getFixtureLayout } from "./layout.ts";

import { getWorkspaceRoot } from "#package-roots";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const scratch = join(await getWorkspaceRoot(import.meta.dirname), ".scratch");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "fixture-fork-test-"));
  roots.push(root);
  const layout = getFixtureLayout(root);
  await mkdir(join(layout.dataDir, "storage", "ATTACH01"), { recursive: true });
  await writeFile(
    join(layout.dataDir, "storage", "ATTACH01", "paper.pdf"),
    "fixture PDF bytes",
  );
  using database = new DatabaseSync(layout.databasePath);
  database.exec(
    "CREATE TABLE items (title TEXT); INSERT INTO items VALUES ('original')",
  );
  return layout;
}

// Failure modes: shared database/assets, missed WAL commits, overwrite of a
// prior fork, path escape, missing source and partial copies left after errors.
describe("Fixture data forks", () => {
  it("isolates database and asset writes, then removes only the fork", async () => {
    const layout = await fixture();
    const original = await readFile(layout.databasePath);
    const path = await forkFixtureData(layout, "write-check");
    expect(isAbsolute(path)).toBe(true);
    expect(path).toBe(join(layout.root, "forks", "write-check"));
    {
      using database = new DatabaseSync(join(path, "zotero.sqlite"));
      expect(database.prepare("SELECT title FROM items").get()).toEqual({
        title: "original",
      });
      database.exec("UPDATE items SET title = 'changed'");
    }
    const asset = join("storage", "ATTACH01", "paper.pdf");
    expect(await readFile(join(path, asset), "utf8")).toBe("fixture PDF bytes");
    await writeFile(join(path, asset), "changed");
    expect(await readFile(join(layout.dataDir, asset), "utf8")).toBe(
      "fixture PDF bytes",
    );
    expect(await readFile(layout.databasePath)).toEqual(original);
    await removeFixtureFork(layout, "write-check");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(layout.databasePath)).toEqual(original);
  });

  it("includes committed WAL data in a consistent database", async () => {
    const layout = await fixture();
    using source = new DatabaseSync(layout.databasePath);
    source.exec("PRAGMA journal_mode=WAL; INSERT INTO items VALUES ('in WAL')");
    const path = await forkFixtureData(layout, "wal");
    using copy = new DatabaseSync(join(path, "zotero.sqlite"));
    expect(
      copy.prepare("SELECT title FROM items ORDER BY title").all(),
    ).toEqual([{ title: "in WAL" }, { title: "original" }]);
    expect(copy.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("preserves an existing fork", async () => {
    const layout = await fixture();
    const path = await forkFixtureData(layout, "kept");
    await writeFile(join(path, "sentinel"), "kept");
    await expect(forkFixtureData(layout, "kept")).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(join(path, "sentinel"), "utf8")).toBe("kept");
  });

  it.each([
    "",
    ".",
    "..",
    "../zotero-data",
    "/outside",
    "a/b",
    "a\\b",
    "a".repeat(65),
  ])("rejects an unsafe name: %s", async (name) => {
    const layout = await fixture();
    await expect(forkFixtureData(layout, name)).rejects.toThrow("fork name");
    await expect(removeFixtureFork(layout, name)).rejects.toThrow("fork name");
    await expect(stat(layout.databasePath)).resolves.toBeDefined();
  });

  it("rejects a symlinked forks parent", async () => {
    const layout = await fixture();
    await symlink(layout.dataDir, join(layout.root, "forks"), "dir");
    await expect(forkFixtureData(layout, "escape")).rejects.toThrow(
      "real directory",
    );
    await expect(removeFixtureFork(layout, "storage")).rejects.toThrow(
      "real directory",
    );
  });

  it("requires built data and cleans up a failed snapshot", async () => {
    const layout = await fixture();
    await rm(layout.databasePath);
    await expect(forkFixtureData(layout, "missing")).rejects.toThrow(
      "pnpm fixture",
    );
    await writeFile(layout.databasePath, "invalid SQLite");
    await expect(forkFixtureData(layout, "invalid")).rejects.toThrow();
    await expect(
      stat(join(layout.root, "forks", "invalid")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
