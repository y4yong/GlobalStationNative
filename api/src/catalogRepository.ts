import { pool } from './db.js';
import { signPlaybackUrl } from './mediaStorage.js';

export interface EpisodeRecord { id: string; title: string; duration: string; rating: string }
export interface DramaRecord { id: string; title: string; category: string; genre: string; rating: string; badge: 'VIP' | 'FREE'; posterUrl?: string; description: string; episodes: EpisodeRecord[] }

export async function listDramas(): Promise<DramaRecord[]> {
  const { rows } = await pool.query(`
    SELECT c.id, c.title, c.category, c.genre, c.rating, c.description, c.poster_url AS "posterUrl", c.is_exclusive_vip,
      COALESCE(json_agg(json_build_object('id', e.id, 'title', 'Episode ' || e.episode_number || ': ' || e.title,
        'duration', ROUND(e.duration_seconds / 60.0)::text || ' min', 'rating', c.rating)
        ORDER BY e.episode_number) FILTER (WHERE e.id IS NOT NULL), '[]') AS episodes
    FROM content c LEFT JOIN episodes e ON e.content_id = c.id
    WHERE c.status = 'APPROVED' AND NOT c.is_archived
    GROUP BY c.id ORDER BY c.created_at DESC`);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    genre: row.genre,
    rating: row.rating,
    badge: row.is_exclusive_vip ? 'VIP' : 'FREE',
    posterUrl: row.posterUrl ? signPlaybackUrl(row.posterUrl) : undefined,
    description: row.description,
    episodes: row.episodes,
  }));
}
