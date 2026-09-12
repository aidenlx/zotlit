/** Title opacity over the octave after native text reaches full opacity. */
export function workLabelTitleAlpha(
  scale: number,
  textFadeMultiplier: number | undefined,
  highlighted: boolean,
): number {
  if (highlighted) return 0.6;
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const fade = Number.isFinite(textFadeMultiplier) ? textFadeMultiplier! : 0;
  return Math.max(0, Math.min(1, Math.log2(scale) - fade)) * 0.6;
}
