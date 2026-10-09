/** Build-only access to the registry-derived Query Schema catalog. */
import { describeAnnotationQueryVocabulary } from "./describe-annotation-query";
import { describeItemQueryVocabulary } from "./describe-item-query";

export {
  describeItemQuery,
  describeItemQueryVocabulary,
  describeQuery,
} from "./describe-item-query";
export {
  describeAnnotationQuery,
  describeAnnotationQueryVocabulary,
} from "./describe-annotation-query";

/** One static catalog per plugin version, with shared language definitions. */
export function describeQueryVocabulary() {
  const { functions, methods, properties, types, ...items } =
    describeItemQueryVocabulary();
  const {
    functions: _functions,
    methods: _methods,
    properties: _properties,
    types: _types,
    ...annotations
  } = describeAnnotationQueryVocabulary();
  return {
    datasets: { items, annotations },
    functions,
    methods,
    properties,
    types,
  };
}
