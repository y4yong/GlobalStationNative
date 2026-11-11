import { getEpisodeNavigation } from '../src/data/episodeNavigation';

const episodes = [
  { id: 'episode-1', title: 'The Beginning' },
  { id: 'episode-2', title: 'The Secret' },
  { id: 'episode-3', title: 'The Reveal' },
];

test('offers episode 2 while watching episode 1', () => {
  expect(getEpisodeNavigation(episodes, 'episode-1')).toEqual({
    current: episodes[0],
    currentIndex: 0,
    next: episodes[1],
  });
});

test('does not offer a next episode after the finale', () => {
  expect(getEpisodeNavigation(episodes, 'episode-3')).toEqual({
    current: episodes[2],
    currentIndex: 2,
    next: null,
  });
});

test('falls back to the first episode when the current episode is missing', () => {
  expect(getEpisodeNavigation(episodes, null)).toEqual({
    current: episodes[0],
    currentIndex: 0,
    next: episodes[1],
  });
});
