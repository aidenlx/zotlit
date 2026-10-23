// Profile sources for tests that render Annotations into the note body.

import { DEFAULT_PROFILE_SOURCE } from "./default-profile";

const QUERY_BLOCK_START = "## Annotations\n\n```zotquery\n";
const FENCE_END = "```\n";

/**
 * The default Profile with a static annotation listing in place of its Query
 * Block: each Annotation of the item renders through the annotation template.
 * The listing sits in a Managed Block, so an update refills it.
 */
export const ANNOTATION_LIST_PROFILE_SOURCE = ((): string => {
  const start = DEFAULT_PROFILE_SOURCE.indexOf(QUERY_BLOCK_START);
  if (start < 0) throw new Error("The default Profile has no Query Block");
  const end =
    DEFAULT_PROFILE_SOURCE.indexOf(
      FENCE_END,
      start + QUERY_BLOCK_START.length,
    ) + FENCE_END.length;
  return `${DEFAULT_PROFILE_SOURCE.slice(0, start)}{% managed %}
{% if zt.annotations.size > 0 %}
## Annotations

{% for annotation in zt.annotations %}
{% render_annotation annotation %}
{% endfor %}
{% endif %}
{% endmanaged %}
${DEFAULT_PROFILE_SOURCE.slice(end)}`;
})();
