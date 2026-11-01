import { expect, it } from "vitest";

import { onlyDeletesRefs } from "./push-refs.ts";

const ZERO = "0".repeat(40);
const SHA = "a".repeat(40);
const deletion = `(delete) ${ZERO} refs/heads/feat/old ${SHA}`;
const update = `refs/heads/feat/new ${SHA} refs/heads/feat/new ${ZERO}`;

it("recognizes a push that deletes one branch", () => {
  expect(onlyDeletesRefs(`${deletion}\n`)).toBe(true);
});

it("recognizes a push that deletes several branches", () => {
  expect(onlyDeletesRefs(`${deletion}\n${deletion}\n`)).toBe(true);
});

it("keeps the gate for a push that carries commits", () => {
  expect(onlyDeletesRefs(`${update}\n`)).toBe(false);
});

it("keeps the gate when a deletion travels with commits", () => {
  expect(onlyDeletesRefs(`${deletion}\n${update}\n`)).toBe(false);
});

it("keeps the gate when the push names no refs", () => {
  expect(onlyDeletesRefs("")).toBe(false);
});
