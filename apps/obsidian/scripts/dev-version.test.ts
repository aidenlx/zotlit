import { gt, lt } from "semver";
import { describe, expect, it } from "vitest";

import { deriveDevVersion } from "./dev-version.ts";

describe("deriveDevVersion", () => {
  it.each([
    ["2.2.0-beta.1", "2.2.0-beta.1.dev", "2.2.0-beta.2"],
    ["2.2.0", "2.2.1-dev", "2.2.1"],
  ])("turns %s into %s, ranked below %s", (release, expected, next) => {
    const version = deriveDevVersion(release);
    expect(version).toBe(expected);
    expect(gt(version, release)).toBe(true);
    expect(lt(version, next)).toBe(true);
  });
});
