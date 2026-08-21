// Read-fallback priority at the database source boundary.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function createFixture(): Promise<AsyncDisposable & { source: string }> {
  await using stack = new AsyncDisposableStack();
  const dir = await mkdtemp(join(tmpdir(), "zotlit-read-fallback-test-"));
  stack.defer(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "zotero.sqlite");
  await writeFile(source, Buffer.alloc(100));
  const cleanup = stack.move();
  return {
    source,
    async [Symbol.asyncDispose]() {
      await cleanup[Symbol.asyncDispose]();
    },
  };
}

describe("reflink fallback reasons", () => {
  it("prioritizes a skipped WAL over the unsupported reflink", async () => {
    await using fixture = await createFixture();
    const { source } = fixture;
    await writeFile(`${source}-wal`, "wal");

    await using prepared = await prepareRead("reflink", source);

    expect(prepared.fallbackReason).toBe("wal-not-replayed");
  });

  it("warns when Auto falls back to an immutable read that skips a WAL", async () => {
    await using fixture = await createFixture();
    const { source } = fixture;
    await writeFile(`${source}-wal`, "wal");

    await using prepared = await prepareRead("auto", source);

    expect(prepared.fallbackReason).toBe("wal-not-replayed");
  });

  it("reports the unsupported reflink when no WAL is skipped", async () => {
    await using fixture = await createFixture();
    const { source } = fixture;
    await using prepared = await prepareRead("reflink", source);

    expect(prepared.fallbackReason).toBe("reflink-unsupported");
  });
});
