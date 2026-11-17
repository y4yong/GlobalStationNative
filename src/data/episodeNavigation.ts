export function getEpisodeNavigation<T extends { id: string }>(
  episodes: readonly T[],
  currentEpisodeId: string | null,
) {
  const foundIndex = episodes.findIndex((episode) => episode.id === currentEpisodeId);
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  return {
    current: episodes[currentIndex] ?? null,
    currentIndex,
    next: episodes[currentIndex + 1] ?? null,
  };
}
