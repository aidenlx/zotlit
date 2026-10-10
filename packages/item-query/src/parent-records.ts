import { fieldRoot } from "./dataset";
import type { SortableField } from "./dataset";
import type { FieldDefinition, FilterField } from "./fields";
import type { FilterNode, FilterRegistry } from "./filter-plan";
import { indexedKeyField, keyField } from "./key-fields";
import type { PathResolver } from "./projection";
import { definitionFilter, mapNavigation, recordField } from "./record-field";
import type { RecordVocabulary } from "./record-field";

/** The vocabulary and access to one Parent Record, with its contract lists. */
export function liftParentRecord<Item, Needs, Row, ParentNeeds>(options: {
  readonly name: string;
  readonly vocabulary: () => RecordVocabulary<Row, ParentNeeds>;
  readonly read: (item: Item) => Row | undefined;
  readonly needs: (needs: readonly ParentNeeds[]) => Needs;
  readonly sortable: readonly string[];
  /** Parent fields whose lowering is a superset for this child Query Dataset. */
  readonly candidates: "all" | readonly string[];
  readonly listed: readonly string[] | (() => readonly string[]);
  /** Fields retain their dotted roots in diagnostics; records use member navigation. */
  readonly syntax: "fields" | "record";
  /** Identity available on the scan row, before the Parent Record loads. */
  readonly identity?: (item: Item) => {
    readonly scan: { readonly key: string };
    readonly groupID: number | null;
  };
}) {
  const { name, vocabulary, read, needs, sortable, syntax } = options;
  const listed = () =>
    typeof options.listed === "function" ? options.listed() : options.listed;
  const prefix = `${name}.`;
  const strip = (path: string) =>
    path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
  const wrap = (need: ParentNeeds) => needs([need]);
  const record = () =>
    recordField({
      vocabulary: () => ({
        ...vocabulary(),
        projectionFields:
          syntax === "record" ? listed() : vocabulary().projectionFields,
      }),
      rows: (item: Item) => {
        const row = read(item);
        return row === undefined ? [] : [row];
      },
      list: false,
      needs,
    });
  const field = (path: string): FieldDefinition<Item, Needs> | undefined => {
    if (path === name) return record();
    const key = strip(path);
    const parent = key === undefined ? undefined : vocabulary().field(key);
    if (!parent) return undefined;
    return {
      ...parent,
      needs: (rest) => wrap(parent.needs(rest)),
      filterNeeds: wrap(parent.filterNeeds ?? parent.needs([])),
      navigation: mapNavigation(parent.navigation, wrap),
      project: parent.project
        ? (item, rest) => {
            const row = read(item);
            return row === undefined ? null : parent.project!(row, rest);
          }
        : undefined,
      read: (item) => {
        const row = read(item);
        return row === undefined ? null : parent.read(row);
      },
      sortKey:
        parent.sortKey && sortable.includes(key!)
          ? (item, clock) => {
              const row = read(item);
              return row === undefined ? null : parent.sortKey!(row, clock);
            }
          : undefined,
      filter: parent.filter
        ? {
            ...parent.filter,
            read: (item) => {
              const row = read(item);
              return row === undefined ? null : parent.filter!.read(row);
            },
          }
        : undefined,
    };
  };
  const resolvePath: PathResolver<Item, Needs> = (segments) => {
    const [root, next] = segments;
    if (root !== name) return undefined;
    if (syntax === "fields" && typeof next === "string") {
      const definition = field(prefix + next);
      if (definition) return { field: definition, rest: segments.slice(2) };
    }
    return { field: record(), rest: segments.slice(1) };
  };
  const filter = (path: string): FilterField<Item, Needs> | undefined => {
    if (path === name) return definitionFilter(record());
    const key = strip(path);
    if (key === "indexedKey" && options.identity)
      return {
        filterable: true,
        needs: {} as Needs,
        value: {
          type: "string",
          read: (item) =>
            indexedKeyField.read(options.identity!(item)) as string,
        },
      };
    // Record members keep the member navigation and Faults of their vocabulary.
    return syntax === "fields" ? definitionFilter(field(path)) : undefined;
  };
  return {
    name,
    get dataset() {
      return vocabulary().id;
    },
    prefix,
    syntax,
    field,
    definition: (path: string) =>
      syntax === "fields" || path === name ? field(path) : undefined,
    filter,
    resolvePath,
    names: () => [
      name,
      ...(syntax === "fields"
        ? listed()
        : listed().filter(
            (key) =>
              key === "indexedKey" || !vocabulary().summary.includes(key),
          )
      ).map((key) => prefix + key),
    ],
    sortFields: sortable.map((key) => prefix + key),
    sortable: (path: string): SortableField<Item, Needs> | undefined => {
      const key = strip(path);
      if (key === undefined || !sortable.includes(key)) return undefined;
      if (
        syntax === "record" &&
        options.identity &&
        ["indexedKey", "key"].includes(key)
      ) {
        const identity = key === "key" ? keyField : indexedKeyField;
        return {
          needs: {} as Needs,
          key: (item) => identity.read(options.identity!(item)) as string,
        };
      }
      const definition = field(path);
      return definition?.sortKey
        ? { needs: definition.needs([]), key: definition.sortKey }
        : undefined;
    },
    custom: (
      key: string,
    ): ReturnType<FilterRegistry<Item, Needs>["custom"]> => {
      const custom = vocabulary().filter.custom(key);
      return {
        needs: wrap(custom.needs),
        value: {
          ...custom.value,
          read: (item) => {
            const row = read(item);
            return row === undefined ? null : custom.value.read(row);
          },
        },
      };
    },
    rootName: (path: string) => {
      const key = strip(path);
      return key === undefined
        ? undefined
        : syntax === "fields"
          ? prefix + fieldRoot(key)
          : name;
    },
    indexedKeyTarget: (path: string) =>
      strip(path) === "indexedKey" ? name : undefined,
    owns: (path: string, key: string): boolean => {
      const rest = strip(path);
      return (
        rest !== undefined &&
        (rest === key ||
          (vocabulary().parents ?? []).some((parent) => parent.owns(rest, key)))
      );
    },
    /** A candidate leaf in the parent's vocabulary; evaluation still uses the original tree. */
    candidateLeaf: <Record>(
      node: FilterNode<Record>,
    ): FilterNode<never> | null => {
      let found = false;
      const member = (child: FilterNode<never>): FilterNode<never> => {
        const path = candidateMemberPath(child);
        const key = path === null ? undefined : strip(path);
        if (
          key === undefined ||
          (options.candidates !== "all" && !options.candidates.includes(key))
        )
          return child;
        const field = vocabulary().filter.field(key);
        if (!field?.filterable) return child;
        found = true;
        return { ...child, kind: "field", name: key, value: field.value };
      };
      const leaf =
        node.kind === "binary"
          ? { ...node, left: member(node.left), right: member(node.right) }
          : node.kind === "method"
            ? {
                ...node,
                subject: member(node.subject),
                args: node.args.map(member),
              }
            : node;
      return found ? leaf : null;
    },
  };
}

