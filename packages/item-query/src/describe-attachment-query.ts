import {
  describeDatasetVocabulary,
  describeQuery,
} from "./describe-item-query";
import { ATTACHMENTS } from "./query-attachments";

/** Source-independent Attachment vocabulary; generated only at build time. */
export function describeAttachmentQueryVocabulary() {
  return {
    ...describeDatasetVocabulary(ATTACHMENTS),
    defaults: {
      fields: [...ATTACHMENTS.defaultFields],
      sort: [...ATTACHMENTS.defaultSort],
      limit: null,
    },
  };
}

export const describeAttachmentQuery = () => describeQuery(ATTACHMENTS, {});
