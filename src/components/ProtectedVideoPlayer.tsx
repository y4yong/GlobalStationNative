import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';
import { getStreamToken } from '../api/client';
import { UserRole } from '../data/models/Drama';

interface ProtectedVideoPlayerProps {
  episodeId: string;
  paused: boolean;
  role?: UserRole;
}

export function ProtectedVideoPlayer({ episodeId, paused, role = 'VIEWER' }: ProtectedVideoPlayerProps) {
  const [stream, setStream] = useState<Awaited<ReturnType<typeof getStreamToken>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStream(null);
    setError(null);
    getStreamToken(episodeId, role).then((response) => active && setStream(response)).catch(() => active && setError('Unable to authorize this stream.'));
    return () => { active = false; };
  }, [episodeId, role]);

  if (error) return <View style={styles.message}><Text style={styles.error}>{error}</Text></View>;
  if (!stream) return <View style={styles.message}><ActivityIndicator color="#22d3ee" /><Text style={styles.loading}>Authorizing stream...</Text></View>;

  return <Video source={{ uri: stream.manifestUrl, headers: { Authorization: `Bearer ${stream.token}` } }} paused={paused} controls={false} resizeMode="contain" style={StyleSheet.absoluteFill} onError={() => setError('Playback failed. Please try again.')} />;
}

const styles = StyleSheet.create({
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050a12' },
  loading: { color: '#94a3b8', marginTop: 8 },
  error: { color: '#fca5a5' },
});
