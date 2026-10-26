import { pool } from './db.js';
import { signPlaybackUrl } from './mediaStorage.js';

export interface EpisodeRecord { id: string; title: string; duration: string; rating: string; requiresVip: boolean }
export interface DramaRecord { id: string; title: string; contentType: 'MOVIE' | 'SERIES'; category: string; genre: string; rating: string; badge: 'VIP' | 'FREE'; posterUrl?: string; posterHorizontalUrl?: string; createdAt: string; trendingViews: number; description: string; episodes: EpisodeRecord[] }

export interface ContinueWatchingRecord {
  id: string;
  title: string;
  category: string;
  genre: string;
  rating: string;
  badge: 'VIP' | 'FREE';
  posterUrl?: string;
  description: string;
  episodeId: string;
  episodeTitle: string;
  durationSeconds: number;
  resumeAtSeconds: number;
  progress: number;
  timeLeft: string;
}

export async function listDramas(): Promise<DramaRecord[]> {
  const { rows } = await pool.query(`
    SELECT c.id, c.title, c.content_type AS "contentType", c.category, c.genre, c.rating, c.description,
      c.poster_url AS "posterUrl", c.poster_horizontal_url AS "posterHorizontalUrl", c.is_exclusive_vip,
      c.created_at AS "createdAt",
      (SELECT COUNT(DISTINCT w.session_uid)::int
        FROM episodes te JOIN watch_logs w ON w.episode_id = te.id
        WHERE te.content_id = c.id AND w.created_at >= now() - interval '30 days') AS "trendingViews",
      COALESCE(json_agg(json_build_object('id', e.id, 'title', 'Episode ' || e.episode_number || ': ' || e.title,
        'duration', ROUND(e.duration_seconds / 60.0)::text || ' min', 'rating', c.rating,
        'requiresVip', c.is_exclusive_vip OR NOT e.is_free_preview)
        ORDER BY e.episode_number) FILTER (WHERE e.id IS NOT NULL), '[]') AS episodes
    FROM content c LEFT JOIN episodes e ON e.content_id = c.id
    WHERE c.status = 'APPROVED' AND NOT c.is_archived
    GROUP BY c.id ORDER BY c.created_at DESC`);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    contentType: row.contentType,
    createdAt: row.createdAt,
    trendingViews: row.trendingViews,
    category: row.category,
    genre: row.genre,
    rating: row.rating,
    badge: row.is_exclusive_vip ? 'VIP' : 'FREE',
    posterUrl: row.posterUrl ? signPlaybackUrl(row.posterUrl) : undefined,
    posterHorizontalUrl: row.posterHorizontalUrl ? signPlaybackUrl(row.posterHorizontalUrl) : undefined,
    description: row.description,
    episodes: row.episodes,
  }));
}

export async function listContinueWatching(userId: string): Promise<ContinueWatchingRecord[]> {
  const { rows } = await pool.query<{
    id: string; title: string; category: string; genre: string; rating: string; description: string; posterUrl?: string; is_exclusive_vip: boolean;
    episodeId: string; episodeTitle: string; durationSeconds: number; watchSeconds: number;
  }>(`
    SELECT c.id, c.title, c.category, c.genre, c.rating, c.description, c.poster_url AS "posterUrl", c.is_exclusive_vip,
      e.id AS "episodeId", e.title AS "episodeTitle", e.duration_seconds AS "durationSeconds",
      COALESCE(SUM(w.watch_seconds), 0)::int AS "watchSeconds"
    FROM watch_logs w
    JOIN episodes e ON e.id = w.episode_id
    JOIN content c ON c.id = e.content_id
    WHERE w.user_id = $1 AND c.status = 'APPROVED' AND NOT c.is_archived
    GROUP BY c.id, c.title, c.category, c.genre, c.rating, c.description, c.poster_url, c.is_exclusive_vip, e.id, e.title, e.duration_seconds
    HAVING COALESCE(SUM(w.watch_seconds), 0) > 0
    ORDER BY MAX(w.created_at) DESC
    LIMIT 6
  `, [userId]);

  return rows.map((row) => {
    const durationSeconds = Number(row.durationSeconds || 0);
    const watchSeconds = Math.min(Math.max(Number(row.watchSeconds || 0), 0), durationSeconds);
    const progress = durationSeconds > 0 ? watchSeconds / durationSeconds : 0;
    const remainingSeconds = Math.max(0, durationSeconds - watchSeconds);
    const timeLeft = remainingSeconds <= 0
      ? 'Finished'
      : remainingSeconds < 60
        ? `${Math.max(1, Math.ceil(remainingSeconds))} sec left`
        : `${Math.max(1, Math.ceil(remainingSeconds / 60))} min left`;

    return {
      id: row.id,
      title: row.title,
      category: row.category,
      genre: row.genre,
      rating: row.rating,
      badge: row.is_exclusive_vip ? 'VIP' : 'FREE',
      posterUrl: row.posterUrl ? signPlaybackUrl(row.posterUrl) : undefined,
      description: row.description,
      episodeId: row.episodeId,
      episodeTitle: row.episodeTitle,
      durationSeconds,
      resumeAtSeconds: watchSeconds,
      progress,
      timeLeft,
    };
  });
}
