import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ZOTERO_DB_READ_PARENT_DIRNAME } from "@/lib/constants";

import { planReadParents } from "./read-parent";

const DATA_DIR = "/Volumes/External/Zotero";
const DB_PATH = join(DATA_DIR, "zotero.sqlite");
const DIVERTED = join(DATA_DIR, ZOTERO_DB_READ_PARENT_DIRNAME);

describe("planReadParents", () => {
  it("diverts beside the database when the two volumes differ", () => {
    expect(
      planReadParents({
        databasePath: DB_PATH,
        tempDevice: 1n,
        databaseDevice: 2n,
      }),
    ).toEqual({ parents: [DIVERTED, tmpdir()], reason: "cross-volume" });
  });

  it("keeps the temp folder when both sides share one volume", () => {
    expect(
      planReadParents({
        databasePath: DB_PATH,
        tempDevice: 7n,
        databaseDevice: 7n,
      }),
    ).toEqual({ parents: [tmpdir()], reason: "same-volume" });
  });

  it("keeps the temp folder when either device id reads as unknown", () => {
    expect(
      planReadParents({
        databasePath: DB_PATH,
        tempDevice: 0n,
        databaseDevice: 2n,
      }),
    ).toEqual({ parents: [tmpdir()], reason: "unknown-volume" });
    expect(
      planReadParents({
        databasePath: DB_PATH,
        tempDevice: 1n,
        databaseDevice: 0n,
      }),
    ).toEqual({ parents: [tmpdir()], reason: "unknown-volume" });
  });

  it("keeps the temp folder for a UNC database path", () => {
    for (const databasePath of [
      "\\\\server\\share\\Zotero\\zotero.sqlite",
      "\\\\?\\UNC\\server\\share\\Zotero\\zotero.sqlite",
    ]) {
      expect(
        planReadParents({ databasePath, tempDevice: 1n, databaseDevice: 2n }),
      ).toEqual({ parents: [tmpdir()], reason: "network-path" });
    }
  });

  it("treats a Windows long local path as local, not as a share", () => {
    expect(
      planReadParents({
        databasePath: "\\\\?\\D:\\Zotero\\zotero.sqlite",
        tempDevice: 1n,
        databaseDevice: 2n,
      }).reason,
    ).toBe("cross-volume");
  });
});
