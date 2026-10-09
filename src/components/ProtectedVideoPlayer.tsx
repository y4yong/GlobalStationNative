import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';
import { authorizePlayback, recordPlaybackProgress } from '../api/client';
import { createSessionFingerprint } from '../core/security/sessionStorage';

interface ProtectedVideoPlayerProps {
  episodeId: string;
  paused: boolean;
  startTime?: number;
  onDurationChange?: (duration: number) => void;
}

export function ProtectedVideoPlayer({ episodeId, paused, startTime = 0, onDurationChange }: ProtectedVideoPlayerProps) {
  const [stream, setStream] = useState<Awaited<ReturnType<typeof authorizePlayback>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const playbackProgress = useRef({ episodeId, sessionUid: createSessionFingerprint(), lastTime: null as number | null, pendingSeconds: 0 });

  useEffect(() => {
    const session = { episodeId, sessionUid: createSessionFingerprint(), lastTime: null as number | null, pendingSeconds: 0 };
    playbackProgress.current = session;
    return () => {
      const seconds = Math.floor(session.pendingSeconds);
      if (seconds > 0) void recordPlaybackProgress(episodeId, session.sessionUid, seconds).catch(() => undefined);
    };
  }, [episodeId]);

  function flushProgress() {
    const session = playbackProgress.current;
    const seconds = Math.floor(session.pendingSeconds);
    if (seconds < 1) return;
    session.pendingSeconds -= seconds;
    void recordPlaybackProgress(episodeId, session.sessionUid, seconds).catch(() => {
      session.pendingSeconds += seconds;
    });
  }

  function trackProgress(currentTime: number) {
    const session = playbackProgress.current;
    if (session.lastTime !== null) {
      const elapsed = currentTime - session.lastTime;
      if (elapsed > 0 && elapsed <= 10) session.pendingSeconds += elapsed;
      if (session.pendingSeconds >= 15) flushProgress();
    }
    session.lastTime = currentTime;
  }

  useEffect(() => {
    let active = true;
    setStream(null);
    setError(null);
    authorizePlayback(episodeId).then((response) => active && setStream(response)).catch((requestError) => active && setError(requestError instanceof Error ? requestError.message : 'Unable to authorize this stream.'));
    return () => { active = false; };
  }, [episodeId]);

  if (error) return <View style={styles.message}><Text style={styles.error}>{error}</Text></View>;
  if (!stream) return <View style={styles.message}><ActivityIndicator color="#22d3ee" /><Text style={styles.loading}>Authorizing stream...</Text></View>;

  if (!stream.manifestUrl || !/^https?:\/\//.test(stream.manifestUrl)) {
    return <View style={styles.message}><Text style={styles.error}>Playback failed. Check the media URL and try again.</Text></View>;
  }

  return <Video
    source={{ uri: stream.manifestUrl }}
    paused={paused}
    controls
    resizeMode="contain"
    startTime={Math.max(0, startTime)}
    style={StyleSheet.absoluteFill}
    onLoad={(event) => onDurationChange?.(event.duration ?? 0)}
    onProgress={({ currentTime }) => trackProgress(currentTime)}
    onEnd={flushProgress}
    onError={() => setError('Playback failed. Check the media URL and try again.')}
  />;
}

const styles = StyleSheet.create({
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050a12' },
  loading: { color: '#94a3b8', marginTop: 8 },
  error: { color: '#fca5a5' },
});
