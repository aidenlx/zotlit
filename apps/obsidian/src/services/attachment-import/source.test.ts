// The source decision is synchronous over a constructed snapshot, so every
// case here runs without touching a filesystem — including the
// case-insensitive one, which must hold regardless of the CI host.

import { describe, expect, it } from "vitest";

import {
  decideSource,
  NO_ROOTS,
  type CanonicalRoots,
  type SourceOrigin,
} from "./source";

const STORAGE = "/zotero/storage";
const CACHE = "/zotero/cache";
const BASE = "/home/me/Papers";
const APPROVED = "/home/me/Scans";

function roots(overrides?: Partial<CanonicalRoots>): CanonicalRoots {
  return {
    storage: { declared: STORAGE, canonical: STORAGE },
    annotationCache: { declared: CACHE, canonical: CACHE },
    base: { declared: BASE, canonical: BASE },
    approved: [{ declared: APPROVED, canonical: APPROVED }],
    caseInsensitive: false,
    ...overrides,
  };
}

function decide(path: string, origin: SourceOrigin, snapshot = roots()) {
  return decideSource(path, origin, snapshot);
}

describe("decideSource", () => {
  it("approves a file inside the storage directory, carrying its origin and root", () => {
    expect(decide(`${STORAGE}/IMG12345/paper.pdf`, "storage")).toMatchObject({
      approved: true,
      path: `${STORAGE}/IMG12345/paper.pdf`,
      origin: "storage",
      root: STORAGE,
    });
  });

  it("approves an annotation cache image", () => {
    expect(
      decide(`${CACHE}/library/ANNOT123.png`, "annotation-cache").approved,
    ).toBe(true);
  });

  it("approves a linked file inside the base attachment directory", () => {
    expect(decide(`${BASE}/2024/paper.pdf`, "linked-base").approved).toBe(true);
  });

  it("blocks an absolute linked file outside every root", () => {
    expect(decide("/etc/passwd", "linked-absolute")).toEqual({
      approved: false,
      path: "/etc/passwd",
      origin: "linked-absolute",
      reason: "outside-trusted-root",
    });
  });

  it("approves an absolute linked file inside an approved folder", () => {
    expect(decide(`${APPROVED}/scan.pdf`, "linked-absolute")).toMatchObject({
      approved: true,
      origin: "linked-absolute",
      root: APPROVED,
    });
  });

  it("blocks a base-directory linked file when the base preference is unset", () => {
    expect(
      decide(`${BASE}/paper.pdf`, "linked-base", roots({ base: null }))
        .approved,
    ).toBe(false);
  });

  it("blocks a path that only shares a prefix with a root", () => {
    expect(decide(`${STORAGE}-evil/paper.pdf`, "storage").approved).toBe(false);
  });

  it("blocks the root directory itself", () => {
    expect(decide(STORAGE, "storage").approved).toBe(false);
  });

  it("blocks a path that escapes its root through a parent segment", () => {
    expect(decide(`${STORAGE}/../../etc/passwd`, "storage").approved).toBe(
      false,
    );
  });

  it("keeps origins apart: a cache path is not approved as storage", () => {
    expect(decide(`${CACHE}/library/A.png`, "storage").approved).toBe(false);
  });

  it("blocks a case-differing path on a case-sensitive filesystem", () => {
    expect(decide("/ZOTERO/storage/IMG/paper.pdf", "storage").approved).toBe(
      false,
    );
  });

  it("approves a case-differing path on a case-insensitive filesystem", () => {
    expect(
      decide(
        "/ZOTERO/Storage/IMG/paper.pdf",
        "storage",
        roots({ caseInsensitive: true }),
      ).approved,
    ).toBe(true);
  });

  it("blocks every origin against an empty snapshot", () => {
    const origins: SourceOrigin[] = [
      "storage",
      "annotation-cache",
      "linked-base",
      "linked-absolute",
    ];
    for (const origin of origins) {
      expect(
        decide(`${STORAGE}/IMG/paper.pdf`, origin, NO_ROOTS).approved,
      ).toBe(false);
    }
  });
});
