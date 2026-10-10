import { expect, it } from "vitest";

import type { FieldDefinition } from "./fields";
import { matches } from "./filter-evaluate";
import { planFilter } from "./filter-plan";
import { liftParentRecord, parentFieldSubject } from "./parent-records";
import { planPath, readPath } from "./projection";
import { definitionFilter } from "./record-field";
import type { RecordVocabulary } from "./record-field";

type Row = { title: string; secret: string };
type Needs = { fields?: readonly string[] };
const fields = new Map<string, FieldDefinition<Row, Needs>>(
  ["title", "secret"].map((name) => [
    name,
    {
      shape: { kind: "scalar", type: "string" },
      needs: () => ({ fields: [name] }),
      read: (row) => row[name as keyof Row],
      sortKey: (row) => row[name as keyof Row],
      filter: { type: "string", read: (row) => row[name as keyof Row] },
    },
  ]),
);
fields.set("indexedKey", {
  shape: { kind: "scalar", type: "string" },
  needs: () => ({}),
  read: () => "ITEM0001",
});
const vocabulary: RecordVocabulary<Row, Needs> = {
  id: "items",
  summary: ["title"],
  projectionFields: ["title", "secret"],
  field: (name) => fields.get(name),
  filter: {
    field: (name) => definitionFilter(fields.get(name)),
    custom: (name) => ({
      needs: { fields: [name] },
      value: { type: "string", read: (row) => row.secret },
    }),
  },
};
const parent = liftParentRecord({
  name: "item",
  vocabulary: () => vocabulary,
  read: (row: { parent: Row }) => row.parent,
  needs: (item: readonly Needs[]) => ({ item }),
  sortable: ["title"],
  listed: ["title"],
  syntax: "fields",
});

it("projects a Parent Record field and carries its needs", () => {
  const path = planPath("item.title", parent.resolvePath);
  expect(path).toMatchObject({ needs: { item: [{ fields: ["title"] }] } });
  if (!("field" in path)) throw new Error("Expected a Projection Path");
  expect(
    readPath(path, { parent: { title: "Research", secret: "Draft" } }),
  ).toBe("Research");
});

it("filters and sorts only the declared Sortable Fields, with parent needs", () => {
  const row = { parent: { title: "Research", secret: "Draft" } };
  const filter = parent.filter("item.secret");
  expect(filter?.filterable && filter.value.read(row)).toBe("Draft");
  expect(filter?.filterable && filter.needs).toEqual({
    item: [{ fields: ["secret"] }],
  });
  expect(parent.sortable("item.title")?.needs).toEqual({
    item: [{ fields: ["title"] }],
  });
  expect(parent.sortable("item.secret")).toBeUndefined();
  expect(parent.names()).toEqual(["item", "item.title"]);
  expect(parent.custom("review.status").needs).toEqual({
    item: [{ fields: ["review.status"] }],
  });
  expect(parent.custom("review.status").value.read(row)).toBe("Draft");
  expect(parent.field("item.missing")).toBeUndefined();
  expect(parent.filter("item.missing")).toBeUndefined();
});

it("lowers only leaves prefixed by this Parent Record", () => {
  const registry = {
    prefix: parent.name,
    field: parent.filter,
    custom: parent.custom,
  };
  const planned = planFilter('item.title == "Research"', registry);
  if (!("root" in planned)) throw new Error("Expected a Filter Expression");
  expect(parent.candidateLeaf(planned.root)).toMatchObject({
    kind: "binary",
    left: { kind: "field", name: "title" },
    right: { kind: "literal", value: "Research" },
  });
  expect(planned.root).toMatchObject({ left: { name: "item.title" } });
  const method = planFilter('item.title.contains("Research")', registry);
  if (!("root" in method)) throw new Error("Expected a Filter Expression");
  expect(parent.candidateLeaf(method.root)).toMatchObject({
    kind: "method",
    subject: { kind: "field", name: "title" },
  });
  const own = planFilter('title == "Research"', vocabulary.filter);
  if (!("root" in own)) throw new Error("Expected a Filter Expression");
  expect(parent.candidateLeaf(own.root)).toBeNull();
  expect(parent.indexedKeyTarget("item.indexedKey")).toBe("item");
  expect(parent.indexedKeyTarget("indexedKey")).toBeUndefined();
  expect(parent.indexedKeyTarget("item.key")).toBeUndefined();
});

