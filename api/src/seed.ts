import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from './db.js';

const dramas = [
  ['1', 'Thorns of the Heart: Season 2', 'Romance', 'Romance Drama', 'P13', 'VIP', null, null, 'New Episode', 'Two wounded souls fight against betrayal, unspoken secrets, and high-society sabotage in this dramatic romantic saga.', [{ id: 'ep1', title: 'Episode 1: The Broken Oath', duration: '42 min', rating: 'P13' }, { id: 'ep2', title: 'Episode 2: Silent Tears', duration: '45 min', rating: 'P13' }, { id: 'ep3', title: 'Episode 3: Shadows of Betrayal', duration: '40 min', rating: 'P13' }]],
  ['2', 'First Encounter', 'Malay Drama', 'Drama', 'P13', 'VIP', 0.65, '12m left', null, 'An accidental meeting during an evening commute sets off a journey of unexpected revelations.', [{ id: 'ep1', title: 'Episode 1: Train Station', duration: '38 min', rating: 'P13' }]],
  ['3', 'Central Precinct', 'Action', 'Crime Unit', '18', 'FREE', 0.3, '34m left', null, 'A tactical unit investigates an elusive syndicate operating right under the police radar.', [{ id: 'ep1', title: 'Episode 1: Code Red', duration: '44 min', rating: '18' }]],
  ['4', 'Terminal Love', 'Romance', 'Romance Drama', 'P13', 'VIP', null, null, null, 'Two wounded souls meet at a terminal filled with old memories.', [{ id: 'ep1', title: 'Episode 1: Last Platform', duration: '40 min', rating: 'P13' }, { id: 'ep2', title: 'Episode 2: The Lost Letter', duration: '42 min', rating: 'P13' }, { id: 'ep3', title: 'Episode 3: Promise at Dawn', duration: '44 min', rating: 'P13' }]],
  ['5', 'Shadow Unit', 'Action', 'Action Thriller', '18', 'FREE', null, null, null, 'Undercover operatives deploy into dangerous territories to neutralize rogue factions.', [{ id: 'ep1', title: 'Episode 1: Covert Ops', duration: '41 min', rating: '18' }]],
  ['6', 'Jasmine & Firdaus', 'Malay Drama', 'Romance Drama', 'P13', 'VIP', null, null, null, 'A contemporary romance navigating cultural heritage and corporate ambition.', [{ id: 'ep1', title: 'Episode 1: Fragrant Beginnings', duration: '43 min', rating: 'P13' }]],
] as const;

const passwordHash = await bcrypt.hash('ChangeMe123!', 12);
await pool.query('BEGIN');
try {
  await pool.query('INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', ['Global Station Admin', 'admin@globalstation.local', passwordHash, 'ADMIN']);
  for (const drama of dramas) {
    const title = drama[1];
    const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM dramas WHERE title = ? LIMIT 1', [title]);
    let dramaId = existing[0]?.id as number | undefined;
    if (!dramaId) {
      const result = await pool.query<ResultSetHeader>(
        `INSERT INTO dramas (title, description, poster_url, rating, is_featured, is_exclusive_vip, status)
         VALUES (?, ?, ?, ?, ?, ?, 'APPROVED')`,
        [title, drama[9], 'https://placehold.co/600x900/111827/38bdf8?text=Global+Station', drama[4], drama[8] ? 1 : 0, drama[5] === 'VIP' ? 1 : 0],
      );
      dramaId = result[0].insertId;
    }
    for (const [index, episode] of drama[10].entries()) {
      await pool.query(
        `INSERT INTO episodes (drama_id, episode_number, title, duration_seconds, hls_manifest_url, is_free_preview)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM episodes WHERE drama_id = ? AND episode_number = ?)`,
        [dramaId, index + 1, episode.title.replace(/^Episode \d+: /, ''), parseInt(episode.duration, 10) * 60, 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', drama[5] === 'FREE' ? 1 : 0, dramaId, index + 1],
      );
    }
  }
  await pool.query('COMMIT');
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await pool.end();
}
console.log('Development seed completed.');
