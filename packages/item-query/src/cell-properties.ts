import type { QueryDataset } from "./dataset";
import type { ValueShape } from "./fields";

/**
 * The Projection Paths of a Query Dataset that give one cell of a table each:
 * every scalar and every list of scalars, below the records and objects the
 * dataset projects, in the order of its fields. A Query View lists them as its
 * properties.
 */
export function cellProperties(dataset: QueryDataset): string[] {
  const paths = new Set<string>();
  const walk = (path: string, shape: ValueShape): void => {
    switch (shape.kind) {
      case "scalar":
        paths.add(path);
        return;
      case "list":
        if (shape.element.kind === "scalar") paths.add(path);
        return;
      case "object":
        for (const [key, child] of Object.entries(shape.keys))
          walk(`${path}.${key}`, child);
        return;
      case "record": {
        const vocabulary = shape.vocabulary();
        for (const name of vocabulary.projectionFields)
          walk(`${path}.${name}`, vocabulary.field(name)!.shape);
        return;
      }
      case "json":
      case "custom-fields":
        return;
    }
  };
  for (const name of dataset.names) {
    const definition = dataset.definition(name);
    if (definition) walk(name, definition.shape);
  }
  return [...paths];
}