it("reaches attachment.item.title through the parent's own declaration", () => {
  const attachmentVocabulary: RecordVocabulary<
    { parent: Row },
    { item: readonly Needs[] }
  > = {
    id: "attachments",
    summary: ["item"],
    projectionFields: ["item"],
    parents: [parent],
    field: (name) =>
      name === "indexedKey"
        ? {
            shape: { kind: "scalar", type: "string" },
            needs: () => ({ item: [] }),
            read: () => "FILE0001",
          }
        : parent.field(name),
    filter: { field: parent.filter, custom: parent.custom },
  };
  const attachment = liftParentRecord({
    name: "attachment",
    vocabulary: () => attachmentVocabulary,
    read: (row: { attachment: { parent: Row } }) => row.attachment,
    needs: (attachment: readonly { item: readonly Needs[] }[]) => ({
      attachment,
    }),
    sortable: [],
    listed: ["item"],
    syntax: "record",
  });
  const path = planPath("attachment.item.title", attachment.resolvePath);
  if (!("field" in path)) throw new Error("Expected a Projection Path");
  expect(
    readPath(path, {
      attachment: { parent: { title: "Nested", secret: "Draft" } },
    }),
  ).toBe("Nested");
  expect(path.needs).toEqual({
    attachment: [{ item: [{ fields: ["title"] }] }],
  });
  expect(attachment.field("attachment.item.title")?.needs([])).toEqual(
    path.needs,
  );
  expect(attachment.owns("attachment.item.title", "title")).toBe(true);
  expect(attachment.owns("attachment.missing.title", "title")).toBe(false);
  expect(attachment.sortable("attachment.item.title")).toBeUndefined();
  const filter = planFilter('attachment.item.title == "Nested"', {
    field: attachment.filter,
    custom: attachment.custom,
  });
  if (!("root" in filter)) throw new Error("Expected a Filter Expression");
  const clock = {
    now: Temporal.Instant.fromEpochMilliseconds(0),
    timeZone: "UTC",
  };
  expect(
    matches(
      filter.root,
      { attachment: { parent: { title: "Nested", secret: "Draft" } } },
      clock,
    ),
  ).toBe(true);
  expect(
    matches(
      filter.root,
      { attachment: { parent: { title: "Other", secret: "Draft" } } },
      clock,
    ),
  ).toBe(false);
  if (filter.root.kind !== "binary") throw new Error("Expected a comparison");
  expect(
    parentFieldSubject(filter.root.left, "title", [
      vocabulary,
      attachmentVocabulary,
    ]),
  ).toBe(true);
  expect(
    parentFieldSubject(filter.root.left, "secret", [
      vocabulary,
      attachmentVocabulary,
    ]),
  ).toBe(false);

  expect(
    planPath("attachment.item.missing", attachment.resolvePath),
  ).toMatchObject({
    kind: "unknown",
    role: "projection-path",
    name: "attachment.item.missing",
  });
});

it("uses the listed fields for a record while retaining unlisted projection paths", () => {
  const record = liftParentRecord({
    name: "attachment",
    vocabulary: () => vocabulary,
    read: (row: { parent: Row }) => row.parent,
    needs: (item: readonly Needs[]) => ({ item }),
    sortable: [],
    listed: ["title"],
    syntax: "record",
  });
  const definition = record.field("attachment")!;
  expect(
    definition.shape.kind === "record" &&
      definition.shape.vocabulary().projectionFields,
  ).toEqual(["title"]);
  const path = planPath("attachment.secret", record.resolvePath);
  if (!("field" in path)) throw new Error("Expected a Projection Path");
  expect(
    readPath(path, { parent: { title: "Research", secret: "Draft" } }),
  ).toBe("Draft");
});

it("reads and sorts a Parent Record identity from the scan row", () => {
  const identity = liftParentRecord({
    name: "attachment",
    vocabulary: () => vocabulary,
    read: (row: { key: string; parent?: Row }) => row.parent,
    identity: (row) => ({ scan: { key: row.key }, groupID: 42 }),
    needs: (item: readonly Needs[]) => ({ item }),
    sortable: ["indexedKey", "key"],
    listed: [],
    syntax: "record",
  });
  const row = { key: "ABCDEFGH" };
  const clock = {
    now: Temporal.Instant.fromEpochMilliseconds(0),
    timeZone: "UTC",
  };
  const filter = identity.filter("attachment.indexedKey");
  expect(filter?.filterable && filter.value.read(row)).toBe("ABCDEFGHg42");
  expect(filter?.filterable && filter.needs).toEqual({});
  expect(identity.sortable("attachment.indexedKey")?.key(row, clock)).toBe(
    "ABCDEFGHg42",
  );
  expect(identity.sortable("attachment.key")?.key(row, clock)).toBe("ABCDEFGH");
  expect(identity.sortable("attachment.key")?.needs).toEqual({});
  expect(
    parent
      .sortable("item.title")
      ?.key({ parent: { title: "Research", secret: "Draft" } }, clock),
  ).toBe("Research");
});
