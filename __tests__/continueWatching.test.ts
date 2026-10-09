import { toContinueWatchingProgress } from '../src/data/watchHistory';

describe('continue watching progress', () => {
  it('calculates resume progress and remaining time from watched seconds', () => {
    const result = toContinueWatchingProgress(90, 180);

    expect(result.progress).toBeCloseTo(0.5, 5);
    expect(result.resumeAtSeconds).toBe(90);
    expect(result.timeLeft).toMatch(/1 min left|90 sec left|2 min left/);
  });
});
