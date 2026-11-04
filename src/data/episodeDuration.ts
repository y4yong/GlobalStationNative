export const MIN_SHORT_EPISODE_SECONDS = 2 * 60;
export const MAX_SHORT_EPISODE_SECONDS = 5 * 60;

export function isShortEpisodeDuration(seconds: number): boolean {
  return Number.isSafeInteger(seconds)
    && seconds >= MIN_SHORT_EPISODE_SECONDS
    && seconds <= MAX_SHORT_EPISODE_SECONDS;
}
