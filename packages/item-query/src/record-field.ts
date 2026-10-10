import type { FieldDefinition, FilterField, ValueShape } from "./fields";
import type { FilterRegistry } from "./filter-plan";
import type { FilterValue } from "./filter-values";
import { readSegments } from "./projection";
import type { PathSegment } from "./projection-path";
import type { ProjectionValue } from "./request";

/** A record uses its dataset's vocabulary at every depth. Callbacks allow cycles. */
export interface RecordVocabulary<Row, Needs> {
  readonly id: "items" | "attachments" | "annotations";
  readonly summary: readonly string[];
  /** Representative fields listed below this record in the Query Schema. */
  readonly projectionFields: readonly string[];
  readonly field: (name: string) => FieldDefinition<Row, Needs> | undefined;
  readonly filter: FilterRegistry<Row, Needs>;
}

/** Static navigation carries element needs back to the root of the request. */
export interface FilterNavigation<Needs> {
  readonly dataset?: RecordVocabulary<never, never>["id"];
  readonly equalityField?: FilterRegistry<never, Needs>["equalityField"];
  readonly member?: (
    name: string,
  ) => FilterField<FilterValue, Needs> | undefined;
  readonly element?: FilterNavigation<Needs>;
}

export function mapNavigation<A, B>(
  navigation: FilterNavigation<A> | undefined,
  wrap: (needs: A) => B,
): FilterNavigation<B> | undefined {
  if (!navigation) return undefined;
  return {
    dataset: navigation.dataset,
    equalityField: navigation.equalityField,
    ...(navigation.element && {
      element: mapNavigation(navigation.element, wrap),
    }),
    ...(navigation.member && {
      member: (name: string) => {
        const field = navigation.member!(name);
        return field?.filterable
          ? {
              ...field,
              needs: wrap(field.needs),
              navigation: mapNavigation(field.navigation, wrap),
            }
          : field;
      },
    }),
  };
}

/** A single parent record or a Relation List of records. */
export function recordField<Item, Needs, Row, ChildNeeds>(options: {
  readonly vocabulary: () => RecordVocabulary<Row, ChildNeeds>;
  readonly rows: (item: Item) => readonly Row[];
  readonly list: boolean;
  readonly needs: (needs: readonly ChildNeeds[]) => Needs;
}): FieldDefinition<Item, Needs> {
  const { vocabulary, rows, list, needs } = options;
  const filterField = (
    name: string,
  ): FilterField<Row, ChildNeeds> | undefined => {
    const registry = vocabulary().filter;
    const field = registry.field(name);
    if (field) return field;
    if (registry.prefix && !name.startsWith(`${registry.prefix}.`))
      return undefined;
    const custom = registry.prefix
      ? name.slice(registry.prefix.length + 1)
      : name;
    return {
      filterable: true,
      ...registry.custom(custom),
      customField: custom,
    };
  };
  const shape: ValueShape = {
    kind: "record",
    vocabulary: () => vocabulary(),
  };
  const record = (row: Row): FilterValue => ({
    type: "record",
    identity: `${vocabulary().id}:${vocabulary().field("indexedKey")!.read(row) as string}`,
    read: (name) => {
      const field = filterField(name);
      return field?.filterable ? field.value.read(row) : null;
    },
  });
  const navigation: FilterNavigation<Needs> = {
    get dataset() {
      return vocabulary().id;
    },
    equalityField: (name, literal) =>
      vocabulary().filter.equalityField?.(name, literal) ?? name,
    member: (name) => {
      const field = filterField(name);
      return field?.filterable
        ? {
            filterable: true,
            needs: needs([field.needs]),
            ...(field.customField && { customField: field.customField }),
            navigation: mapNavigation(field.navigation, (value) =>
              needs([value]),
            ),
            value: {
              type: field.value.type,
              read: (value) =>
                value !== null &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                "type" in value &&
                value.type === "record"
                  ? value.read(name)
                  : null,
            },
          }
        : field;
    },
  };
  const childNeeds = (path: readonly PathSegment[]): ChildNeeds[] => {
    const [name, ...rest] = path;
    if (name === undefined)
      return vocabulary().summary.flatMap((key) => childNeeds([key]));
    const field =
      typeof name === "string" ? vocabulary().field(name) : undefined;
    return field ? [field.needs(rest)] : [];
  };
  const project = (row: Row, path: readonly PathSegment[]): ProjectionValue => {
    const [name, ...rest] = path;
    if (name === undefined)
      return Object.fromEntries(
        vocabulary().summary.map((key) => [key, project(row, [key])]),
      );
    const field =
      typeof name === "string" ? vocabulary().field(name) : undefined;
    if (!field) return null;
    return field.project
      ? field.project(row, rest)
      : readSegments(field.read(row), rest);
  };
  const projectRows = (
    item: Item,
    path: readonly PathSegment[],
  ): ProjectionValue => {
    const values = rows(item);
    if (!list) return values[0] === undefined ? null : project(values[0], path);
    const [first, ...rest] = path;
    if (first === "length") return values.length;
    if (typeof first === "number")
      return values[first] === undefined ? null : project(values[first], rest);
    return values.map((row) => project(row, first === undefined ? [] : rest));
  };
  return {
    shape: list ? { kind: "list", element: shape } : shape,
    relation: vocabulary,
    needs: (path) =>
      needs(
        list
          ? path[0] === "length"
            ? []
            : childNeeds(path[0] === undefined ? [] : path.slice(1))
          : childNeeds(path),
      ),
    read: (item) => projectRows(item, []),
    project: projectRows,
    filterNeeds: needs([]),
    navigation: list ? { element: navigation } : navigation,
    filter: {
      type: list ? "list" : "record",
      read: (item) =>
        list
          ? rows(item).map(record)
          : rows(item)[0] === undefined
            ? null
            : record(rows(item)[0]!),
    },
  };
}

export function definitionFilter<Item, Needs>(
  definition: FieldDefinition<Item, Needs> | undefined,
): FilterField<Item, Needs> | undefined {
  return definition?.filter
    ? {
        filterable: true,
        value: definition.filter,
        needs: definition.filterNeeds ?? definition.needs([]),
        navigation: definition.navigation,
      }
    : definition
      ? { filterable: false }
      : undefined;
}
