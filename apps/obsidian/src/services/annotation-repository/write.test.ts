import { expect, it } from "vitest";

import type { ResolvedAnnotationTypeName } from "@zotlit/db";

import { editingCapabilityCopy } from "./capability-copy";
import {
  createRequest,
  MAX_POSITION_LENGTH,
  newWriteToken,
  writeFailureMessage,
  writePosition,
} from "./write";
import type { AnnotationDraft, WriteFailure } from "./write";

const NOW = Temporal.Instant.from("2026-09-16T15:52:21Z");

/** A stand-in token, so a request's own shape is what an assertion reads. */
const TOKEN = "0123456789abcdef0123456789abcdef";

/**
 * The Fixture's own underline on `rougier-2014.pdf`, with a fourth decimal on
 * each corner so the rounding the write applies is visible.
 *
 * @see packages/scripts/lib/fixture/spec.ts — `ANNOTATIONS`
 */
const UNROUNDED = [
  [67.011_4, 612.638_4, 211.485_4, 620.770_4],
  [58.054_4, 601.980_4, 211.489_4, 610.112_4],
];

function draft(overrides: Partial<AnnotationDraft> = {}): AnnotationDraft {
  return {
    parentKey: "RGRPDF24",
    type: "underline",
    color: "#FF6666",
    comment: "",
    text: "Scientific visualization",
    pageLabel: "1",
    sortIndex: "00000|000434|00180",
    position: { pageIndex: 0, rects: UNROUNDED },
    ...overrides,
  };
}

/** The one object a create's body carries, with its keys in wire order. */
function created(request: { body?: string }): Record<string, unknown> {
  const [object] = JSON.parse(request.body!) as Record<string, unknown>[];
  return object!;
}

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

it("sends one object to the library's own items route, with a write token", () => {
  const request = createRequest("users/0", draft(), TOKEN);

  expect(request.path).toBe("/api/users/0/items");
  expect(request.method).toBe("POST");
  expect(request.writeToken).toBe(TOKEN);
  expect(request.headers).toEqual({
    "Content-Type": "application/json",
    "Zotero-Write-Token": TOKEN,
  });
  expect(JSON.parse(request.body!)).toHaveLength(1);
});

it("puts annotationType first, because Zotero's own mapper walks the body", () => {
  // Every other `annotation*` setter asserts the type is already set, so a
  // later type is a `400`.
  // @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L5677
  expect(
    Object.keys(created(createRequest("users/0", draft(), TOKEN)))[0],
  ).toBe("annotationType");
});

it("carries no client key and no version, because Zotero generates the key", () => {
  const object = created(createRequest("users/0", draft(), TOKEN));

  expect(object).not.toHaveProperty("key");
  expect(object).not.toHaveProperty("version");
});

it("sends the colour in lower case, which is the only form Zotero matches", () => {
  // @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4512-L4518
  expect(
    created(createRequest("users/0", draft({ color: "#FF6666" }), TOKEN))
      .annotationColor,
  ).toBe("#ff6666");
});

it("rounds the stored rects to three decimals, on both pages", () => {
  const object = created(
    createRequest(
      "users/0",
      draft({
        position: {
          pageIndex: 0,
          rects: UNROUNDED,
          nextPageRects: [[1.000_49, 2.000_51, 3.5, 4.000_04]],
        },
      }),
      TOKEN,
    ),
  );

  expect(JSON.parse(object.annotationPosition as string)).toEqual({
    pageIndex: 0,
    rects: [
      [67.011, 612.638, 211.485, 620.77],
      [58.054, 601.98, 211.489, 610.112],
    ],
    nextPageRects: [[1, 2.001, 3.5, 4]],
  });
});

it("leaves nextPageRects out of a quote that stayed on one page", () => {
  const object = created(createRequest("users/0", draft(), TOKEN));

  expect(JSON.parse(object.annotationPosition as string)).not.toHaveProperty(
    "nextPageRects",
  );
});

it.each(["highlight", "underline"] satisfies ResolvedAnnotationTypeName[])(
  "sends the quoted text for a %s",
  (type) => {
    expect(
      created(createRequest("users/0", draft({ type }), TOKEN)).annotationText,
    ).toBe("Scientific visualization");
  },
);

it.each([
  "note",
  "image",
  "ink",
  "text",
] satisfies ResolvedAnnotationTypeName[])(
  "sends no text for a %s, which Zotero refuses it on",
  (type) => {
    // @see https://github.com/zotero/zotero/blob/22f08d1ceddc8bad5718b3bc6eee9d3ae5dccc2c/chrome/content/zotero/xpcom/data/item.js#L4506-L4510
    expect(
      created(createRequest("users/0", draft({ type }), TOKEN)),
    ).not.toHaveProperty("annotationText");
  },
);

it("names the group library in the route a group Attachment's create takes", () => {
  expect(createRequest("groups/12345", draft(), TOKEN).path).toBe(
    "/api/groups/12345/items",
  );
});

it("mints a fresh 32-character token for every create", () => {
  const tokens = [newWriteToken(), newWriteToken()];

  expect(tokens.every((token) => /^[0-9a-f]{32}$/.test(token))).toBe(true);
  expect(new Set(tokens).size).toBe(2);
});

it("measures the stored position against Zotero's own limit", () => {
  const long = {
    pageIndex: 0,
    rects: Array.from({ length: 4000 }, () => [1.111, 2.222, 3.333, 4.444]),
  };

  expect(writePosition(long).length).toBeGreaterThan(MAX_POSITION_LENGTH);
  expect(writePosition(draft().position).length).toBeLessThan(
    MAX_POSITION_LENGTH,
  );
});
