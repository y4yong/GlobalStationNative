import { pool } from './db.js';

export const EPISODE_COIN_PRICE = 10;

export const COIN_PACKS = [
  { code: 'STARTER', coins: 100, amountSen: 490, label: '100 coins' },
  { code: 'POPULAR', coins: 250, amountSen: 990, label: '250 coins' },
  { code: 'VALUE', coins: 600, amountSen: 1990, label: '600 coins' },
] as const;

export type CoinPackCode = typeof COIN_PACKS[number]['code'];

export async function coinWallet(userId: string) {
  const [balance, unlocks] = await Promise.all([
    pool.query<{ coin_balance: number }>('SELECT coin_balance FROM users WHERE id = $1 AND status = $2', [userId, 'ACTIVE']),
    pool.query<{ episode_id: string }>('SELECT episode_id FROM episode_coin_purchases WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
  ]);
  if (!balance.rows[0]) throw Object.assign(new Error('Account unavailable.'), { statusCode: 404 });
  return {
    balance: balance.rows[0].coin_balance,
    unlockedEpisodeIds: unlocks.rows.map(row => row.episode_id),
    episodePrice: EPISODE_COIN_PRICE,
    packs: COIN_PACKS.map(({ code, coins, amountSen, label }) => ({ code, coins, amount: (amountSen / 100).toFixed(2), currency: 'MYR', label })),
  };
}

export async function purchaseEpisodeWithCoins(userId: string, episodeId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query<{ coin_balance: number; is_vip: boolean }>(`
      SELECT u.coin_balance, (u.is_vip OR EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.user_id = u.id AND s.status = 'ACTIVE'
          AND (s.renews_at IS NULL OR s.renews_at > now())
      )) AS is_vip
      FROM users u WHERE u.id = $1 AND u.status = 'ACTIVE' FOR UPDATE
    `, [userId]);
    if (!user.rows[0]) throw Object.assign(new Error('Account unavailable.'), { statusCode: 404 });

    const episode = await client.query<{ is_free_preview: boolean; is_exclusive_vip: boolean }>(`
      SELECT e.is_free_preview, c.is_exclusive_vip
      FROM episodes e JOIN content c ON c.id = e.content_id
      WHERE e.id = $1 AND c.status = 'APPROVED' AND NOT c.is_archived
      FOR SHARE OF e, c
    `, [episodeId]);
    if (!episode.rows[0]) throw Object.assign(new Error('Episode not found.'), { statusCode: 404 });
    if (episode.rows[0].is_free_preview || episode.rows[0].is_exclusive_vip) {
      throw Object.assign(new Error('This episode is not available for a coin purchase.'), { statusCode: 400 });
    }

    const existing = await client.query(
      'SELECT 1 FROM episode_coin_purchases WHERE user_id = $1 AND episode_id = $2',
      [userId, episodeId],
    );
    if (existing.rowCount) {
      await client.query('COMMIT');
      return { balance: user.rows[0].coin_balance, episodeId, alreadyUnlocked: true };
    }
    if (user.rows[0].is_vip) {
      await client.query('COMMIT');
      return { balance: user.rows[0].coin_balance, episodeId, alreadyUnlocked: true };
    }
    if (user.rows[0].coin_balance < EPISODE_COIN_PRICE) {
      throw Object.assign(new Error('Not enough coins. Top up your coin balance to unlock this episode.'), { statusCode: 409, code: 'INSUFFICIENT_COINS' });
    }

    const updatedUser = await client.query<{ coin_balance: number }>(
      'UPDATE users SET coin_balance = coin_balance - $1 WHERE id = $2 RETURNING coin_balance',
      [EPISODE_COIN_PRICE, userId],
    );
    await client.query(
      'INSERT INTO episode_coin_purchases (user_id, episode_id, coin_amount) VALUES ($1, $2, $3)',
      [userId, episodeId, EPISODE_COIN_PRICE],
    );
    await client.query('COMMIT');
    return { balance: updatedUser.rows[0].coin_balance, episodeId, alreadyUnlocked: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
