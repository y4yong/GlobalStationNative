import { pool } from './db.js';
import { signPlaybackUrl } from './mediaStorage.js';

export interface EpisodeRecord { id: string; title: string; duration: string; rating: string; requiresVip: boolean }
export interface DramaRecord { id: string; title: string; contentType: 'MOVIE' | 'SERIES'; category: string; genre: string; rating: string; badge: 'VIP' | 'FREE'; posterUrl?: string; posterHorizontalUrl?: string; createdAt: string; trendingViews: number; description: string; episodes: EpisodeRecord[] }

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
