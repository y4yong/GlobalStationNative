import { isShortEpisodeDuration } from '../src/data/episodeDuration';

describe('short episode duration', () => {
  it('accepts inclusive 2–5 minute durations', () => {
    expect(isShortEpisodeDuration(120)).toBe(true);
    expect(isShortEpisodeDuration(300)).toBe(true);
  });

  it('rejects durations outside the range and non-integer values', () => {
    expect(isShortEpisodeDuration(119)).toBe(false);
    expect(isShortEpisodeDuration(301)).toBe(false);
    expect(isShortEpisodeDuration(120.5)).toBe(false);
    expect(isShortEpisodeDuration(Number.NaN)).toBe(false);
  });
});
