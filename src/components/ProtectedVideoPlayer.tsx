import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Video, { ViewType } from 'react-native-video';
import { authorizePlayback, recordPlaybackProgress } from '../api/client';
import { createSessionFingerprint } from '../core/security/sessionStorage';
import { getCurrentViewingLocation, ViewingLocation } from '../core/location/viewingLocation';
import { COLORS } from '../theme/colors';

interface ProtectedVideoPlayerProps {
  episodeId: string;
  paused: boolean;
  startTime?: number;
  onDurationChange?: (duration: number) => void;
  shareViewingLocation: boolean;
  onPlaybackProgress?: (currentTime: number, duration: number) => void;
}

export function ProtectedVideoPlayer({ episodeId, paused, startTime = 0, onDurationChange, shareViewingLocation, onPlaybackProgress }: ProtectedVideoPlayerProps) {
  const [stream, setStream] = useState<Awaited<ReturnType<typeof authorizePlayback>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const duration = useRef(0);
  const playbackProgress = useRef({
    episodeId,
    sessionUid: createSessionFingerprint(),
    lastTime: null as number | null,
    pendingSeconds: 0,
    positionSeconds: 0,
    completed: false,
    location: null as ViewingLocation | null,
  });

  const flushProgress = useCallback((completed = false, finalPosition?: number) => {
    const session = playbackProgress.current;
    const seconds = Math.min(60, Math.floor(session.pendingSeconds));
    session.completed ||= completed;
    if (seconds < 1 && !session.completed) return;
    session.pendingSeconds -= seconds;
    if (typeof finalPosition === 'number') session.positionSeconds = Math.floor(finalPosition);
    const completionForRequest = session.completed;
    recordPlaybackProgress(
      episodeId,
      session.sessionUid,
      seconds,
      session.positionSeconds,
      duration.current > 0 ? Math.floor(duration.current) : null,
      completionForRequest,
      session.location,
    ).then(() => {
      if (completionForRequest) session.completed = false;
    }).catch((reportError: unknown) => {
      session.pendingSeconds += seconds;
      session.completed ||= completionForRequest;
      console.warn('Playback analytics could not be recorded.', reportError);
    });
  }, [episodeId]);

  useEffect(() => {
    const session = {
      episodeId,
      sessionUid: createSessionFingerprint(),
      lastTime: null as number | null,
      pendingSeconds: 0,
      positionSeconds: 0,
      completed: false,
      location: null as ViewingLocation | null,
    };
    duration.current = 0;
    playbackProgress.current = session;
    return () => {
      flushProgress();
    };
  }, [episodeId, flushProgress]);

  useEffect(() => {
    if (!shareViewingLocation || paused) return;
    let active = true;
    getCurrentViewingLocation().then((location) => {
      if (active && location) playbackProgress.current.location = location;
    });
    return () => { active = false; };
  }, [episodeId, paused, shareViewingLocation]);

  function trackProgress(currentTime: number) {
    const session = playbackProgress.current;
    session.positionSeconds = Math.floor(currentTime);
    if (session.lastTime !== null) {
      const elapsed = currentTime - session.lastTime;
      if (elapsed > 0 && elapsed <= 10) session.pendingSeconds += elapsed;
      if (session.pendingSeconds >= 15 || session.completed) flushProgress();
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
  if (!stream) return <View style={styles.message}><ActivityIndicator color={COLORS.cyan} /><Text style={styles.loading}>Authorizing stream...</Text></View>;

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
    muted={false}
    volume={1}
    audioOutput="speaker"
    ignoreSilentSwitch="ignore"
    controls
    resizeMode="contain"
    viewType={ViewType.TEXTURE}
    style={StyleSheet.absoluteFill}
    onLoad={({ duration: loadedDuration }) => { duration.current = loadedDuration; onDurationChange?.(loadedDuration); }}
    onProgress={({ currentTime }) => {
      trackProgress(currentTime);
      onPlaybackProgress?.(currentTime, duration.current);
    }}
    onEnd={() => flushProgress(true, duration.current)}
    onError={() => setError('Playback failed. Check the media URL and try again.')}
  />;
}

const styles = StyleSheet.create({
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  loading: { color: COLORS.textMuted, marginTop: 8 },
  error: { color: '#f5a6a8' },
});
