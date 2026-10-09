export interface ContinueWatchingProgress {
  progress: number;
  resumeAtSeconds: number;
  timeLeft: string;
}

export function toContinueWatchingProgress(watchSeconds: number, durationSeconds: number): ContinueWatchingProgress {
  const safeDuration = Math.max(0, Number(durationSeconds) || 0);
  const safeWatch = Math.max(0, Math.min(Number(watchSeconds) || 0, safeDuration));
  const remainingSeconds = Math.max(0, safeDuration - safeWatch);
  const progress = safeDuration > 0 ? safeWatch / safeDuration : 0;

  const timeLeft = remainingSeconds <= 0
    ? 'Finished'
    : remainingSeconds < 60
      ? `${Math.max(1, Math.ceil(remainingSeconds))} sec left`
      : `${Math.max(1, Math.ceil(remainingSeconds / 60))} min left`;

  return {
    progress,
    resumeAtSeconds: safeWatch,
    timeLeft,
  };
}
