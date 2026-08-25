// Release URLs for the install pages. The hourly-fresh GitHub lookups behind
// the Version Ledger and the direct `.xpi` link land with the dynamic-parity
// slice; until then the install pages render the fail-soft form these two
// constants describe.
import { repoUrl } from "./shared.ts";

export type ReleaseChannel = "pre-release" | "stable";

export const releasesUrl = `${repoUrl}/releases`;
