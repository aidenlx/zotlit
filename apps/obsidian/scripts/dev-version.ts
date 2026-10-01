// Dev Build version: the manifest of a development build marks itself as a
// dev pre-release of the release in package.json, so it never reads as that
// release. It derives from package.json alone, so a turbo cache hit on
// `build:dev` always restores the correct version.

import { inc, prerelease } from "semver";

/**
 * Derive a semver version that ranks above `release` and below the next
 * release, e.g. `2.2.0-beta.1` → `2.2.0-beta.1.dev` and `2.2.0` → `2.2.1-dev`.
 */
export function deriveDevVersion(release: string): string {
  return prerelease(release) === null
    ? `${inc(release, "patch")}-dev`
    : `${release}.dev`;
}
