import { getDueAdBreak } from '../src/core/playback/adBreakSchedule';

test('schedules one ad at the midpoint and one near the end', () => {
  const played = new Set<'mid-roll' | 'late-roll'>();

  expect(getDueAdBreak(49, 100, played)).toBeNull();
  expect(getDueAdBreak(50, 100, played)).toBe('mid-roll');
  played.add('mid-roll');
  expect(getDueAdBreak(50, 100, played)).toBeNull();
  expect(getDueAdBreak(85, 100, played)).toBe('late-roll');
  played.add('late-roll');
  expect(getDueAdBreak(100, 100, played)).toBeNull();
});

test('does not schedule an ad for invalid playback timing', () => {
  const played = new Set<'mid-roll' | 'late-roll'>();

  expect(getDueAdBreak(10, 0, played)).toBeNull();
  expect(getDueAdBreak(Number.NaN, 100, played)).toBeNull();
  expect(getDueAdBreak(10, Number.POSITIVE_INFINITY, played)).toBeNull();
});
