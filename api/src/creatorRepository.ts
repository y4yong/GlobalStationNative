import { pool } from './db.js';
import { signPlaybackUrl } from './mediaStorage.js';

const payoutMinimum = 20;

export async function creatorOverview(creatorId: string) {
  const [contentResult, earningsResult, payoutsResult] = await Promise.all([
    pool.query(`
      SELECT c.id, c.title, c.content_type AS "contentType", c.description,
        c.poster_url AS "posterReference", c.rating, c.genre, c.category, c.status,
        c.poster_horizontal_url AS "posterHorizontalReference",
        c.is_exclusive_vip AS "isExclusiveVip", c.is_archived AS "isArchived", c.created_at AS "createdAt",
        COALESCE(metrics.episode_count, 0)::int AS "episodeCount",
        COALESCE(metrics.views, 0)::int AS views,
        COALESCE(metrics.unique_viewers, 0)::int AS "uniqueViewers",
        COALESCE(metrics.watch_seconds, 0)::int AS "watchSeconds",
        COALESCE(metrics.episodes, '[]'::json) AS episodes
      FROM content c
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT e.id)::int AS episode_count,
          COUNT(DISTINCT w.session_uid)::int AS views,
          COUNT(DISTINCT w.user_id)::int AS unique_viewers,
          COALESCE(SUM(w.watch_seconds), 0)::int AS watch_seconds,
          COALESCE((
            SELECT json_agg(episode_stats ORDER BY episode_stats."episodeNumber")
            FROM (
              SELECT e2.episode_number AS "episodeNumber", e2.title,
                e2.duration_seconds AS "durationSeconds",
                COUNT(DISTINCT w2.session_uid)::int AS views,
                COALESCE(SUM(w2.watch_seconds), 0)::int AS "watchSeconds"
              FROM episodes e2
              LEFT JOIN watch_logs w2 ON w2.episode_id = e2.id
              WHERE e2.content_id = c.id
              GROUP BY e2.id
            ) episode_stats
          ), '[]'::json) AS episodes
        FROM episodes e
        LEFT JOIN watch_logs w ON w.episode_id = e.id
        WHERE e.content_id = c.id
      ) metrics ON TRUE
      WHERE c.created_by = $1
      ORDER BY c.created_at DESC
    `, [creatorId]),
    pool.query<{ earned: string }>(`
      SELECT COALESCE(SUM(creator_share), 0)::text AS earned
      FROM creator_revenue_ledger WHERE creator_id = $1
    `, [creatorId]),
    pool.query(`
      SELECT id, amount::text AS amount, status,
        requested_at AS "requestedAt", processed_at AS "processedAt"
      FROM payout_requests WHERE creator_id = $1
      ORDER BY requested_at DESC LIMIT 20
    `, [creatorId]),
  ]);

  const payoutTotals = await pool.query<{ reserved: string; paid: string }>(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status IN ('PENDING', 'APPROVED')), 0)::text AS reserved,
      COALESCE(SUM(amount) FILTER (WHERE status = 'PAID'), 0)::text AS paid
    FROM payout_requests WHERE creator_id = $1
  `, [creatorId]);
  const earned = Number(earningsResult.rows[0]?.earned ?? 0);
  const reserved = Number(payoutTotals.rows[0]?.reserved ?? 0);
  const paid = Number(payoutTotals.rows[0]?.paid ?? 0);

  return {
    submissions: contentResult.rows.map(content => ({
      ...content,
      posterUrl: content.posterReference ? signPlaybackUrl(content.posterReference) : null,
      posterHorizontalUrl: content.posterHorizontalReference ? signPlaybackUrl(content.posterHorizontalReference) : null,
      episodes: content.episodes,
    })),
    payouts: {
      earned: earned.toFixed(2),
      reserved: reserved.toFixed(2),
      paid: paid.toFixed(2),
      available: Math.max(0, earned - reserved - paid).toFixed(2),
      minimumRequest: payoutMinimum.toFixed(2),
      requests: payoutsResult.rows,
    },
  };
}

export async function requestCreatorPayout(creatorId: string, amount: number) {
  if (!Number.isFinite(amount) || amount < payoutMinimum) {
    throw Object.assign(new Error(`Payout requests must be at least RM ${payoutMinimum.toFixed(2)}.`), { statusCode: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [creatorId]);
    const earningsResult = await client.query<{ earned: string }>(`
      SELECT COALESCE(SUM(creator_share), 0)::text AS earned
      FROM creator_revenue_ledger WHERE creator_id = $1
    `, [creatorId]);
    const payoutResult = await client.query<{ reserved: string }>(`
      SELECT COALESCE(SUM(amount), 0)::text AS reserved
      FROM payout_requests WHERE creator_id = $1 AND status IN ('PENDING', 'APPROVED', 'PAID')
    `, [creatorId]);
    const available = Number(earningsResult.rows[0]?.earned ?? 0) - Number(payoutResult.rows[0]?.reserved ?? 0);
    if (amount > available) {
      throw Object.assign(new Error(`Requested amount exceeds your available balance of RM ${Math.max(0, available).toFixed(2)}.`), { statusCode: 400 });
    }
    const { rows } = await client.query(`
      INSERT INTO payout_requests (creator_id, amount, status)
      VALUES ($1, $2, 'PENDING')
      RETURNING id, amount::text AS amount, status, requested_at AS "requestedAt"
    `, [creatorId, amount.toFixed(2)]);
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}