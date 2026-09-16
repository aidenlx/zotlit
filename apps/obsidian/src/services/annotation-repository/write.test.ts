import { expect, it } from "vitest";

import { editingCapabilityCopy } from "./capability-copy";
import { writeFailureMessage } from "./write";
import type { WriteFailure } from "./write";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

/** Every outcome a write can end on, which this copy table must be total over. */
const FAILURES: WriteFailure[] = [
  { kind: "db-source" },
  { kind: "unknown-annotation" },
  { kind: "not-found" },
  { kind: "conflict" },
  { kind: "write-token-used" },
  { kind: "unknown-outcome" },
  { kind: "unreachable" },
  { kind: "local-api-disabled" },
  { kind: "unauthorized" },
  { kind: "denied" },
  { kind: "library-read-only" },
  { kind: "server-changed" },
  { kind: "cooldown", retryAfter: Temporal.Duration.from({ seconds: 30 }) },
  { kind: "incompatible-zotero" },
  { kind: "invalid-response", issue: "400 itemType not provided" },
];

it("names every outcome a write can end on, and says the edit did not land", () => {
  const messages = FAILURES.map((failure) => writeFailureMessage(failure, NOW));

  expect(messages.every((message) => message.length > 0)).toBe(true);
  // One sentence stands in front of every reason: the user learns the edit was
  // refused before they learn why.
  const [firstSentence] = messages.map((message) => message.split(". ")[0]);
  expect(messages.every((message) => message.startsWith(firstSentence!))).toBe(
    true,
  );
});

it("tells the five outcomes no capability describes apart", () => {
  const own = [
    { kind: "db-source" },
    { kind: "unknown-annotation" },
    { kind: "not-found" },
    { kind: "conflict" },
    { kind: "unknown-outcome" },
  ] satisfies WriteFailure[];

  const messages = own.map((failure) => writeFailureMessage(failure, NOW));

  expect(new Set(messages).size).toBe(own.length);
});

it("borrows the Editing Capability's own words where a failure has one", () => {
  const copy = editingCapabilityCopy(
    { kind: "read-only", reason: "library-read-only" },
    NOW,
  );

  const message = writeFailureMessage({ kind: "library-read-only" }, NOW);

  expect(message).toContain(copy.label);
  expect(message).toContain(copy.detail);
});

it("reads a replayed write token as the same thing a stale version is", () => {
  // A patch and a delete both send a version and no write token, so a token
  // refusal reaches this path only as "Zotero's copy moved".
  expect(writeFailureMessage({ kind: "write-token-used" }, NOW)).toBe(
    writeFailureMessage({ kind: "conflict" }, NOW),
  );
});