/** The row type is private to the parent declaration, like a Query Dataset. */
export type ParentRecord<Item = any, Needs = any> = ReturnType<
  typeof liftParentRecord<Item, Needs, any, any>
>;

/** Keep the established order of Sortable Fields in Diagnostic Reports. */
export function parentSortFields(
  own: readonly string[],
  parents: readonly ParentRecord[],
): string[] {
  const fields = parents.filter((parent) => parent.syntax === "fields");
  const identities = fields.flatMap((parent) =>
    parent.sortFields.filter((path) =>
      ["indexedKey", "key"].includes(path.slice(parent.prefix.length)),
    ),
  );
  return [
    ...own.filter((key) => ["indexedKey", "key"].includes(key)),
    ...identities,
    ...own.filter((key) => !["indexedKey", "key"].includes(key)),
    ...fields.flatMap((parent) =>
      parent.sortFields.filter((path) => !identities.includes(path)),
    ),
    ...parents
      .filter((parent) => parent.syntax === "record")
      .flatMap((parent) => parent.sortFields),
  ];
}

export function parentPathResolver<Item, Needs>(
  definition: (name: string) => FieldDefinition<Item, Needs> | undefined,
  parents: readonly ParentRecord<Item, Needs>[],
): PathResolver<Item, Needs> {
  return (segments) => {
    for (const parent of parents) {
      const path = parent.resolvePath(segments);
      if (path) return path;
    }
    const field =
      typeof segments[0] === "string" ? definition(segments[0]) : undefined;
    return field && { field, rest: segments.slice(1) };
  };
}

export function parentRootName(
  name: string,
  parents: readonly ParentRecord[],
): string {
  for (const parent of parents) {
    const root = parent.rootName(name);
    if (root) return root;
  }
  return fieldRoot(name);
}

function candidateMemberPath<Item>(node: FilterNode<Item>): string | null {
  if (node.kind === "field") return node.name;
  if (node.kind !== "property") return null;
  const path = candidateMemberPath(node.subject);
  return path === null ? null : `${path}.${node.name}`;
}

/** Recognize a field of a Parent Record at any declared depth. */
export function parentFieldSubject<Item>(
  subject: FilterNode<Item>,
  name: string,
  vocabularies: readonly RecordVocabulary<any, any>[],
): boolean {
  return subject.kind === "field"
    ? subject.name === name ||
        vocabularies.some((vocabulary) =>
          (vocabulary.parents ?? []).some((parent) =>
            parent.owns(subject.name, name),
          ),
        )
    : subject.kind === "property" &&
        subject.name === name &&
        vocabularies.some(
          (vocabulary) =>
            vocabulary.id === subject.subject.recordDataset &&
            vocabulary.field(name) !== undefined,
        );
}
