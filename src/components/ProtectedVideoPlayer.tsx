import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';
import { authorizePlayback } from '../api/client';

interface ProtectedVideoPlayerProps {
  episodeId: string;
  paused: boolean;
}

export function ProtectedVideoPlayer({ episodeId, paused }: ProtectedVideoPlayerProps) {
  const [stream, setStream] = useState<Awaited<ReturnType<typeof authorizePlayback>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStream(null);
    setError(null);
    authorizePlayback(episodeId).then((response) => active && setStream(response)).catch((requestError) => active && setError(requestError instanceof Error ? requestError.message : 'Unable to authorize this stream.'));
    return () => { active = false; };
  }, [episodeId]);

  if (error) return <View style={styles.message}><Text style={styles.error}>{error}</Text></View>;
  if (!stream) return <View style={styles.message}><ActivityIndicator color="#22d3ee" /><Text style={styles.loading}>Authorizing stream...</Text></View>;

  return <Video source={{ uri: stream.manifestUrl }} paused={paused} controls resizeMode="contain" style={StyleSheet.absoluteFill} onError={() => setError('Playback failed. Check the media URL and try again.')} />;
}

const styles = StyleSheet.create({
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050a12' },
  loading: { color: '#94a3b8', marginTop: 8 },
  error: { color: '#fca5a5' },
});
