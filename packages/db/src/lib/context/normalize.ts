// Shared empty-string-to-null normalization for the zt template-data mappers.

/** An empty-string field value is treated as absent in the template vocabulary. */
export function emptyToNull(value: string | null): string | null {
  return value === "" ? null : value;
}
