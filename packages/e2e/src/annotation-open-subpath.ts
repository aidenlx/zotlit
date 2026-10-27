// What an open that lands on one Annotation hands Obsidian's PDF view: the
// subpath of its ephemeral state, read as the keys the reader acts on rather
// than as one spelling of them.

/** The keys an open at Annotation `annotation` of Attachment `attachment` carries. */
export function annotationOpenKeys({
  page,
  annotation,
  attachment,
}: {
  page: number;
  annotation: string;
  attachment: string;
}): Record<string, string> {
  return {
    page: String(page),
    "zt-annotation": annotation,
    "zt-attachment": attachment,
  };
}
