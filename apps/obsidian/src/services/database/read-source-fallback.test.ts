// Read-fallback priority at the database source boundary.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/reflink", () => {
  class ReflinkUnsupportedError extends Error {}
  return {
    ReflinkUnsupportedError,
    reflink: vi.fn(async () => {
      throw new ReflinkUnsupportedError();
    }),
  };
});

import { prepareRead } from "./read-source";

async function createFixture(): Promise<
  AsyncDisposable & { source: string; sqlite: DatabaseSync }
> {
  await using stack = new AsyncDisposableStack();
  const dir = await mkdtemp(join(tmpdir(), "zotlit-read-fallback-test-"));
  stack.defer(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "zotero.sqlite");
  const sqlite = stack.use(new DatabaseSync(source));
  sqlite.exec("CREATE TABLE fixture (value TEXT NOT NULL)");
  const cleanup = stack.move();
  return {
    source,
    sqlite,
    async [Symbol.asyncDispose]() {
      await cleanup[Symbol.asyncDispose]();
    },
  };
}

describe("reflink fallback reasons", () => {
  it("keeps committed WAL rows in the verified copy fallback", async () => {
    await using fixture = await createFixture();
    const { source, sqlite } = fixture;
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA wal_checkpoint(TRUNCATE);
      INSERT INTO fixture VALUES ('committed in WAL');
    `);

    await using prepared = await prepareRead("reflink", source);
    using snapshot = new DatabaseSync(prepared.path, {
      readOnly: true,
    });

    expect(prepared.path).not.toBe(source);
    expect(prepared.effectiveMode).toBe("copy");
    expect(prepared.uriOptions).toEqual({ mode: "ro" });
    expect(prepared.fallbackReason).toBe("reflink-unsupported");
    expect(snapshot.prepare("SELECT value FROM fixture").get()).toEqual({
      value: "committed in WAL",
    });
  });

  it("reports Auto's verified copy fallback when reflinks are unsupported", async () => {
    await using fixture = await createFixture();
    const { source } = fixture;

    await using prepared = await prepareRead("auto", source);

    expect(prepared.path).not.toBe(source);
    expect(prepared.effectiveMode).toBe("copy");
    expect(prepared.fallbackReason).toBe("reflink-unsupported");
  });

  it("reports an unsupported explicit reflink when no WAL is skipped", async () => {
    await using fixture = await createFixture();
    const { source } = fixture;
    await using prepared = await prepareRead("reflink", source);

    expect(prepared.path).not.toBe(source);
    expect(prepared.effectiveMode).toBe("copy");
    expect(prepared.fallbackReason).toBe("reflink-unsupported");
  });

  it("uses a verified main-file copy for an explicit immutable read", async () => {
    await using fixture = await createFixture();
    const { source } = fixture;
    await using prepared = await prepareRead("immutable", source);

    expect(prepared.path).not.toBe(source);
    expect(prepared.effectiveMode).toBe("immutable");
    expect(prepared.uriOptions).toEqual({ mode: "ro", immutable: true });
  });
});
