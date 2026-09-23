import type { RowDataPacket } from 'mysql2';
import { pool } from './db.js';

export interface EpisodeRecord {
  id: string;
  title: string;
  duration: string;
  rating: string;
}

export interface DramaRecord {
  id: string;
  title: string;
  category: string;
  genre: string;
  rating: string;
  badge: 'VIP' | 'FREE';
  progress?: number;
  timeLeft?: string;
  tag?: string;
  description: string;
  episodes: EpisodeRecord[];
}

interface DramaRow extends RowDataPacket {
  id: number;
  title: string;
  description: string;
  rating: string;
  is_exclusive_vip: number;
  status: string;
}

interface EpisodeRow extends RowDataPacket {
  id: number;
  drama_id: number;
  episode_number: number;
  title: string;
  duration_seconds: number;
}

export async function listDramas(): Promise<DramaRecord[]> {
  const [dramas] = await pool.query<DramaRow[]>(
    `SELECT id, title, description, rating, is_exclusive_vip, status
     FROM dramas
     WHERE status IN ('APPROVED', 'PUBLISHED')
     ORDER BY created_at DESC, title ASC`,
  );
  const [episodes] = await pool.query<EpisodeRow[]>(
    `SELECT id, drama_id, episode_number, title, duration_seconds
     FROM episodes
     ORDER BY drama_id ASC, episode_number ASC`,
  );
  const episodesByDrama = new Map<number, EpisodeRecord[]>();
  for (const episode of episodes) {
    const dramaEpisodes = episodesByDrama.get(episode.drama_id) ?? [];
    dramaEpisodes.push({
      id: String(episode.id),
      title: `Episode ${episode.episode_number}: ${episode.title}`,
      duration: `${Math.round(episode.duration_seconds / 60)} min`,
      rating: dramas.find((drama) => drama.id === episode.drama_id)?.rating ?? 'P13',
    });
    episodesByDrama.set(episode.drama_id, dramaEpisodes);
  }
  return dramas.map((drama) => ({
    id: String(drama.id),
    title: drama.title,
    category: 'Drama',
    genre: 'Drama',
    rating: drama.rating,
    badge: drama.is_exclusive_vip ? 'VIP' : 'FREE',
    description: drama.description ?? '',
    episodes: episodesByDrama.get(drama.id) ?? [],
  }));
}
