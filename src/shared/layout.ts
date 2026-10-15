/** Allowed range of the rich view's text size, as a multiple of the default. */
export const MIN_FONT_SCALE = 0.6;
export const MAX_FONT_SCALE = 2.5;

export function clampFontScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Math.round(scale * 100) / 100));
}
