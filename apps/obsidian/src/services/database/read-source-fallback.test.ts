// Read-fallback priority at the database source boundary.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("reflink fallback notices", () => {
  let dir: string;
  let source: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `zotlit-read-fallback-test-${crypto.randomUUID()}`);
    source = join(dir, "zotero.sqlite");
    await mkdir(dir, { recursive: true });
    await writeFile(source, "main");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prioritizes a skipped WAL over the unsupported reflink", async () => {
    await writeFile(`${source}-wal`, "wal");

    await using prepared = await prepareRead("reflink", source);

    expect(prepared.fallbackNotice).toBe("wal-not-replayed");
  });

  it("warns when Auto falls back to an immutable read that skips a WAL", async () => {
    await writeFile(`${source}-wal`, "wal");

    await using prepared = await prepareRead("auto", source);

    expect(prepared.fallbackNotice).toBe("wal-not-replayed");
  });

  it("reports the unsupported reflink when no WAL is skipped", async () => {
    await using prepared = await prepareRead("reflink", source);

    expect(prepared.fallbackNotice).toBe("reflink-unsupported");
  });
});
