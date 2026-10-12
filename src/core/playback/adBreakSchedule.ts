export type PlaybackAdBreak = 'mid-roll' | 'late-roll';

export function getDueAdBreak(
  currentTime: number,
  duration: number,
  playedBreaks: ReadonlySet<PlaybackAdBreak>,
): PlaybackAdBreak | null {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return null;
  if (currentTime >= duration * 0.5 && !playedBreaks.has('mid-roll')) return 'mid-roll';
  if (currentTime >= duration * 0.85 && !playedBreaks.has('late-roll')) return 'late-roll';
  return null;
}
