// Normalize row placement; each case checks completeness and limits separately.
export function resultRows(envelope) {
  if (Array.isArray(envelope?.rows)) return envelope.rows;
  if (Array.isArray(envelope?.groups))
    return envelope.groups.flatMap((group) => group.rows ?? []);
  return undefined;
}
