import { assertEquals } from "@std/assert";
import { describe, it } from "vitest";

import {
  isDormant,
  newestPreRelease,
  newestStableRelease,
} from "@/lib/github-releases";
import type { GhRelease } from "@/lib/github-releases";

function release(tag: string, prerelease = true): GhRelease {
  return {
    tag_name: tag,
    draft: false,
    prerelease,
    published_at: "2026-08-01T00:00:00Z",
  };
}

describe("newestPreRelease", () => {
  it("picks by semver precedence, not list order", () => {
    const releases = [
      release("2.0.0-beta.2"),
      release("2.0.0-beta.10"),
      release("2.0.0-beta.9"),
    ];
    assertEquals(newestPreRelease(releases)?.tag_name, "2.0.0-beta.10");
  });

  it("skips companion and infrastructure tags", () => {
    const releases = [
      release("zt-2.1.0-beta.0"),
      release("zotero-release"),
      release("res-2.0.0"),
      release("2.0.0-beta.4"),
    ];
    assertEquals(newestPreRelease(releases)?.tag_name, "2.0.0-beta.4");
  });

  it("skips stable releases", () => {
    const releases = [release("2.1.0", false), release("2.0.0-beta.4")];
    assertEquals(newestPreRelease(releases)?.tag_name, "2.0.0-beta.4");
  });

  it("skips draft pre-releases", () => {
    const draft = { ...release("2.0.0-beta.5"), draft: true };
    assertEquals(
      newestPreRelease([draft, release("2.0.0-beta.4")])?.tag_name,
      "2.0.0-beta.4",
    );
  });

  it("returns null when no pre-release qualifies", () => {
    assertEquals(newestPreRelease([release("2.0.0", false)]), null);
    assertEquals(newestPreRelease([]), null);
  });
});

describe("newestStableRelease", () => {
  it("picks the highest published stable semver", () => {
    const releases = [
      release("2.0.0", false),
      release("2.1.0-beta.0"),
      release("2.0.1", false),
    ];
    assertEquals(newestStableRelease(releases)?.tag_name, "2.0.1");
  });

  it("skips drafts, pre-releases, and non-plugin tags", () => {
    const draft = { ...release("2.1.0", false), draft: true };
    const releases = [
      draft,
      release("2.1.0-beta.0"),
      release("zt-2.0.2", false),
      release("2.0.1", false),
    ];
    assertEquals(newestStableRelease(releases)?.tag_name, "2.0.1");
  });

  it("returns null when no stable release qualifies", () => {
    assertEquals(newestStableRelease([release("2.1.0-beta.0")]), null);
    assertEquals(newestStableRelease([]), null);
  });
});

describe("isDormant", () => {
  it("is dormant when stable has passed the pre-release", () => {
    assertEquals(isDormant("2.0.0-beta.4", "2.0.0"), true);
  });

  it("is dormant when both channels carry the same version", () => {
    assertEquals(isDormant("2.0.0", "2.0.0"), true);
  });

  it("is awake when the pre-release leads stable", () => {
    assertEquals(isDormant("2.1.0-beta.0", "2.0.1"), false);
    assertEquals(isDormant("2.0.1", "2.0.0"), false);
  });

  it("is awake when no stable release exists yet", () => {
    assertEquals(isDormant("2.0.0-beta.0", null), false);
  });
});
