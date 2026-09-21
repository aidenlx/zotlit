// The bytes, display type, and durable filename are one format contract.

export type ExcerptFormat = "png" | "webp";

export interface ExcerptImageMetadata {
  format: ExcerptFormat;
  mimeType: `image/${ExcerptFormat}`;
  extension: ExcerptFormat;
  width?: number;
  height?: number;
}

export interface ExcerptImagePayload extends ExcerptImageMetadata {
  bytes: Uint8Array;
}

export function metadataForFormat(
  format: ExcerptFormat,
  dimensions?: Pick<ExcerptImageMetadata, "width" | "height">,
): ExcerptImageMetadata {
  const { width, height } = dimensions ?? {};
  return {
    format,
    mimeType: `image/${format}`,
    extension: format,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

/**
 * Old cache records predate the format fields and were PNG-only. Keep them
 * readable as PNG while requiring all new records to carry matching metadata.
 */
export function normalizeExcerptPayload(
  payload: { bytes: Uint8Array } & Partial<ExcerptImageMetadata>,
): ExcerptImagePayload {
  if (!(payload.bytes instanceof Uint8Array))
    throw new Error("Excerpt image bytes are not a Uint8Array");
  const format = payload.format ?? "png";
  if (format !== "png" && format !== "webp")
    throw new Error("Excerpt image format is unsupported");
  const metadata = metadataForFormat(format, payload);
  if (payload.mimeType !== undefined && payload.mimeType !== metadata.mimeType)
    throw new Error("Excerpt image MIME type does not match its format");
  if (
    payload.extension !== undefined &&
    payload.extension !== metadata.extension
  )
    throw new Error("Excerpt image extension does not match its format");
  return { ...metadata, bytes: payload.bytes };
}
