// Generated delimiter provenance, mapped through edits and document history.
import { invertedEffects } from "@codemirror/commands";
import { MapMode, StateEffect, StateField } from "@codemirror/state";
import type { ChangeDesc, EditorState, Text } from "@codemirror/state";

export interface GeneratedPair {
  from: number;
  open: string;
  closeFrom: number;
  close: string;
  /** Position of the generated space before the closer, while it survives. */
  padding?: number;
}

function mapPair(
  pair: GeneratedPair,
  changes: ChangeDesc,
): GeneratedPair | undefined {
  const from = changes.mapPos(pair.from, 1, MapMode.TrackAfter);
  const closeFrom = changes.mapPos(pair.closeFrom, 1, MapMode.TrackAfter);
  if (from === null || closeFrom === null) return undefined;
  const padding =
    pair.padding === undefined
      ? null
      : changes.mapPos(pair.padding, 1, MapMode.TrackAfter);
  return { ...pair, from, closeFrom, padding: padding ?? undefined };
}

export const addPair = StateEffect.define<GeneratedPair>({ map: mapPair });
export const restorePairs = StateEffect.define<readonly GeneratedPair[]>({
  map: (pairs, changes) =>
    pairs.flatMap((pair) => mapPair(pair, changes) ?? []),
});

function valid(pair: GeneratedPair, doc: Text): boolean {
  return (
    pair.from >= 0 &&
    pair.closeFrom >= pair.from + pair.open.length &&
    pair.closeFrom + pair.close.length <= doc.length &&
    doc.sliceString(pair.from, pair.from + pair.open.length) === pair.open &&
    doc.sliceString(pair.closeFrom, pair.closeFrom + pair.close.length) ===
      pair.close
  );
}

export const pairingState = StateField.define<readonly GeneratedPair[]>({
  create: () => [],
  update(pairs, transaction) {
    let next = pairs.flatMap(
      (pair) => mapPair(pair, transaction.changes) ?? [],
    );
    for (const effect of transaction.effects) {
      if (effect.is(restorePairs)) next = [...effect.value];
      if (effect.is(addPair)) next.push(effect.value);
    }
    return next
      .filter((pair) => valid(pair, transaction.newDoc))
      .map((pair) =>
        pair.padding !== undefined &&
        (pair.padding + 1 !== pair.closeFrom ||
          transaction.newDoc.sliceString(pair.padding, pair.closeFrom) !== " ")
          ? { ...pair, padding: undefined }
          : pair,
      );
  },
});

/** History stores provenance with the text edit that produced it. */
export const pairingHistory = invertedEffects.of((transaction) =>
  transaction.docChanged
    ? [restorePairs.of(transaction.startState.field(pairingState))]
    : [],
);

export function offsetPair(pair: GeneratedPair, offset: number): GeneratedPair {
  return {
    ...pair,
    from: pair.from + offset,
    closeFrom: pair.closeFrom + offset,
    padding: pair.padding === undefined ? undefined : pair.padding + offset,
  };
}

/** Project master provenance into a newly mounted or refreshed slice. */
export function slicePairs(
  state: EditorState,
  range: { from: number; to: number },
): readonly GeneratedPair[] {
  return (state.field(pairingState, false) ?? [])
    .filter(
      (pair) =>
        pair.from >= range.from &&
        pair.closeFrom + pair.close.length <= range.to,
    )
    .map((pair) => offsetPair(pair, -range.from));
}

export const expressionBrackets: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
};
