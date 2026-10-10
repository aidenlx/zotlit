import { ANNOTATION_POSITION_SHAPES } from "./annotation-position";
import {
  describeDatasetVocabulary,
  describeQuery,
} from "./describe-item-query";
import { ANNOTATIONS } from "./query-annotations";

/** Source-independent Annotation vocabulary; generated only at build time. */
export function describeAnnotationQueryVocabulary() {
  return {
    ...describeDatasetVocabulary(ANNOTATIONS),
    positionKinds: ANNOTATION_POSITION_SHAPES,
  };
}

export const describeAnnotationQuery = () =>
  describeQuery(ANNOTATIONS, {
    positionKinds: ANNOTATION_POSITION_SHAPES,
  });
